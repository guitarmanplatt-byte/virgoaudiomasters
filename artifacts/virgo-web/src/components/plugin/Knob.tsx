import { useCallback, useEffect, useRef, useState } from 'react';

const GOLD = '#E8A030';
const TRACK = '#2A2A2A';

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  step?: number;
  /** Logarithmic response (for frequencies). min must be > 0. */
  log?: boolean;
  label?: string;
  unit?: string;
  format?: (v: number) => string;
  size?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function toNorm(v: number, min: number, max: number, log: boolean): number {
  if (log) return (Math.log(v / min)) / Math.log(max / min);
  return (v - min) / (max - min);
}
function fromNorm(n: number, min: number, max: number, log: boolean): number {
  const c = Math.max(0, Math.min(1, n));
  if (log) return min * Math.pow(max / min, c);
  return min + c * (max - min);
}

/** iZotope-style rotary knob with a gold value arc. Drag vertically, scroll, or use arrow keys. */
export function Knob({
  value, min, max, defaultValue, step, log = false, label, unit, format,
  size = 56, disabled = false, onChange,
}: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; norm: number } | null>(null);

  const norm = toNorm(value, min, max, log);
  // Arc sweeps 270°: from 135° to 405°
  const startAngle = 135;
  const sweep = 270;
  const angle = startAngle + norm * sweep;

  const applyNorm = useCallback((n: number) => {
    let v = fromNorm(n, min, max, log);
    if (step) v = Math.round(v / step) * step;
    onChange(Math.max(min, Math.min(max, v)));
  }, [min, max, log, step, onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, norm };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const fine = e.shiftKey ? 0.25 : 1;
    const delta = ((dragStart.current.y - e.clientY) / 200) * fine;
    applyNorm(dragStart.current.norm + delta);
  };
  const onPointerUp = () => {
    dragStart.current = null;
    setDragging(false);
  };

  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'ns-resize';
    return () => { document.body.style.cursor = prev; };
  }, [dragging]);

  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    applyNorm(norm + (e.deltaY < 0 ? 0.02 : -0.02) * (e.shiftKey ? 0.25 : 1));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const inc = e.shiftKey ? 0.005 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); applyNorm(norm + inc); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); applyNorm(norm - inc); }
    else if (e.key === 'Home') { e.preventDefault(); applyNorm(0); }
    else if (e.key === 'End') { e.preventDefault(); applyNorm(1); }
  };

  const r = size / 2;
  const arcR = r - 4;
  const display = format
    ? format(value)
    : `${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)}${unit ? ` ${unit}` : ''}`;

  return (
    <div className={`flex flex-col items-center gap-1 select-none ${disabled ? 'opacity-40' : ''}`} style={{ width: Math.max(size + 12, 64) }}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-[#E8A030]/60 rounded-full"
        style={{ width: size, height: size, cursor: disabled ? 'default' : 'ns-resize', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        title="Drag to adjust · double-click to reset · Shift for fine"
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* body */}
          <circle cx={r} cy={r} r={r - 8} fill="#161616" stroke="#333" strokeWidth="1" />
          <circle cx={r} cy={r} r={r - 11} fill="#1D1D1D" />
          {/* track arc */}
          <path d={describeArc(r, r, arcR, startAngle, startAngle + sweep)} fill="none" stroke={TRACK} strokeWidth="3" strokeLinecap="round" />
          {/* value arc */}
          {norm > 0.002 && (
            <path d={describeArc(r, r, arcR, startAngle, angle)} fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
          )}
          {/* pointer */}
          <line
            x1={r + (r - 20) * Math.cos(rad(angle))}
            y1={r + (r - 20) * Math.sin(rad(angle))}
            x2={r + (r - 12) * Math.cos(rad(angle))}
            y2={r + (r - 12) * Math.sin(rad(angle))}
            stroke={GOLD}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {label && <span className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">{label}</span>}
      <span className="text-[11px] font-mono text-[#E8A030] leading-none tabular-nums">{display}</span>
    </div>
  );
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function describeArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const start = { x: cx + r * Math.cos(rad(a0)), y: cy + r * Math.sin(rad(a0)) };
  const end = { x: cx + r * Math.cos(rad(a1)), y: cy + r * Math.sin(rad(a1)) };
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}
