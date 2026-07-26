/**
 * VA Low End Focus — low-band contour processor: crossover-selected low band
 * is pushed toward punchy (transient emphasis / upward contrast) or smooth
 * (compressed, rounded) with gain and mix, to tighten bass.
 */
import type { PluginDefinition } from '@/lib/plugin-engine/types';
import { fmtHz, fmtPct, BIQUAD_HELPERS } from './kernel-utils';

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}
  var lpA = makeBiquad(), lpB = makeBiquad();
  var hpA = makeBiquad(), hpB = makeBiquad();
  var lastX = -1;
  var fastEnv = 0, slowEnv = 0;

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      var xover = params.xover || 120;
      if (xover !== lastX) {
        var c = biquadCoeffs('lowpass', xover, 0, 0.707, sampleRate);
        lpA.c = c; lpB.c = c;
        var ch = biquadCoeffs('highpass', xover, 0, 0.707, sampleRate);
        hpA.c = ch; hpB.c = ch;
        lastX = xover;
      }

      // contrast: -1 = smooth (compress), +1 = punchy (transient emphasis)
      var contrast = Math.max(-1, Math.min(1, params.contrast || 0));
      var gain = dbToLin(params.gain || 0);
      var mix = Math.max(0, Math.min(1, params.mix != null ? params.mix : 1));

      var fastC = envCoef(8, sampleRate);
      var slowC = envCoef(160, sampleRate);

      for (var i = 0; i < n; i++) {
        var l = inL[i], r = inR[i];

        // LR4 complementary crossover: low = 2x butterworth LP, rest = 2x butterworth HP
        var lowL = bqTickL(lpB, bqTickL(lpA, l));
        var lowR = bqTickR(lpB, bqTickR(lpA, r));
        var restL = bqTickL(hpB, bqTickL(hpA, l));
        var restR = bqTickR(hpB, bqTickR(hpA, r));

        var det = Math.max(Math.abs(lowL), Math.abs(lowR));
        fastEnv = (det > fastEnv ? fastC : fastC) * fastEnv + (1 - fastC) * det;
        slowEnv = slowC * slowEnv + (1 - slowC) * det;

        var g = 1;
        if (contrast > 0.001) {
          // punchy: boost when fast env exceeds slow env (transients)
          var ratio = slowEnv > 1e-6 ? fastEnv / slowEnv : 1;
          var punch = Math.max(0, Math.min(2, ratio - 1));
          g = 1 + punch * contrast * 1.2;
          // slight dip in sustain to increase contrast
          if (ratio < 0.9) g = 1 - (0.9 - ratio) * contrast * 0.5;
        } else if (contrast < -0.001) {
          // smooth: soft compression of the low band
          var lvlDb = linToDb(slowEnv);
          var over = lvlDb - (-24);
          if (over > 0) g = dbToLin(over * 0.5 * contrast); // contrast negative -> reduction
        }

        var pl = lowL * g * gain;
        var pr = lowR * g * gain;
        // soft clip the processed low band to keep it tight (unity slope at 0)
        pl = Math.tanh(pl * 0.8) * 1.25;
        pr = Math.tanh(pr * 0.8) * 1.25;

        outL[i] = restL + lowL * (1 - mix) + pl * mix;
        outR[i] = restR + lowR * (1 - mix) + pr * mix;
      }
    }
  };
}
`;

export const lowEndFocus: PluginDefinition = {
  id: 'low-end',
  name: 'VA Low End Focus',
  category: 'mastering',
  tagline: 'Bass punch & contrast',
  description: 'Tightens the critical low-frequency band: dial the contrast toward Punchy for transient emphasis or Smooth for rounded, compressed bass, with crossover, gain and parallel mix.',
  available: true,
  kernelCode: KERNEL,
  params: [
    { id: 'xover', label: 'Crossover', min: 50, max: 400, default: 120, scale: 'log', format: fmtHz },
    { id: 'contrast', label: 'Contrast', min: -1, max: 1, default: 0, format: (v) => (Math.abs(v) < 0.02 ? 'Neutral' : v > 0 ? `Punchy ${Math.round(v * 100)}%` : `Smooth ${Math.round(-v * 100)}%`) },
    { id: 'gain', label: 'Low Gain', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, format: fmtPct },
  ],
  factoryPresets: [
    { name: 'Tight & Punchy', params: { xover: 110, contrast: 0.6, gain: 1, mix: 1 } },
    { name: 'Smooth Sub Glue', params: { xover: 90, contrast: -0.55, gain: 1.5, mix: 1 } },
    { name: 'Kick Forward', params: { xover: 150, contrast: 0.8, gain: 0.5, mix: 0.9 } },
    { name: 'EDM Sub Control', params: { xover: 80, contrast: -0.4, gain: 2.5, mix: 1 } },
    { name: 'Hip-Hop Knock', params: { xover: 130, contrast: 0.7, gain: 2, mix: 1 } },
    { name: 'Warm Vinyl Bass', params: { xover: 180, contrast: -0.3, gain: 1, mix: 0.8 } },
    { name: 'Subtle Tighten', params: { xover: 120, contrast: 0.3, gain: 0, mix: 0.7 } },
  ],
};
