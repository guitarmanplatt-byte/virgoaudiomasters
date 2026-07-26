/**
 * VA Clarity — adaptive spectral brightness/presence enhancer. Compares
 * high-band energy against the full-band level and lifts a high shelf when the
 * spectrum is dull, easing off when it is already bright.
 */
import type { PluginDefinition } from '@/lib/plugin-engine/types';
import { fmtHz, fmtPct, BIQUAD_HELPERS } from './kernel-utils';

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}
  var hpDet = makeBiquad();     // detection highpass at the shelf frequency
  var shelf = makeBiquad();     // the applied high shelf
  var lastFreq = -1;
  var lastShelfDb = 1e9;
  var fullEnv = 0, highEnv = 0;
  var lift = 0;                 // smoothed applied lift in dB

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      var freq = params.freq || 4500;
      var amount = Math.max(0, Math.min(1, params.amount || 0));
      var speed = Math.max(0, Math.min(1, params.speed != null ? params.speed : 0.5));
      var mix = Math.max(0, Math.min(1, params.mix != null ? params.mix : 1));
      var maxLift = amount * 9; // up to 9 dB shelf at full amount

      if (freq !== lastFreq) {
        hpDet.c = biquadCoeffs('highpass', freq, 0, 0.707, sampleRate);
        lastFreq = freq;
        lastShelfDb = 1e9;
      }

      // envelope speeds: slow (~800ms) to fast (~60ms)
      var envMs = 800 - speed * 740;
      var eC = envCoef(envMs, sampleRate);
      var liftC = envCoef(envMs * 0.5, sampleRate);

      // compute target lift per block using current envelopes
      for (var i = 0; i < n; i++) {
        var l = inL[i], r = inR[i];
        var mono = (l + r) * 0.5;
        var high = bqTickL(hpDet, mono);
        fullEnv = eC * fullEnv + (1 - eC) * Math.abs(mono);
        highEnv = eC * highEnv + (1 - eC) * Math.abs(high);

        // brightness ratio: dull program -> low ratio -> more lift
        var ratio = fullEnv > 1e-6 ? highEnv / fullEnv : 1;
        // ratio ~0.5+ is bright, ~0.05 is dull
        var dullness = Math.max(0, Math.min(1, (0.4 - ratio) / 0.38));
        var target = fullEnv > 1e-5 ? dullness * maxLift : 0;
        lift = liftC * lift + (1 - liftC) * target;

        // update shelf coefficients when lift moves enough (cheap check)
        if (Math.abs(lift - lastShelfDb) > 0.25) {
          shelf.c = biquadCoeffs('highshelf', freq, lift, 0.707, sampleRate);
          lastShelfDb = lift;
        }

        if (shelf.c) {
          var wl = bqTickL(shelf, l);
          var wr = bqTickR(shelf, r);
          outL[i] = l * (1 - mix) + wl * mix;
          outR[i] = r * (1 - mix) + wr * mix;
        } else {
          outL[i] = l;
          outR[i] = r;
        }
      }
    }
  };
}
`;

export const clarity: PluginDefinition = {
  id: 'clarity',
  name: 'VA Clarity',
  category: 'mastering',
  tagline: 'Adaptive brightness',
  description: 'Spectral clarity enhancer that continuously measures how bright the program is and adaptively lifts a smooth high shelf on dull material — presence without harshness.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'amount', label: 'Amount', min: 0, max: 1, default: 0.4, format: fmtPct },
    { id: 'speed', label: 'Speed', min: 0, max: 1, default: 0.5, format: (v) => (v < 0.33 ? 'Slow' : v < 0.67 ? 'Medium' : 'Fast') },
    { id: 'freq', label: 'Frequency', min: 2000, max: 12000, default: 4500, scale: 'log', format: fmtHz },
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, format: fmtPct },
  ],
  factoryPresets: [
    { name: 'Gentle Open', params: { amount: 0.3, speed: 0.4, freq: 5000, mix: 1 } },
    { name: 'Vocal Presence', params: { amount: 0.5, speed: 0.6, freq: 3500, mix: 1 } },
    { name: 'Dull Mix Rescue', params: { amount: 0.8, speed: 0.5, freq: 4000, mix: 1 } },
    { name: 'Air Band Lift', params: { amount: 0.55, speed: 0.35, freq: 9000, mix: 1 } },
    { name: 'Broadcast Sheen', params: { amount: 0.6, speed: 0.7, freq: 6000, mix: 0.9 } },
    { name: 'Subtle Master Polish', params: { amount: 0.25, speed: 0.3, freq: 7000, mix: 0.8 } },
    { name: 'Podcast Crisp', params: { amount: 0.65, speed: 0.75, freq: 4500, mix: 1 } },
  ],
};
