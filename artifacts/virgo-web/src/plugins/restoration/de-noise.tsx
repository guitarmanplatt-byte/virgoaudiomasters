import { useEffect, useRef } from 'react';
import { registerPlugin } from '@/plugins/registry';
import type { PluginUIProps } from '@/lib/plugin-engine/types';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { Knob } from '@/components/plugin/Knob';

// ─── DSP kernel ──────────────────────────────────────────────────────────────
const KERNEL = `
(sampleRate) => {
  // Multi-band spectral noise gate.
  //
  // Signal is split into 4 octave bands via first-order Linkwitz–Riley style
  // crossovers (two cascaded first-order IIRs per split → 12 dB/oct).
  // Each band has an independent leaky-integrator envelope follower tracking
  // the noise floor; when the band energy drops below (floor + threshold),
  // that band's gain is reduced to (1 - reduction).
  //
  // Bands (approximate crossovers): 0–250 Hz, 250–1k, 1k–4k, 4k–Nyquist.

  const BANDS = 4;
  const MAX_CH = 2;
  const CROSS = [250, 1000, 4000]; // Hz

  // 2-pole LP/HP state per band per channel: [ch][band] = {lp1a, lp1b, lp2a, lp2b, ...}
  // We track: lp1a, lp2a (LP), hp1a, hp2a (HP) for the cascaded first-order stages
  function makeState() {
    const s = [];
    for (let c = 0; c < MAX_CH; c++) {
      s.push([]);
      for (let b = 0; b < BANDS; b++) {
        // Each band has up to 2 split filter states (LP pole1, LP pole2)
        s[c].push({ lp1: 0, lp2: 0, hp1: 0, hp2: 0, env: 0, noiseFloor: 0.0005 });
      }
    }
    return s;
  }
  const state = makeState();

  // Precompute LP coefficients for each crossover
  const lpCoef = CROSS.map(f => {
    const w = 2 * Math.PI * f / sampleRate;
    return w / (w + 1);
  });

  return {
    process(input, output, params) {
      const threshold  = Math.max(0,    Math.min(60,  params.threshold  ?? 12)); // dB above noise floor
      const reduction  = Math.max(0,    Math.min(1.0, params.reduction  ?? 0.9));
      const release    = Math.max(10,   Math.min(1000, params.release   ?? 150)); // ms
      const learn      = Math.max(0.001,Math.min(0.1, params.learn      ?? 0.01)); // noise floor adaptation rate
      const mix        = Math.max(0,    Math.min(1,   params.mix        ?? 1.0));
      const noiseOnly  = (params.noiseOnly ?? 0) > 0.5;

      const thrLinear  = Math.pow(10, threshold / 20);
      const envRelease = Math.exp(-1 / ((release / 1000) * sampleRate));
      const envAttack  = Math.exp(-1 / (0.002 * sampleRate)); // 2ms attack

      for (let ch = 0; ch < output.length; ch++) {
        const inp = input[ch] || input[0];
        const out = output[ch];
        const n   = out.length;
        const st  = state[Math.min(ch, 1)];

        for (let i = 0; i < n; i++) {
          const s = inp[i];

          // ── Band splitting via cascaded first-order LP/HP ──────────────────
          // Band 0: LP below CROSS[0]
          let res0lp = st[0].lp2 + lpCoef[0] * (s         - st[0].lp2);
          let res0   = res0lp; // LP band

          // Band 1: HP(CROSS[0]) → LP(CROSS[1])
          let hp0    = s - (st[0].lp1 + lpCoef[0] * (s - st[0].lp1));
          let res1lp = st[1].lp2 + lpCoef[1] * (hp0       - st[1].lp2);
          let res1   = res1lp;

          // Band 2: HP(CROSS[1]) → LP(CROSS[2])
          let hp1    = hp0 - (st[1].lp1 + lpCoef[1] * (hp0 - st[1].lp1));
          let res2lp = st[2].lp2 + lpCoef[2] * (hp1       - st[2].lp2);
          let res2   = res2lp;

          // Band 3: HP(CROSS[2]) — high shelf
          let res3   = hp1 - (st[2].lp1 + lpCoef[2] * (hp1 - st[2].lp1));

          // Update filter states
          st[0].lp1 = st[0].lp2;
          st[0].lp2 = res0lp;
          st[1].lp1 = st[1].lp2;
          st[1].lp2 = res1lp;
          st[2].lp1 = st[2].lp2;
          st[2].lp2 = res2lp;

          const bands = [res0, res1, res2, res3];
          let out_s = 0;

          for (let b = 0; b < BANDS; b++) {
            const bv  = bands[b];
            const abv = Math.abs(bv);
            const bst = st[b];

            // Envelope follower
            bst.env = abv > bst.env
              ? bst.env * envAttack + abv * (1 - envAttack)
              : bst.env * envRelease + abv * (1 - envRelease);

            // Slowly adapt noise floor estimate (leaky min tracking)
            bst.noiseFloor = bst.noiseFloor * (1 - learn) + Math.min(bst.env, bst.noiseFloor + 0.0001) * learn;

            // Gate: is band above threshold?
            const gate = bst.env > (bst.noiseFloor * thrLinear) ? 1.0 : (1.0 - reduction);
            out_s += bv * gate;
          }

          const wet = s + (out_s - s) * mix;
          out[i] = noiseOnly ? (s - wet) : wet;
        }
      }
    }
  };
}
`;

// ─── Controls UI ─────────────────────────────────────────────────────────────
function DeNoiseControls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Draw noise floor indicator line overlay on top of the spectrum
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

      // Noise gate floor visualisation line
      // threshold param is in dB relative to noise floor; map it to canvas dB position
      const threshold = params.threshold ?? 12;
      // Represent as a reference line positioned in the lower dB region
      // Assume noise floor ~ -60 dBFS; threshold adds above that
      const floorDb = -60 + threshold;
      const MIN_DB = -90, MAX_DB = 0;
      const y = ((MAX_DB - floorDb) / (MAX_DB - MIN_DB)) * H;

      ctx.strokeStyle = 'rgba(232,160,48,0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(232,160,48,0.8)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(`noise gate  ${floorDb > 0 ? '+' : ''}${floorDb.toFixed(0)} dBFS`, 6, y - 4);
    };

    const id = setInterval(draw, 80);
    return () => clearInterval(id);
  }, [params.threshold]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Spectrum with noise floor overlay */}
      <div className="relative">
        <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={190} />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 pointer-events-none rounded-md"
          style={{ width: '100%', height: 190 }}
        />
      </div>

      {/* Knobs */}
      <div className="grid grid-cols-4 gap-4 justify-items-center">
        <Knob label="Threshold" value={params.threshold ?? 12}
          min={0} max={60} defaultValue={12} step={0.5}
          unit="dB"
          onChange={(v) => setParam('threshold', v)} />
        <Knob label="Reduction" value={params.reduction ?? 0.9}
          min={0} max={1.0} defaultValue={0.9} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setParam('reduction', v)} />
        <Knob label="Release" value={params.release ?? 150}
          min={10} max={1000} defaultValue={150} step={10}
          unit="ms"
          onChange={(v) => setParam('release', v)} />
        <Knob label="Adapt" value={params.learn ?? 0.01}
          min={0.001} max={0.1} defaultValue={0.01} step={0.001}
          format={(v) => v.toFixed(3)}
          onChange={(v) => setParam('learn', v)} />
      </div>
    </div>
  );
}

// ─── Registration ─────────────────────────────────────────────────────────────
registerPlugin({
  id: 'de-noise',
  name: 'VA De-noise',
  category: 'restoration',
  tagline: 'Broadband noise removal',
  description: 'Multi-band spectral noise gate with adaptive noise floor tracking. Splits audio into 4 octave bands and independently gates each band below the learnable noise threshold. Ideal for tape hiss, room noise and broadband interference.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'threshold', label: 'Threshold', min: 0,    max: 60,  default: 12,  step: 0.5,  unit: 'dB' },
    { id: 'reduction', label: 'Reduction', min: 0,    max: 1.0, default: 0.9, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'release',   label: 'Release',   min: 10,   max: 1000, default: 150, step: 10,  unit: 'ms' },
    { id: 'learn',     label: 'Adapt',     min: 0.001, max: 0.1, default: 0.01, step: 0.001, format: (v) => v.toFixed(3) },
    { id: 'mix',       label: 'Mix',       min: 0,    max: 1.0, default: 1.0, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'noiseOnly', label: 'Diff',      min: 0,    max: 1,   default: 0,   step: 1 },
  ],
  factoryPresets: [
    { name: 'Default',       params: { threshold: 12, reduction: 0.9,  release: 150, learn: 0.01 } },
    { name: 'Tape Hiss',     params: { threshold: 18, reduction: 0.85, release: 200, learn: 0.005 } },
    { name: 'Room Noise',    params: { threshold: 10, reduction: 0.75, release: 300, learn: 0.02  } },
    { name: 'Aggressive',    params: { threshold: 24, reduction: 1.0,  release: 80,  learn: 0.03  } },
  ],
  Controls: DeNoiseControls,
  demoClip: '/demos/de-noise.wav',
});
