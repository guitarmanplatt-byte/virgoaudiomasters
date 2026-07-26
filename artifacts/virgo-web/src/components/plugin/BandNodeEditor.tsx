import { useCallback, useRef, useState } from 'react';

export interface BandNode {
  /** Frequency in Hz (mapped logarithmically on X). */
  freq: number;
  /** Gain in dB (mapped linearly on Y). */
  gain: number;
  color?: string;
}

export interface BandNodeEditorProps {
  nodes: BandNode[];
  onChange: (index: number, node: BandNode) => void;
  minFreq?: number;
  maxFreq?: number;
  minGain?: number;
  maxGain?: number;
  height?: number;
  /** Optional response curve to draw beneath the nodes: freq→dB. */
  curve?: (freq: number) => number;
  className?: string;
}

const GOLD = '#E8A030';

/**
 * Generic draggable node-on-curve editor (log frequency X axis, dB Y axis).
 * Used by EQ-style plugins; the plugin computes/supplies the response curve.
 */
export function BandNodeEditor({
  nodes, onChange,
  minFreq = 20, maxFreq = 20000, minGain = -18, maxGain = 18,
  height = 220, curve, className,
}: BandNodeEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 600, h: height });

  const fx = useCallback((f: number) => (Math.log(f / minFreq) / Math.log(maxFreq / minFreq)) * size.w, [minFreq, maxFreq, size.w]);
  const gy = useCallback((g: number) => ((maxGain - g) / (maxGain - minGain)) * size.h, [minGain, maxGain, size.h]);
  const xf = useCallback((x: number) => minFreq * Math.pow(maxFreq / minFreq, Math.max(0, Math.min(1, x / size.w))), [minFreq, maxFreq, size.w]);
  const yg = useCallback((y: number) => maxGain - Math.max(0, Math.min(1, y / size.h)) * (maxGain - minGain), [minGain, maxGain, size.h]);

  const measure = useCallback((el: SVGSVGElement | null) => {
    (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = el;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.width !== size.w || r.height !== size.h)) {
        setSize({ w: r.width, h: r.height });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clientToLocal = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const { x, y } = clientToLocal(e);
    onChange(drag, {
      ...nodes[drag],
      freq: Math.round(xf(x)),
      gain: Math.round(yg(y) * 10) / 10,
    });
  };

  // Build response curve path
  let curvePath = '';
  if (curve) {
    const pts: string[] = [];
    for (let px = 0; px <= size.w; px += 3) {
      const f = xf(px);
      const y = gy(Math.max(minGain, Math.min(maxGain, curve(f))));
      pts.push(`${px === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${y.toFixed(1)}`);
    }
    curvePath = pts.join(' ');
  }

  const gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const gridGains = [-12, -6, 0, 6, 12].filter((g) => g > minGain && g < maxGain);

  return (
    <svg
      ref={measure}
      className={`w-full rounded-md border border-[#242424] select-none ${className ?? ''}`}
      style={{ height, background: '#0C0C0C', touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      {/* grid */}
      {gridFreqs.map((f) => (
        <g key={f}>
          <line x1={fx(f)} y1={0} x2={fx(f)} y2={size.h} stroke="rgba(255,255,255,0.06)" />
          <text x={fx(f) + 3} y={size.h - 5} fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      {gridGains.map((g) => (
        <g key={g}>
          <line x1={0} y1={gy(g)} x2={size.w} y2={gy(g)} stroke={g === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'} />
          <text x={4} y={gy(g) - 3} fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
            {g > 0 ? `+${g}` : g}
          </text>
        </g>
      ))}

      {/* response curve */}
      {curvePath && (
        <>
          <path d={`${curvePath} L ${size.w} ${gy(0)} L 0 ${gy(0)} Z`} fill="rgba(232,160,48,0.10)" />
          <path d={curvePath} fill="none" stroke={GOLD} strokeWidth="1.5" />
        </>
      )}

      {/* nodes */}
      {nodes.map((n, i) => (
        <g
          key={i}
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            setDrag(i);
          }}
        >
          <circle cx={fx(n.freq)} cy={gy(n.gain)} r={11} fill="transparent" />
          <circle
            cx={fx(n.freq)}
            cy={gy(n.gain)}
            r={6.5}
            fill="#141414"
            stroke={n.color ?? GOLD}
            strokeWidth="2"
          />
          <text
            x={fx(n.freq)}
            y={gy(n.gain) + 3}
            textAnchor="middle"
            fill={n.color ?? GOLD}
            fontSize="8"
            fontFamily="monospace"
          >
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
