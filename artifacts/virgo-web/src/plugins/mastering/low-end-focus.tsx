/**
 * VA Low End Focus — low-band contour processor: crossover-selected low band
 * is pushed toward punchy (transient emphasis / upward contrast) or smooth
 * (compressed, rounded) with gain and mix, to tighten bass.
 */
import { useMemo } from 'react';
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { Knob } from '@/components/plugin/Knob';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { fmtHz, fmtPct, BIQUAD_HELPERS, biquadMagnitudeDb } from './kernel-utils';

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

function Controls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  const xover    = (params.xover    as number) ?? 120;
  const gain     = (params.gain     as number) ?? 0;
  const contrast = (params.contrast as number) ?? 0;
  const mix      = (params.mix      as number) ?? 1;

  // Approximate the LR4 crossover + gain effect as a lowshelf at the crossover
  // frequency. The shelf gain is scaled by mix so the curve tracks the blend.
  const eqCurve = useMemo(() => {
    const effectiveGain = gain * mix;
    return (f: number) =>
      biquadMagnitudeDb('lowshelf', xover, effectiveGain, 0.707, f);
  }, [xover, gain, mix]);

  const contrastLabel =
    Math.abs(contrast) < 0.02
      ? 'Neutral'
      : contrast > 0
        ? `Punchy ${Math.round(contrast * 100)}%`
        : `Smooth ${Math.round(-contrast * 100)}%`;

  return (
    <div className="space-y-4">
      <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} eqCurve={eqCurve} height={180} />

      <div className="flex flex-wrap items-end justify-center gap-x-8 gap-y-4 rounded-md border border-[#242424] bg-[#111] p-4">
        <Knob
          label="Crossover"
          value={xover}
          min={50} max={400} defaultValue={120}
          log
          format={fmtHz}
          onChange={(v) => setParam('xover', v)}
        />
        <Knob
          label="Contrast"
          value={contrast}
          min={-1} max={1} defaultValue={0}
          format={() => contrastLabel}
          onChange={(v) => setParam('contrast', v)}
        />
        <Knob
          label="Low Gain"
          value={gain}
          min={-12} max={12} defaultValue={0}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
          onChange={(v) => setParam('gain', v)}
        />
        <Knob
          label="Mix"
          value={mix}
          min={0} max={1} defaultValue={1}
          format={fmtPct}
          onChange={(v) => setParam('mix', v)}
        />
      </div>
    </div>
  );
}

export const lowEndFocus: PluginDefinition = {
  id: 'low-end',
  name: 'VA Low End Focus',
  category: 'mastering',
  tagline: 'Bass punch & contrast',
  description: 'Tightens the critical low-frequency band: dial the contrast toward Punchy for transient emphasis or Smooth for rounded, compressed bass, with crossover, gain and parallel mix.',
  available: true,
  kernelCode: KERNEL,
  Controls,
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
  demoClip: '/demos/mastering-generic.wav',
};
