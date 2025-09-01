  import React, { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
  import { Play, Pause, RotateCcw, Settings, ZoomIn, ZoomOut, RotateCw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Camera, Eye, EyeOff } from 'lucide-react';

  /* -------------------- Utilities: element size (ResizeObserver) -------------------- */
  function useElementSize<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const [size, setSize] = useState({ width: 800, height: 600 });
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      const ro = new ResizeObserver(entries => {
        const cr = entries[0].contentRect;
        setSize({ width: Math.max(200, cr.width), height: Math.max(200, cr.height) });
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    return { ref, size };
  }

  /* -------------------- Prime sieve -------------------- */
  function sievePrimes(limit: number): number[] {
    if (limit < 2) return [];
    const sieve = new Array(limit + 1).fill(true);
    sieve[0] = sieve[1] = false;
    const upper = Math.floor(Math.sqrt(limit));
    for (let p = 2; p <= upper; p++) {
      if (sieve[p]) for (let i = p * p; i <= limit; i += p) sieve[i] = false;
    }
    return sieve.map((isPrime, i) => (isPrime ? i : -1)).filter(n => n > 0);
  }

  /* -------------------- Geometry generators -------------------- */
  interface Point3D { n: number; x: number; y: number; z: number; }

  function coordsHelix(N: number, stepAngle: number, radius: number, pitch: number): Point3D[] {
    const points: Point3D[] = [];
    for (let n = 1; n <= N; n++) {
      const t = n * stepAngle;
      points.push({ n, x: radius * Math.cos(t), y: radius * Math.sin(t), z: pitch * t });
    }
    return points;
  }

  function coordsSphericalSpiral(N: number, stepAngle: number): Point3D[] {
    const points: Point3D[] = [];
    for (let n = 1; n <= N; n++) {
      const z = (2.0 * (n - 1)) / Math.max(N - 1, 1) - 1.0;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const theta = n * stepAngle;
      points.push({ n, x: r * cos(theta), y: r * sin(theta), z });
    }
    return points;
  }
  const { cos, sin, sqrt, max } = Math;
  function coordsConicalArchimedean(N: number, stepAngle: number, a: number, b: number, c: number): Point3D[] {
    const points: Point3D[] = [];
    for (let n = 1; n <= N; n++) {
      const t = n * stepAngle;
      const r = a + b * t;
      points.push({ n, x: r * Math.cos(t), y: r * Math.sin(t), z: c * t });
    }
    return points;
  }

  function coordsLayeredTime(N: number, blockSize: number, layerRadius: number, stepAngle: number): Point3D[] {
    const points: Point3D[] = [];
    const safe = Math.max(blockSize, 1);
    for (let n = 1; n <= N; n++) {
      const layer = Math.floor((n - 1) / safe);
      const idxInLayer = (n - 1) % safe;
      const theta = idxInLayer * stepAngle;
      points.push({ n, x: layerRadius * Math.cos(theta), y: layerRadius * Math.sin(theta), z: layer });
    }
    return points;
  }

  /* -------------------- 3D Canvas (SVG) -------------------- */
  interface Canvas3DProps {
    points: Point3D[];
    primes: Set<number>;
    dotSize: number;
    isAnimating: boolean;
    animationSpeed: number;
    resetSignal: number;
    width: number;
    height: number;
    rotation: { x: number; y: number };
    setRotation: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
    zoom: number;
    setZoom: React.Dispatch<React.SetStateAction<number>>;
    showAllNumbers: boolean;
    showAxes: boolean;
    perspective: boolean;
    svgRef: React.RefObject<SVGSVGElement>;
  }

  export function Canvas3D({
    points, primes, dotSize, isAnimating, animationSpeed, resetSignal,
    width, height, rotation, setRotation, zoom, setZoom, showAllNumbers, showAxes, perspective, svgRef
  }: Canvas3DProps) {
    const [isDragging, setIsDragging] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });
    const pointers = useRef(new Map<number, { x: number; y: number }>());

    const [tooltip, setTooltip] = useState<null | { x: number; y: number; label: string }>(null);
    const pinch = useRef<{ startDist: number; startZoom: number } | null>(null);

    // Reset
    useEffect(() => { setRotation({ x: 0, y: 0 }); setZoom(1); }, [resetSignal]);

    // rAF animation
    useEffect(() => {
      let raf = 0;
      let last = performance.now();
      const tick = (t: number) => {
        const dt = Math.min(32, t - last);
        last = t;
        if (isAnimating) {
          setRotation(prev => ({
            x: prev.x + 0.001 * animationSpeed * dt,
            y: prev.y + 0.0005 * animationSpeed * dt,
          }));
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [isAnimating, animationSpeed, setRotation]);

    const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        setIsDragging(true);
        lastPos.current = { x: e.clientX, y: e.clientY };
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dx = a.x - b.x, dy = a.y - b.y;
        pinch.current = { startDist: Math.hypot(dx, dy), startZoom: zoom };
      }
    };

    const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size === 1 && isDragging) {
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        lastPos.current = { x: e.clientX, y: e.clientY };
        setRotation(prev => ({ x: prev.x + dy * 0.01, y: prev.y + dx * 0.01 }));
      } else if (pointers.current.size === 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const factor = dist / Math.max(1, pinch.current.startDist);
        setZoom(z => Math.max(0.1, Math.min(5, pinch.current!.startZoom * factor)));
      }
    };

    const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 0) setIsDragging(false);
    };

    const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const k = e.ctrlKey ? 0.0025 : 0.001;
      setZoom(prev => Math.max(0.1, Math.min(5, prev + (-e.deltaY) * k)));
    };

    // Project function
    const project = (pt: { x: number; y: number; z: number }) => {
      const cx = width / 2, cy = height / 2;
      const scale = Math.min(width, height) * 0.12 * zoom;
      const cosX = Math.cos(rotation.x), sinX = Math.sin(rotation.x);
      const cosY = Math.cos(rotation.y), sinY = Math.sin(rotation.y);
      const y1 = pt.y * cosX - pt.z * sinX;
      const z1 = pt.y * sinX + pt.z * cosX;
      const x2 = pt.x * cosY + z1 * sinY;
      const z2 = -pt.x * sinY + z1 * cosY;
      const persp = perspective ? (1 / (1 + z2 * 0.1)) : 1;
      return { x: cx + x2 * scale * persp, y: cy + y1 * scale * persp, z: z2, p: persp };
    };

    // Points
    const projected = useMemo(() => {
      const arr: { x: number; y: number; z: number; n: number; r: number; prime: boolean }[] = [];
      for (const p of points) {
        const prime = primes.has(p.n);
        if (!prime && !showAllNumbers) continue;
        const pr = project(p);
        const r = Math.max(1, (dotSize) * pr.p);
        arr.push({ x: pr.x, y: pr.y, z: pr.z, n: p.n, r, prime });
      }
      arr.sort((a, b) => a.z - b.z);
      return arr;
    }, [points, primes, rotation.x, rotation.y, zoom, dotSize, width, height, showAllNumbers, perspective]);

    // Axes
    const axes = useMemo(() => {
      if (!showAxes) return null;
      const L = 8; // axis half-length in world units
      const lines = [
        { a: project({ x: -L, y: 0, z: 0 }), b: project({ x: L, y: 0, z: 0 }), label: 'X', end: project({ x: L, y: 0, z: 0 }) },
        { a: project({ x: 0, y: -L, z: 0 }), b: project({ x: 0, y: L, z: 0 }), label: 'Y', end: project({ x: 0, y: L, z: 0 }) },
        { a: project({ x: 0, y: 0, z: -L }), b: project({ x: 0, y: 0, z: L }), label: 'Z', end: project({ x: 0, y: 0, z: L }) },
      ];
      return lines;
    }, [rotation.x, rotation.y, zoom, width, height, perspective, showAxes]);

    return (
      <div className="relative">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="border border-gray-300 bg-gray-900 touch-pan-y"
          style={{ display: 'block', width: '100%', height: '100%' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* Axes */}
          {axes && axes.map((ax, i) => (
            <g key={i}>
              <line x1={ax.a.x} y1={ax.a.y} x2={ax.b.x} y2={ax.b.y} stroke="white" strokeOpacity="0.35" strokeWidth="1"/>
              <text x={ax.end.x + 6} y={ax.end.y - 6} fontSize="10" fill="white" fillOpacity="0.6">{ax.label}</text>
            </g>
          ))}

          {/* Points */}
          {projected.map((p, i) => (
            <circle
              key={`${p.n}-${i}`}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={p.prime ? `hsl(${p.n % 360}, 70%, 60%)` : "rgba(255,255,255,0.2)"}
              opacity={p.prime ? 0.9 : 0.5}
              onMouseEnter={() => setTooltip({ x: p.x, y: p.y, label: `Prime: ${p.n}` })}
              onMouseMove={() => setTooltip({ x: p.x, y: p.y, label: `Prime: ${p.n}` })}
              onMouseLeave={() => setTooltip(null)}
            >
              <title>{p.prime ? `Prime: ${p.n}` : `${p.n}`}</title>
            </circle>
          ))}
        </svg>

        <div className="absolute top-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-sm">
          Primes: {projected.filter(p => p.prime).length} / {points.length}
        </div>
        <div className="absolute bottom-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
          Drag to rotate • Scroll/Pinch to zoom
        </div>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute bg-white text-gray-900 text-xs px-2 py-1 rounded shadow"
            style={{ left: tooltip.x + 10, top: tooltip.y + 10 }}
          >
            {tooltip.label}
          </div>
        )}
      </div>
    );
  }

  /* -------------------- Main Component -------------------- */
  export default function App() {
    const [mode, setMode] = useState<'helix' | 'spherical' | 'conical' | 'layered'>('helix');
    const [N, setN] = useState(2000);
    const [isAnimating, setIsAnimating] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [resetKey, setResetKey] = useState(0);

    // Parameters
    const [stepAngle, setStepAngle] = useState(0.35);
    const [radius, setRadius] = useState(1.0);
    const [pitch, setPitch] = useState(0.08);
    const [a, setA] = useState(0.8);
    const [b, setB] = useState(0.04);
    const [c, setC] = useState(0.03);
    const [blockSize, setBlockSize] = useState(200);
    const [layerRadius, setLayerRadius] = useState(6.0);
    const [dotSize, setDotSize] = useState(3);
    const [animationSpeed, setAnimationSpeed] = useState(1);

    // Camera state lifted up for external buttons
    const [rotation, setRotation] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [showAllNumbers, setShowAllNumbers] = useState(false);
    const [showAxes, setShowAxes] = useState(false);
    const [perspective, setPerspective] = useState(true);

    const svgRef = useRef<SVGSVGElement | null>(null);
    const { ref: vizRef, size } = useElementSize<HTMLDivElement>();

    const primes = useMemo(() => new Set(sievePrimes(N)), [N]);
    const points = useMemo(() => {
      switch (mode) {
        case 'helix': return coordsHelix(N, stepAngle, radius, pitch);
        case 'spherical': return coordsSphericalSpiral(N, stepAngle);
        case 'conical': return coordsConicalArchimedean(N, stepAngle, a, b, c);
        case 'layered': return coordsLayeredTime(N, blockSize, layerRadius, stepAngle);
        default: return [];
      }
    }, [mode, N, stepAngle, radius, pitch, a, b, c, blockSize, layerRadius]);

    const modelExplanations: Record<string, string> = {
      helix: `
**Helix (Cylindrical Spiral)**
- **Position:** x = R·cos(t), y = R·sin(t), z = p·t where t = n·stepAngle.
- **Idea:** Wrap the number line around a cylinder; as n grows, angle increases uniformly and height rises linearly.
- **Look for:** Slanted bands or pseudo-diagonals of primes when stepAngle resonates with modular patterns.`,
      spherical: `
**Spherical Spiral**
- **Position:** z spaced uniformly from −1 to 1; r = sqrt(1 − z²); θ = n·stepAngle; x = r·cos(θ), y = r·sin(θ).
- **Idea:** Traverse the sphere with near-uniform surface coverage while numbers increment.
- **Look for:** Whether prime density appears uniform across latitudes/longitudes.`,
      conical: `
**Conical Archimedean Spiral**
- **Position:** r = a + b·t and z = c·t with t = n·stepAngle; x = r·cos(t), y = r·sin(t).
- **Idea:** A 2D Archimedean spiral lifted in z; radius and height grow linearly.
- **Look for:** Radial bands of primes; tweak b or c to stretch & reveal modular structures.`,
      layered: `
**Layered-Time Spiral**
- **Position:** Integers chunked into blocks; each block forms a ring at fixed z. x = R·cos(k·stepAngle), y = R·sin(k·stepAngle).
- **Idea:** Treat consecutive integers as time batches. Each layer is a batch; primes are highlighted timestamps.
- **Look for:** Prime density differences between layers (local fluctuations).`,
    };

    // Controls helpers
    const ROT_STEP = 0.12; // radians ~ 6.9°
    const ZOOM_STEP = 0.15;

    const exportSVG = () => {
      const svg = svgRef.current;
      if (!svg) return;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      // Ensure xmlns for proper SVG file
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const source = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prime-spirals.svg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-6">
            <h1 className="text-4xl font-bold text-white mb-2">3D Prime Spirals Visualizer</h1>
            <p className="text-gray-300 text-lg">Interactive visualization of prime numbers in spiral 3D geometries</p>
          </div>

          <div className="grid lg:grid-cols-4 gap-6">
            {/* Controls */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                <h3 className="text-white font-semibold mb-3">Spiral Mode</h3>
                <div className="space-y-2">
                  {Object.entries({
                    helix: 'Cylindrical helix - numbers wrap around a cylinder',
                    spherical: 'Spiral on a sphere - approximately uniform coverage',
                    conical: '3D Archimedean spiral - radius grows with height',
                    layered: 'Layered spiral - numbers in block-based levels',
                  }).map(([key, desc]) => (
                    <div key={key}>
                      <button
                        onClick={() => setMode(key as any)}
                        className={`w-full text-left p-3 rounded-lg transition-all ${
                          mode === key
                            ? 'bg-blue-500/50 border-blue-400 text-white'
                            : 'bg-white/5 border-transparent text-gray-300 hover:bg-white/10'
                        } border`}
                      >
                        <div className="font-medium capitalize">{key}</div>
                        <div className="text-xs opacity-75 mt-1">{desc}</div>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                <h3 className="text-white font-semibold mb-3">Controls</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-300 text-sm">Max number: {N}</label>
                    <input type="range" min="100" max="10000" step="100" value={N} onChange={(e) => setN(Number(e.target.value))} className="w-full mt-1" />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsAnimating((s) => !s)}
                      className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg transition-colors"
                    >
                      {isAnimating ? <Pause size={16} /> : <Play size={16} />}
                      {isAnimating ? 'Pause' : 'Animate'}
                    </button>

                    <button
                      onClick={() => setShowSettings((s) => !s)}
                      className="flex items-center justify-center bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg transition-colors"
                      title="Show/Hide parameters"
                    >
                      <Settings size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {showSettings && (
                <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                  <h3 className="text-white font-semibold mb-3">Parameters</h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <label className="text-gray-300">Angle step: {stepAngle.toFixed(2)}</label>
                      <input type="range" min="0.1" max="1" step="0.01" value={stepAngle} onChange={(e) => setStepAngle(Number(e.target.value))} className="w-full mt-1" />
                    </div>

                    <div>
                      <label className="text-gray-300">Dot size: {dotSize}</label>
                      <input type="range" min="1" max="8" value={dotSize} onChange={(e) => setDotSize(Number(e.target.value))} className="w-full mt-1" />
                    </div>

                    <div>
                      <label className="text-gray-300">Animation speed: {animationSpeed.toFixed(1)}</label>
                      <input type="range" min="0.1" max="3" step="0.1" value={animationSpeed} onChange={(e) => setAnimationSpeed(Number(e.target.value))} className="w-full mt-1" />
                    </div>

                    {mode === 'helix' && (<>
                      <div>
                        <label className="text-gray-300">Radius: {radius.toFixed(2)}</label>
                        <input type="range" min="0.5" max="3" step="0.1" value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full mt-1" />
                      </div>
                      <div>
                        <label className="text-gray-300">Pitch: {pitch.toFixed(3)}</label>
                        <input type="range" min="0.01" max="0.2" step="0.001" value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className="w-full mt-1" />
                      </div>
                    </>)}

                    {mode === 'conical' && (<>
                      <div>
                        <label className="text-gray-300">Base radius (a): {a.toFixed(2)}</label>
                        <input type="range" min="0" max="2" step="0.1" value={a} onChange={(e) => setA(Number(e.target.value))} className="w-full mt-1" />
                      </div>
                      <div>
                        <label className="text-gray-300">Radius growth (b): {b.toFixed(3)}</label>
                        <input type="range" min="0.005" max="0.1" step="0.001" value={b} onChange={(e) => setB(Number(e.target.value))} className="w-full mt-1" />
                      </div>
                      <div>
                        <label className="text-gray-300">Height growth (c): {c.toFixed(3)}</label>
                        <input type="range" min="0.01" max="0.2" step="0.001" value={c} onChange={(e) => setC(Number(e.target.value))} className="w-full mt-1" />
                      </div>
                    </>)}

                    {mode === 'layered' && (<>
                      <div>
                        <label className="text-gray-300">Block size: {blockSize}</label>
                        <input type="range" min="50" max="500" step="10" value={blockSize} onChange={(e) => setBlockSize(Number(e.target.value))} className="w-full mt-1" />
                      </div>
                      <div>
                        <label className="text-gray-300">Layer radius: {layerRadius.toFixed(1)}</label>
                        <input type="range" min="2" max="15" step="0.5" value={layerRadius} onChange={(e) => setLayerRadius(Number(e.target.value))} className="w-full mt-1" />
                      </div>
                    </>)}
                  </div>
                </div>
              )}

              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                <h3 className="text-white font-semibold mb-2">Stats</h3>
                <div className="text-gray-300 text-sm space-y-1">
                  <div>Total numbers: {N}</div>
                  <div>Primes: {primes.size}</div>
                  <div>Density: {((primes.size / N) * 100).toFixed(1)}%</div>
                </div>
              </div>
            </div>

            {/* Visualization */}
            <div className="lg:col-span-3">
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-white font-semibold capitalize">{mode} Spiral - Prime Numbers</h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setIsAnimating(false); setResetKey(k => k + 1); setRotation({ x: 0, y: 0 }); setZoom(1); }}
                        className="text-gray-200 hover:text-white px-2 py-1 rounded transition-colors"
                        title="Reset view"
                      >
                        <RotateCcw size={20} />
                      </button>
                      <button
                        onClick={exportSVG}
                        className="text-gray-200 hover:text-white px-2 py-1 rounded transition-colors"
                        title="Download SVG snapshot"
                      >
                        <Camera size={20} />
                      </button>
                    </div>
                  </div>

                  {/* EXTRA CONTROL BAR */}
                  <div className="flex flex-wrap items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setZoom(z => Math.min(5, z + ZOOM_STEP))} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex items-center gap-1" title="Zoom in"><ZoomIn size={16}/>Zoom in</button>
                      <button onClick={() => setZoom(z => Math.max(0.1, z - ZOOM_STEP))} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex items-center gap-1" title="Zoom out"><ZoomOut size={16}/>Zoom out</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setRotation(r => ({ ...r, y: r.y - ROT_STEP }))} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex items-center gap-1" title="Rotate left"><ArrowLeft size={16}/>Left</button>
                      <button onClick={() => setRotation(r => ({ ...r, y: r.y + ROT_STEP }))} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex items-center gap-1" title="Rotate right"><ArrowRight size={16}/>Right</button>
                      <button onClick={() => setRotation(r => ({ ...r, x: r.x - ROT_STEP }))} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex items-center gap-1" title="Rotate up"><ArrowUp size={16}/>Up</button>
                      <button onClick={() => setRotation(r => ({ ...r, x: r.x + ROT_STEP }))} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex items-center gap-1" title="Rotate down"><ArrowDown size={16}/>Down</button>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button onClick={() => setShowAllNumbers(v => !v)} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex items-center gap-1" title="Toggle show all numbers">
                        {showAllNumbers ? <Eye size={16}/> : <EyeOff size={16}/>}
                        {showAllNumbers ? 'Show primes only' : 'Show all numbers'}
                      </button>
                      <button onClick={() => setShowAxes(v => !v)} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded" title="Toggle axes">
                        {showAxes ? 'Hide axes' : 'Show axes'}
                      </button>
                      <button onClick={() => setPerspective(p => !p)} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded" title="Toggle projection">
                        {perspective ? 'Perspective' : 'Orthographic'}
                      </button>
                    </div>
                  </div>
                </div>

                <div ref={vizRef} style={{ width: '100%', height: 600 }} className="mt-3">
                  <Canvas3D
                    points={points}
                    primes={primes}
                    dotSize={dotSize}
                    isAnimating={isAnimating}
                    animationSpeed={animationSpeed}
                    resetSignal={resetKey}
                    width={size.width}
                    height={size.height}
                    rotation={rotation}
                    setRotation={setRotation}
                    zoom={zoom}
                    setZoom={setZoom}
                    showAllNumbers={showAllNumbers}
                    showAxes={showAxes}
                    perspective={perspective}
                    svgRef={svgRef}
                  />
                </div>

                <div className="mt-4 text-gray-200 text-sm whitespace-pre-line">
                  {modelExplanations[mode]}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
            <h3 className="text-white font-semibold mb-3">About this visualization</h3>
            <div className="text-gray-300 text-sm leading-relaxed">
              <p className="mb-3">
                This app places integers in 3D according to a chosen spiral geometry and highlights <strong>prime numbers</strong> as colored dots.
                By rotating and zooming, you can explore spatial patterns that may be less visible on a straight number line.
              </p>
              <p className="mb-3">
                <strong>Interaction:</strong> Drag to rotate, use mouse wheel or pinch gesture to zoom. Toggle animation for smooth auto-rotation.
                Hover a dot to see its exact prime value.
              </p>
              <p>
                <strong>Notes:</strong> The step angle often governs visible structures; certain values produce striking alignments due to modular resonances.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
