import { useEffect, useRef } from 'react';

export interface SpectrumAnalyzerProps {
  analyser: AnalyserNode | null;
  /** Optional second analyser drawn dimmed behind (e.g. input vs output). */
  referenceAnalyser?: AnalyserNode | null;
  height?: number;
  className?: string;
}

const MIN_DB = -90;
const MAX_DB = 0;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;

/** Real-time FFT spectrum analyzer canvas in the black & gold theme. */
export function SpectrumAnalyzer({ analyser, referenceAnalyser, height = 220, className }: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const bins = analyser ? analyser.frequencyBinCount : 1024;
    const data = new Float32Array(bins);
    const refData = new Float32Array(bins);

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
      ctx.fillStyle = '#0C0C0C';
      ctx.fillRect(0, 0, W, H);

      // grid: octave lines + dB lines
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.lineWidth = 1;
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = freqToX(f, W);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, H - 4);
      }
      for (const db of [-12, -24, -36, -48, -60, -72]) {
        const y = dbToY(db, H);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.fillText(`${db}`, 4, y - 2);
      }

      const sr = analyser?.context.sampleRate ?? 48000;

      const drawCurve = (arr: Float32Array, stroke: string, fill: string | null) => {
        ctx.beginPath();
        let started = false;
        for (let px = 0; px <= W; px += 2) {
          const f = xToFreq(px, W);
          const bin = Math.min(bins - 1, Math.round((f / (sr / 2)) * bins));
          const db = Math.max(MIN_DB, Math.min(MAX_DB, arr[bin] ?? MIN_DB));
          const y = dbToY(db, H);
          if (!started) { ctx.moveTo(px, y); started = true; }
          else ctx.lineTo(px, y);
        }
        if (fill) {
          ctx.save();
          ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.restore();
        } else {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      };

      if (referenceAnalyser) {
        referenceAnalyser.getFloatFrequencyData(refData);
        drawCurve(refData, 'rgba(255,255,255,0.22)', null);
      }
      if (analyser) {
        analyser.getFloatFrequencyData(data);
        drawCurve(data, '', 'rgba(232,160,48,0.16)');
        drawCurve(data, '#E8A030', null);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, referenceAnalyser]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full rounded-md border border-[#242424] ${className ?? ''}`}
      style={{ height, background: '#0C0C0C' }}
    />
  );
}

export function freqToX(f: number, w: number): number {
  return (Math.log(f / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ)) * w;
}
export function xToFreq(x: number, w: number): number {
  return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, x / w);
}
function dbToY(db: number, h: number): number {
  return ((MAX_DB - db) / (MAX_DB - MIN_DB)) * h;
}
