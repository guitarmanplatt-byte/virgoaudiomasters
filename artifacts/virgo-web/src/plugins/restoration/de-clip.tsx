import { useEffect, useRef } from 'react';
import { registerPlugin } from '@/plugins/registry';
import type { PluginUIProps } from '@/lib/plugin-engine/types';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { Knob } from '@/components/plugin/Knob';

// ─── DSP kernel ──────────────────────────────────────────────────────────────
const KERNEL = `
(sampleRate) => {
  // Hermite cubic spline de-clipper.
  // Detects flat-top clipped regions and reconstructs via cubic interpolation.
  const HISTORY = 8;
  const hist = [new Float32Array(HISTORY), new Float32Array(HISTORY)];
  let hPos = 0;

  function hermite(x0, x1, x2, x3, t) {
    const c0 = x1;
    const c1 = 0.5 * (x2 - x0);
    const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
    const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
    return ((c3 * t + c2) * t + c1) * t + c0;
  }

  return {
    process(input, output, params) {
      const threshold = Math.max(0.1, Math.min(1.0, params.threshold ?? 0.95));
      const recovery  = Math.max(0.5, Math.min(4.0, params.recovery  ?? 1.5));
      const mix       = Math.max(0.0, Math.min(1.0, params.mix       ?? 1.0));
      const ceiling   = Math.max(0.5, Math.min(1.0, params.ceiling   ?? 0.98));
      const noiseOnly = (params.noiseOnly ?? 0) > 0.5;

      for (let ch = 0; ch < output.length; ch++) {
        const inp = input[ch] || input[0];
        const out = output[ch];
        const n   = out.length;
        const h   = hist[Math.min(ch, 1)];

        let clipRun = 0;
        let clipSign = 1;

        for (let i = 0; i < n; i++) {
          const s = inp[i];
          const absS = Math.abs(s);
          hPos = (hPos + 1) & (HISTORY - 1);
          h[hPos] = s;

          if (absS >= threshold) {
            // clipped sample — count run, sign direction
            clipRun++;
            clipSign = s > 0 ? 1 : -1;
          } else {
            clipRun = 0;
          }

          let recon = s;
          if (absS >= threshold) {
            // Pull 4 history samples (before the clip region)
            const i0 = (hPos - 4 + HISTORY) & (HISTORY - 1);
            const i1 = (hPos - 3 + HISTORY) & (HISTORY - 1);
            const i2 = (hPos - 2 + HISTORY) & (HISTORY - 1);
            const i3 = (hPos - 1 + HISTORY) & (HISTORY - 1);
            const t  = Math.min(1.0, clipRun / (recovery * 4));
            // Project forward using Hermite extrapolation
            const proj = hermite(h[i0], h[i1], h[i2], h[i3], 1.0 + t);
            // Blend toward a shaped peak  
            const peak = clipSign * threshold * (1 + Math.sin(t * Math.PI) * 0.15);
            recon = proj * (1 - t) + peak * t;
          }

          // mix wet/dry
          const wet = s + (recon - s) * mix;
          const clamped = Math.max(-ceiling, Math.min(ceiling, wet));
          out[i] = noiseOnly ? (s - wet) : clamped;
        }
      }
    }
  };
}
`;

// ─── Controls UI ─────────────────────────────────────────────────────────────
function DeClipControls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr); }
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0C0C0C';
      ctx.fillRect(0, 0, W, H);

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = (i / 4) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // threshold line
      const thr = params.threshold ?? 0.95;
      const thrY = (1 - thr) * (H / 2);
      ctx.strokeStyle = '#E8A030';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, thrY); ctx.lineTo(W, thrY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H - thrY); ctx.lineTo(W, H - thrY); ctx.stroke();
      ctx.setLineDash([]);

      // label
      ctx.fillStyle = '#E8A030';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(`clip at ±${(thr * 100).toFixed(0)}%`, 6, thrY - 4);
    };
    const id = setInterval(draw, 80);
    return () => clearInterval(id);
  }, [params.threshold]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Waveform / threshold canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full rounded-md border border-[#242424]"
          style={{ height: 80 }}
        />
        <span className="absolute top-2 right-3 text-[9px] text-white/30 font-mono">CLIP ZONE</span>
      </div>

      {/* Spectrum: input vs output */}
      <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={160} />

      {/* Knobs */}
      <div className="grid grid-cols-4 gap-4 justify-items-center pt-2">
        <Knob label="Threshold" value={params.threshold ?? 0.95}
          min={0.5} max={1.0} defaultValue={0.95} step={0.01}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => setParam('threshold', v)} />
        <Knob label="Recovery" value={params.recovery ?? 1.5}
          min={0.5} max={4.0} defaultValue={1.5} step={0.1}
          format={(v) => `${v.toFixed(1)}x`}
          onChange={(v) => setParam('recovery', v)} />
        <Knob label="Ceiling" value={params.ceiling ?? 0.98}
          min={0.5} max={1.0} defaultValue={0.98} step={0.01}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => setParam('ceiling', v)} />
        <Knob label="Mix" value={params.mix ?? 1.0}
          min={0.0} max={1.0} defaultValue={1.0} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setParam('mix', v)} />
      </div>
    </div>
  );
}

// ─── Registration ─────────────────────────────────────────────────────────────
registerPlugin({
  id: 'de-clip',
  name: 'VA De-clip',
  category: 'restoration',
  tagline: 'Clipping repair',
  description: 'Rebuilds waveform peaks lost to analog or digital clipping using Hermite cubic spline reconstruction. Restores transients and natural dynamics damaged by over-limiting.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'threshold', label: 'Threshold', min: 0.5,  max: 1.0, default: 0.95, step: 0.01, format: (v) => `${(v * 100).toFixed(0)}%` },
    { id: 'recovery',  label: 'Recovery',  min: 0.5,  max: 4.0, default: 1.5,  step: 0.1,  format: (v) => `${v.toFixed(1)}x` },
    { id: 'ceiling',   label: 'Ceiling',   min: 0.5,  max: 1.0, default: 0.98, step: 0.01, format: (v) => `${(v * 100).toFixed(0)}%` },
    { id: 'mix',       label: 'Mix',       min: 0.0,  max: 1.0, default: 1.0,  step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'noiseOnly', label: 'Diff',      min: 0,    max: 1,   default: 0,    step: 1 },
  ],
  factoryPresets: [
    { name: 'Default',         params: { threshold: 0.95, recovery: 1.5, ceiling: 0.98, mix: 1.0 } },
    { name: 'Mild Clip Fix',   params: { threshold: 0.98, recovery: 1.0, ceiling: 1.0,  mix: 0.7 } },
    { name: 'Heavy Restore',   params: { threshold: 0.85, recovery: 2.5, ceiling: 0.95, mix: 1.0 } },
    { name: 'Broadcast Safe',  params: { threshold: 0.90, recovery: 2.0, ceiling: 0.93, mix: 1.0 } },
  ],
  Controls: DeClipControls,
});
