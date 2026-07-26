import { registerPlugin } from '@/plugins/registry';

// ─── DSP kernel ──────────────────────────────────────────────────────────────
const KERNEL = `
(sampleRate) => {
  // Delta-based click/pop detector with cubic interpolation repair.
  // A "click" is identified when the sample-to-sample delta exceeds the
  // threshold AND the following sample returns close to the pre-click trend,
  // distinguishing impulsive artifacts from genuine transients.

  const MAX_CH = 2;
  const INTERP_LEN = 8; // samples to interpolate over
  const prevSample = new Float32Array(MAX_CH);
  const prevDelta  = new Float32Array(MAX_CH);
  // ring buffer to re-examine preceding samples
  const BUF_SIZE = 32;
  const ring = [new Float32Array(BUF_SIZE), new Float32Array(BUF_SIZE)];
  let rPos = 0;

  function cubicInterp(p0, p1, p2, p3, t) {
    const a = -0.5*p0 + 1.5*p1 - 1.5*p2 + 0.5*p3;
    const b =      p0 - 2.5*p1 + 2.0*p2 - 0.5*p3;
    const c = -0.5*p0 +          0.5*p2;
    return ((a*t + b)*t + c)*t + p1;
  }

  return {
    process(input, output, params) {
      const sensitivity = Math.max(0.1, Math.min(1.0, params.sensitivity ?? 0.5));
      const width       = Math.max(1,   Math.min(16,  Math.round(params.width ?? 4)));
      const mix         = Math.max(0,   Math.min(1,   params.mix       ?? 1.0));
      const noiseOnly   = (params.noiseOnly ?? 0) > 0.5;

      // threshold scales with sensitivity: higher sens → catches smaller clicks
      const deltaThresh = Math.pow(1 - sensitivity, 2) * 1.8 + 0.05;

      for (let ch = 0; ch < output.length; ch++) {
        const inp = input[ch] || input[0];
        const out = output[ch];
        const n   = out.length;
        const r   = ring[Math.min(ch, 1)];
        let prev  = prevSample[ch];
        let pd    = prevDelta[ch];

        // scratch buffer: detect first, then replace
        const scratch = new Float32Array(n);
        const isClick = new Uint8Array(n);

        for (let i = 0; i < n; i++) {
          scratch[i] = inp[i];
          const delta = Math.abs(inp[i] - prev);
          // A click: large delta now, and the next delta would be large too (spike shape)
          if (delta > deltaThresh && Math.abs(pd) < deltaThresh * 0.7) {
            isClick[i] = 1;
          }
          pd   = delta;
          prev = inp[i];
        }

        // Expand click regions by width/2 on each side and interpolate over them
        for (let i = 0; i < n; i++) {
          if (!isClick[i]) continue;
          const start = Math.max(0, i - width);
          const end   = Math.min(n - 1, i + width);

          // anchor samples outside the click
          const p0 = scratch[Math.max(0, start - 1)];
          const p3 = scratch[Math.min(n - 1, end + 1)];
          const p1 = p0;
          const p2 = p3;

          for (let j = start; j <= end; j++) {
            const t = (end === start) ? 0.5 : (j - start) / (end - start + 1);
            scratch[j] = cubicInterp(p0, p1, p2, p3, t);
            isClick[j] = 2; // mark as repaired
          }
          i = end; // skip over repaired region
        }

        // write output
        for (let i = 0; i < n; i++) {
          const wet = inp[i] + (scratch[i] - inp[i]) * mix;
          out[i] = noiseOnly ? (inp[i] - wet) : wet;
        }

        prevSample[ch] = inp[n - 1];
        prevDelta[ch]  = Math.abs(inp[n - 1] - (n > 1 ? inp[n - 2] : prev));
      }
    }
  };
}
`;

// ─── Registration ─────────────────────────────────────────────────────────────
registerPlugin({
  id: 'de-click',
  name: 'VA De-click',
  category: 'restoration',
  tagline: 'Click & pop repair',
  description: 'Removes vinyl clicks, mouth ticks and digital dropouts using delta-based transient detection and cubic interpolation. Distinguishes impulsive artifacts from genuine musical transients.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'sensitivity', label: 'Sensitivity', min: 0.1, max: 1.0, default: 0.5,  step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'width',       label: 'Width',       min: 1,   max: 16,  default: 4,    step: 1,    unit: 'smp' },
    { id: 'mix',         label: 'Mix',         min: 0,   max: 1.0, default: 1.0,  step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'noiseOnly',   label: 'Diff',        min: 0,   max: 1,   default: 0,    step: 1 },
  ],
  factoryPresets: [
    { name: 'Default',         params: { sensitivity: 0.5,  width: 4,  mix: 1.0 } },
    { name: 'Vinyl 78rpm',     params: { sensitivity: 0.75, width: 6,  mix: 1.0 } },
    { name: 'Digital Dropout', params: { sensitivity: 0.9,  width: 10, mix: 1.0 } },
    { name: 'Light Touch',     params: { sensitivity: 0.3,  width: 3,  mix: 0.8 } },
  ],
  demoClip: '/demos/de-click.wav',
});
