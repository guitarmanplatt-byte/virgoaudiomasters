import { useCallback, useRef } from 'react';

export interface FaderProps {
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  label?: string;
  unit?: string;
  height?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** iZotope-style vertical fader with a gold fill and etched track. */
export function Fader({
  value, min, max, defaultValue, label, unit = 'dB', height = 140, disabled = false, onChange,
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const norm = (value - min) / (max - min);

  const setFromClientY = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const n = 1 - (clientY - rect.top) / rect.height;
    const v = min + Math.max(0, Math.min(1, n)) * (max - min);
    onChange(Math.round(v * 10) / 10);
  }, [min, max, onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setFromClientY(e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons & 1) setFromClientY(e.clientY);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const inc = e.shiftKey ? 0.1 : 0.5;
    if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, value + inc)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, value - inc)); }
  };

  return (
    <div className={`flex flex-col items-center gap-1.5 select-none ${disabled ? 'opacity-40' : ''}`}>
      {label && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="relative w-5 rounded-full bg-[#161616] border border-[#2E2E2E] outline-none focus-visible:ring-2 focus-visible:ring-[#E8A030]/60"
        style={{ height, cursor: disabled ? 'default' : 'ns-resize', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      >
        {/* fill */}
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 rounded-full bg-gradient-to-t from-[#E8A030]/40 to-[#E8A030]"
          style={{ height: `${norm * 100}%` }}
        />
        {/* thumb */}
        <div
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-3.5 rounded-sm bg-[#252525] border border-[#E8A030]/70 shadow-md"
          style={{ top: `${(1 - norm) * 100}%` }}
        >
          <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 h-px bg-[#E8A030]" />
        </div>
      </div>
      <span className="text-[11px] font-mono text-[#E8A030] tabular-nums">
        {value > 0 ? '+' : ''}{value.toFixed(1)} {unit}
      </span>
    </div>
  );
}
