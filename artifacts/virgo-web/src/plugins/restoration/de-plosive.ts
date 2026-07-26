import { registerPlugin } from '@/plugins/registry';

// ─── DSP kernel ──────────────────────────────────────────────────────────────
const KERNEL = `
(sampleRate) => {
  // Plosive (P/B pop) detector and suppressor.
  //
  // Plosives are characterised by a burst of very-low-frequency energy
  // (< ~120 Hz) with little or no high-frequency content.  The detector
  // tracks a low-pass envelope and a high-pass envelope; when LP >> HP by
  // more than the sensitivity ratio, a plosive is detected and the output
  // is replaced by the high-pass filtered version (attenuating the thump).
  //
  // Filters are first-order IIR for CPU efficiency.

  const MAX_CH = 2;
  // LP filter state (low-cut ~ 120 Hz)
  const lpState  = new Float32Array(MAX_CH);
  // HP filter state
  const hpState  = new Float32Array(MAX_CH);
  // Envelope followers
  const lpEnv    = new Float32Array(MAX_CH);
  const hpEnv    = new Float32Array(MAX_CH);
  // Gain smoother
  const gainZ    = new Float32Array(MAX_CH).fill(1);

  return {
    process(input, output, params) {
      const sensitivity = Math.max(0.1, Math.min(1.0, params.sensitivity ?? 0.5));
      const crossover   = Math.max(40,  Math.min(300, params.crossover   ?? 120));
      const attenuation = Math.max(0,   Math.min(1.0, params.attenuation ?? 0.7));
      const release     = Math.max(5,   Math.min(200, params.release     ?? 40)); // ms
      const mix         = Math.max(0,   Math.min(1,   params.mix         ?? 1.0));
      const noiseOnly   = (params.noiseOnly ?? 0) > 0.5;

      // IIR coefficient for LP at crossover Hz
      const w  = 2 * Math.PI * crossover / sampleRate;
      const lpC = w / (w + 1); // first-order LP
      const hpC = 1 - lpC;    // complementary HP

      // envelope attack = 1ms, release = param
      const envAttack  = Math.exp(-1 / (0.001 * sampleRate));
      const envRelease = Math.exp(-1 / ((release / 1000) * sampleRate));
      const gainSmooth = Math.exp(-1 / (0.005 * sampleRate)); // 5ms gain smoothing

      // ratio: LP must be N× louder than HP to trigger
      const ratio = 4 + (1 - sensitivity) * 20; // 4–24×

      for (let ch = 0; ch < output.length; ch++) {
        const inp = input[ch] || input[0];
        const out = output[ch];
        const n   = out.length;

        let lp  = lpState[ch];
        let hp  = hpState[ch];
        let lpE = lpEnv[ch];
        let hpE = hpEnv[ch];
        let gz  = gainZ[ch];

        for (let i = 0; i < n; i++) {
          const s = inp[i];
          // LP/HP split
          lp = lp + lpC * (s - lp);
          hp = s - lp;

          // Envelope followers (full-wave rectified)
          const absLp = Math.abs(lp);
          const absHp = Math.abs(hp);
          lpE = absLp > lpE ? lpE + (1 - envAttack) * (absLp - lpE) : lpE * envRelease + (1 - envRelease) * absLp;
          hpE = absHp > hpE ? hpE + (1 - envAttack) * (absHp - hpE) : hpE * envRelease + (1 - envRelease) * absHp;

          // Detect plosive: LP energy dominates heavily over HP
          const isPlosive = (hpE + 1e-9) > 0 && (lpE / (hpE + 1e-9)) > ratio;
          const targetGain = isPlosive ? (1 - attenuation) : 1;

          gz = gz * gainSmooth + targetGain * (1 - gainSmooth);
          const wet = s * gz + hp * (1 - gz); // blend toward HP-only
          out[i] = noiseOnly ? (s - wet) : (inp[i] + (wet - inp[i]) * mix);
        }

        lpState[ch] = lp;
        hpState[ch] = hp;
        lpEnv[ch]   = lpE;
        hpEnv[ch]   = hpE;
        gainZ[ch]   = gz;
      }
    }
  };
}
`;

// ─── Registration ─────────────────────────────────────────────────────────────
registerPlugin({
  id: 'de-plosive',
  name: 'VA De-plosive',
  category: 'restoration',
  tagline: 'Plosive pop removal',
  description: 'Detects and attenuates P/B plosive pops using low-frequency energy detection and high-pass ducking. Preserves vocal clarity while taming microphone proximity blasts and wind noise.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'sensitivity', label: 'Sensitivity', min: 0.1, max: 1.0, default: 0.5,  step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'crossover',   label: 'Crossover',   min: 40,  max: 300, default: 120,  step: 1,    unit: 'Hz' },
    { id: 'attenuation', label: 'Attenuation', min: 0,   max: 1.0, default: 0.7,  step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'release',     label: 'Release',     min: 5,   max: 200, default: 40,   step: 1,    unit: 'ms' },
    { id: 'mix',         label: 'Mix',         min: 0,   max: 1.0, default: 1.0,  step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'noiseOnly',   label: 'Diff',        min: 0,   max: 1,   default: 0,    step: 1 },
  ],
  factoryPresets: [
    { name: 'Default',        params: { sensitivity: 0.5,  crossover: 120, attenuation: 0.7,  release: 40  } },
    { name: 'Vocal Pop',      params: { sensitivity: 0.65, crossover: 100, attenuation: 0.85, release: 30  } },
    { name: 'Wind Noise',     params: { sensitivity: 0.4,  crossover: 80,  attenuation: 0.6,  release: 80  } },
    { name: 'Hard Knock',     params: { sensitivity: 0.8,  crossover: 150, attenuation: 0.9,  release: 20  } },
  ],
  demoClip: '/demos/de-plosive.wav',
});
