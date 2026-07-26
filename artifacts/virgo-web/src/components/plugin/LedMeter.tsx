import { useEffect, useRef } from 'react';

export interface LedMeterProps {
  analyser: AnalyserNode | null;
  label?: string;
  height?: number;
}

const MIN_DB = -60;

/**
 * Stereo LED-style peak meter driven by an AnalyserNode (time-domain peak with
 * decaying peak-hold marker). Green → amber → gold → red segments.
 */
export function LedMeter({ analyser, label, height = 160 }: LedMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peakHold = useRef({ v: MIN_DB, t: 0 });
  const smooth = useRef(MIN_DB);

  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(analyser ? analyser.fftSize : 2048);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr); }
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, 0, W, H);

      let db = MIN_DB;
      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const a = Math.abs(buf[i]);
          if (a > peak) peak = a;
        }
        db = peak > 0 ? Math.max(MIN_DB, 20 * Math.log10(peak)) : MIN_DB;
      }

      // fast attack, slow release
      smooth.current = db > smooth.current ? db : smooth.current - 0.7;
      const now = performance.now();
      if (db >= peakHold.current.v || now - peakHold.current.t > 1500) {
        peakHold.current = { v: db, t: now };
      }

      const norm = (v: number) => (v - MIN_DB) / -MIN_DB;
      const segments = 26;
      const segH = (H - 4) / segments;
      const litCount = Math.round(norm(smooth.current) * segments);

      for (let i = 0; i < segments; i++) {
        const y = H - 2 - (i + 1) * segH;
        const segDb = MIN_DB + ((i + 1) / segments) * -MIN_DB;
        let color: string;
        if (segDb > -3) color = '#E04040';
        else if (segDb > -9) color = '#E8A030';
        else if (segDb > -20) color = '#C8B060';
        else color = '#3F8A50';
        ctx.fillStyle = i < litCount ? color : 'rgba(255,255,255,0.05)';
        ctx.fillRect(3, y + 1, W - 6, Math.max(1, segH - 2));
      }

      // peak hold marker
      if (peakHold.current.v > MIN_DB + 1) {
        const y = H - 2 - norm(peakHold.current.v) * (H - 4);
        ctx.fillStyle = '#FFF0D0';
        ctx.fillRect(3, y, W - 6, 1.5);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        className="rounded-sm border border-[#2A2A2A]"
        style={{ width: 16, height }}
      />
      {label && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>}
    </div>
  );
}
