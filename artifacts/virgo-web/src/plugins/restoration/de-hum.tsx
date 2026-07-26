import { useEffect, useRef } from 'react';
import { registerPlugin } from '@/plugins/registry';
import type { PluginUIProps } from '@/lib/plugin-engine/types';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { Knob } from '@/components/plugin/Knob';
import { ToggleSwitch } from '@/components/plugin/ToggleSwitch';

// ─── DSP kernel ──────────────────────────────────────────────────────────────
const KERNEL = `
(sampleRate) => {
  // IIR biquad notch filter bank for 50/60 Hz hum and harmonics.
  // Up to 5 harmonics are tracked: f0, 2f0, 3f0, 4f0, 5f0.
  // Each notch uses a biquad with adjustable bandwidth (Q).
  //
  // Biquad notch coefficients (Audio EQ Cookbook):
  //   b0 = 1,  b1 = -2cos(w0),  b2 = 1
  //   a0 = 1 + alpha,  a1 = -2cos(w0),  a2 = 1 - alpha
  //   where alpha = sin(w0)/(2*Q)

  const MAX_HARMONICS = 5;
  const MAX_CH = 2;
  // Filter state: [ch][harmonic] → {x1,x2,y1,y2}
  const states = [];
  for (let c = 0; c < MAX_CH; c++) {
    states.push([]);
    for (let h = 0; h < MAX_HARMONICS; h++) states[c].push({ x1:0,x2:0,y1:0,y2:0 });
  }
  // Cache coefficients to avoid recomputing every block unless params change
  let cachedF0 = -1, cachedQ = -1, cachedHarmonics = -1;
  const coefs = []; // [{b0,b1,b2,a0,a1,a2}]

  function buildCoefs(f0, Q, nH) {
    const result = [];
    for (let h = 1; h <= nH; h++) {
      const f  = f0 * h;
      if (f >= sampleRate / 2) break;
      const w0    = 2 * Math.PI * f / sampleRate;
      const cosW0 = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * Q);
      const a0inv = 1 / (1 + alpha);
      result.push({
        b0:  1        * a0inv,
        b1: -2*cosW0  * a0inv,
        b2:  1        * a0inv,
        a1: -2*cosW0  * a0inv,
        a2: (1-alpha) * a0inv,
      });
    }
    return result;
  }

  return {
    process(input, output, params) {
      const f0        = (params.frequency ?? 0) > 0.5 ? 60 : 50;
      const Q         = Math.max(5, Math.min(100, params.Q         ?? 30));
      const harmonics = Math.max(1, Math.min(5,   Math.round(params.harmonics ?? 3)));
      const depth     = Math.max(0, Math.min(1,   params.depth     ?? 1.0));
      const mix       = Math.max(0, Math.min(1,   params.mix       ?? 1.0));
      const noiseOnly = (params.noiseOnly ?? 0) > 0.5;

      if (f0 !== cachedF0 || Q !== cachedQ || harmonics !== cachedHarmonics) {
        coefs.length = 0;
        const built = buildCoefs(f0, Q, harmonics);
        for (const c of built) coefs.push(c);
        cachedF0 = f0; cachedQ = Q; cachedHarmonics = harmonics;
      }

      for (let ch = 0; ch < output.length; ch++) {
        const inp = input[ch] || input[0];
        const out = output[ch];
        const n   = out.length;
        const st  = states[Math.min(ch, 1)];

        for (let i = 0; i < n; i++) {
          let s = inp[i];
          // chain all notch filters
          for (let h = 0; h < coefs.length; h++) {
            const c = coefs[h];
            const sv = st[h];
            const y = c.b0*s + c.b1*sv.x1 + c.b2*sv.x2
                             - c.a1*sv.y1 - c.a2*sv.y2;
            sv.x2 = sv.x1; sv.x1 = s;
            sv.y2 = sv.y1; sv.y1 = y;
            s = y;
          }
          // depth blend: s is fully filtered; inp[i] is dry
          const wet = inp[i] + (s - inp[i]) * depth;
          const mixed = inp[i] + (wet - inp[i]) * mix;
          out[i] = noiseOnly ? (inp[i] - mixed) : mixed;
        }
      }
    }
  };
}
`;

// ─── Controls UI ─────────────────────────────────────────────────────────────
const HUM_FREQS_50 = [50, 100, 150, 200, 250];
const HUM_FREQS_60 = [60, 120, 180, 240, 300];

function DeHumControls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const is60Hz = (params.frequency ?? 0) > 0.5;
  const freqs = is60Hz ? HUM_FREQS_60 : HUM_FREQS_50;
  const harmonicsCount = Math.round(params.harmonics ?? 3);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr); }

      ctx.clearRect(0, 0, W, H);

      const MIN_FREQ = 20, MAX_FREQ = 20000;
      function freqToX(f: number) {
        return (Math.log(f / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ)) * W;
      }

      // Draw notch lines for active harmonics
      for (let h = 0; h < harmonicsCount && h < freqs.length; h++) {
        const f = freqs[h];
        const x = freqToX(f);
        // wider glow for lower harmonics
        const alpha = 1 - h * 0.15;
        ctx.strokeStyle = `rgba(232,160,48,${alpha})`;
        ctx.lineWidth = h === 0 ? 2 : 1.5;
        ctx.setLineDash(h === 0 ? [] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = `rgba(232,160,48,${alpha})`;
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(`${f}`, x + 3, 12 + h * 10);
      }
    };

    const id = setInterval(draw, 100);
    return () => clearInterval(id);
  }, [params.frequency, params.harmonics, freqs, harmonicsCount]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Spectrum with harmonic overlay */}
      <div className="relative">
        <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={180} />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 pointer-events-none rounded-md"
          style={{ width: '100%', height: 180 }}
        />
      </div>

      {/* 50/60 Hz toggle */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-[11px] text-white/40 font-mono">50 Hz</span>
        <ToggleSwitch
          checked={(params.frequency ?? 0) > 0.5}
          onChange={(v) => setParam('frequency', v ? 1 : 0)}
        />
        <span className="text-[11px] text-white/40 font-mono">60 Hz</span>
        <span className="ml-auto text-[10px] text-white/30 font-mono">
          {is60Hz ? '60 Hz (US/Japan)' : '50 Hz (EU/UK)'}
        </span>
      </div>

      {/* Knobs */}
      <div className="grid grid-cols-4 gap-4 justify-items-center">
        <Knob label="Harmonics" value={params.harmonics ?? 3}
          min={1} max={5} defaultValue={3} step={1}
          format={(v) => `${Math.round(v)}×`}
          onChange={(v) => setParam('harmonics', v)} />
        <Knob label="Q" value={params.Q ?? 30}
          min={5} max={100} defaultValue={30} step={1}
          onChange={(v) => setParam('Q', v)} />
        <Knob label="Depth" value={params.depth ?? 1.0}
          min={0} max={1.0} defaultValue={1.0} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setParam('depth', v)} />
        <Knob label="Mix" value={params.mix ?? 1.0}
          min={0} max={1.0} defaultValue={1.0} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setParam('mix', v)} />
      </div>
    </div>
  );
}

// ─── Registration ─────────────────────────────────────────────────────────────
registerPlugin({
  id: 'de-hum',
  name: 'VA De-hum',
  category: 'restoration',
  tagline: 'Hum & buzz removal',
  description: 'Adaptive IIR biquad notch filter bank targeting 50/60 Hz mains hum and its harmonics. Eliminates ground hum, fluorescent buzz and electrical interference with adjustable harmonic depth and Q.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'frequency', label: 'Grid',      min: 0,  max: 1,   default: 0,   step: 1,    format: (v) => v > 0.5 ? '60 Hz' : '50 Hz' },
    { id: 'harmonics', label: 'Harmonics', min: 1,  max: 5,   default: 3,   step: 1,    format: (v) => `${Math.round(v)}×` },
    { id: 'Q',         label: 'Q',         min: 5,  max: 100, default: 30,  step: 1 },
    { id: 'depth',     label: 'Depth',     min: 0,  max: 1.0, default: 1.0, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'mix',       label: 'Mix',       min: 0,  max: 1.0, default: 1.0, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'noiseOnly', label: 'Diff',      min: 0,  max: 1,   default: 0,   step: 1 },
  ],
  factoryPresets: [
    { name: 'Default',        params: { frequency: 0, harmonics: 3, Q: 30, depth: 1.0, mix: 1.0 } },
    { name: '60 Hz US',       params: { frequency: 1, harmonics: 3, Q: 30, depth: 1.0, mix: 1.0 } },
    { name: '60 Hz Ground Loop', params: { frequency: 1, harmonics: 5, Q: 50, depth: 1.0, mix: 1.0 } },
    { name: 'Narrow 50 Hz',   params: { frequency: 0, harmonics: 4, Q: 80, depth: 1.0, mix: 1.0 } },
  ],
  Controls: DeHumControls,
});
