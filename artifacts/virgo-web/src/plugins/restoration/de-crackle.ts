import { registerPlugin } from '@/plugins/registry';

// ─── DSP kernel ──────────────────────────────────────────────────────────────
const KERNEL = `
(sampleRate) => {
  // Median-filter based de-crackler.
  // Surface noise and crackle appears as short-duration, high-frequency
  // impulses scattered across the waveform. A median filter outperforms a
  // mean filter for these: it ignores outliers completely.
  //
  // Algorithm: for each sample, compute the median of a window of nearby
  // samples. If the current sample deviates by more than the threshold,
  // blend it toward the median by the repair amount.

  // Per-channel ring buffers and write positions.
  // MAX_WIN must be >= the largest winLen (2*4+1 = 9).
  const MAX_WIN = 9;
  const MAX_CH  = 2;
  const rings   = [new Float32Array(MAX_WIN), new Float32Array(MAX_WIN)];
  const wPos    = new Int32Array(MAX_CH); // per-channel write cursor
  const sorted  = new Float32Array(MAX_WIN);

  function median(buf, len) {
    for (let i = 0; i < len; i++) sorted[i] = buf[i];
    // insertion sort — tiny fixed-size array, O(n²) is fine
    for (let i = 1; i < len; i++) {
      const key = sorted[i];
      let j = i - 1;
      while (j >= 0 && sorted[j] > key) { sorted[j + 1] = sorted[j]; j--; }
      sorted[j + 1] = key;
    }
    return sorted[len >> 1];
  }

  return {
    process(input, output, params) {
      const threshold = Math.max(0.001, Math.min(0.5,  params.threshold ?? 0.05));
      const repair    = Math.max(0.0,   Math.min(1.0,  params.repair    ?? 0.8));
      const winHalf   = Math.max(1,     Math.min(4,    Math.round(params.window ?? 2)));
      const mix       = Math.max(0,     Math.min(1,    params.mix       ?? 1.0));
      const noiseOnly = (params.noiseOnly ?? 0) > 0.5;
      const winLen    = winHalf * 2 + 1; // 3, 5, 7, or 9

      for (let ch = 0; ch < output.length; ch++) {
        const inp = input[ch] || input[0];
        const out = output[ch];
        const n   = out.length;
        const buf = rings[Math.min(ch, MAX_CH - 1)];
        let   wp  = wPos[Math.min(ch, MAX_CH - 1)];

        for (let i = 0; i < n; i++) {
          // Write new sample into the ring buffer, advance cursor
          buf[wp % winLen] = inp[i];
          wp++;

          const med  = median(buf, winLen);
          const diff = Math.abs(inp[i] - med);

          let s = inp[i];
          if (diff > threshold) {
            s = inp[i] + (med - inp[i]) * repair;
          }

          const wet = inp[i] + (s - inp[i]) * mix;
          out[i] = noiseOnly ? (inp[i] - wet) : wet;
        }

        // Persist the advanced write cursor for the next block
        wPos[Math.min(ch, MAX_CH - 1)] = wp;
      }
    }
  };
}
`;

// ─── Registration ─────────────────────────────────────────────────────────────
registerPlugin({
  id: 'de-crackle',
  name: 'VA De-crackle',
  category: 'restoration',
  tagline: 'Surface noise & crackle',
  description: 'Removes surface crackle, vinyl noise and scattered impulsive artifacts using an adaptive median filter. Preserves musical transients while smoothing out scattered high-frequency noise bursts.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'threshold', label: 'Threshold', min: 0.001, max: 0.5, default: 0.05, step: 0.001, format: (v) => v < 0.01 ? v.toFixed(3) : v.toFixed(2) },
    { id: 'repair',    label: 'Repair',    min: 0.0,   max: 1.0, default: 0.8,  step: 0.01,  format: (v) => `${Math.round(v * 100)}%` },
    { id: 'window',    label: 'Window',    min: 1,     max: 4,   default: 2,    step: 1,     unit: 'smp' },
    { id: 'mix',       label: 'Mix',       min: 0,     max: 1.0, default: 1.0,  step: 0.01,  format: (v) => `${Math.round(v * 100)}%` },
    { id: 'noiseOnly', label: 'Diff',      min: 0,     max: 1,   default: 0,    step: 1 },
  ],
  factoryPresets: [
    { name: 'Default',      params: { threshold: 0.05,  repair: 0.8, window: 2, mix: 1.0 } },
    { name: 'Vinyl Light',  params: { threshold: 0.04,  repair: 0.7, window: 2, mix: 1.0 } },
    { name: 'Vinyl Heavy',  params: { threshold: 0.08,  repair: 0.9, window: 3, mix: 1.0 } },
    { name: 'Shellac 78',   params: { threshold: 0.12,  repair: 1.0, window: 4, mix: 1.0 } },
  ],
  demoClip: '/demos/de-crackle.wav',
});
