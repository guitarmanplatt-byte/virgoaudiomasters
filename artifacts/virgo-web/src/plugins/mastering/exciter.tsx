/**
 * VA Exciter — multiband harmonic saturation with selectable transfer curves
 * (Warm / Tape / Tube / Retro) and per-band amount and mix.
 */
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { Knob } from '@/components/plugin/Knob';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { BIQUAD_HELPERS, fmtHz, fmtPct } from './kernel-utils';

const MODES = ['Warm', 'Tape', 'Tube', 'Retro'];

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}
  // 3-band split: low (LP@xLow), mid (band), high (HP@xHigh) using cascaded
  // 2nd-order Butterworth-ish pairs for ~flat recombination.
  var lpA = makeBiquad(), lpB = makeBiquad();
  var hpA = makeBiquad(), hpB = makeBiquad();
  var lastXLow = -1, lastXHigh = -1;

  function shape(x, mode, k) {
    if (k < 0.001) return x;
    if (mode === 0) { // Warm: arctan-style, odd harmonics, gentle
      return Math.atan(x * (1 + k * 4)) / Math.atan(1 + k * 4);
    } else if (mode === 1) { // Tape: soft cubic clip, compresses peaks
      var d = x * (1 + k * 2);
      if (d > 1) d = 1; else if (d < -1) d = -1;
      return (d - (d * d * d) / 3) / (1 + k * 0.9) * 1.5;
    } else if (mode === 2) { // Tube: asymmetric, adds even harmonics
      var g = 1 + k * 5;
      var y = x >= 0 ? 1 - Math.exp(-g * x) : -(1 - Math.exp(g * x)) * (1 - k * 0.25);
      return y / (1 - Math.exp(-g));
    } else { // Retro: hard-ish fold, aggressive
      var kk = 1 + k * 30;
      return ((Math.PI + kk) * x) / (Math.PI + kk * Math.abs(x));
    }
  }

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      var xLow = params.xLow || 200;
      var xHigh = params.xHigh || 3000;
      if (xLow !== lastXLow || xHigh !== lastXHigh) {
        var cl = biquadCoeffs('lowpass', xLow, 0, 0.707, sampleRate);
        var ch = biquadCoeffs('highpass', xHigh, 0, 0.707, sampleRate);
        lpA.c = cl; lpB.c = cl; hpA.c = ch; hpB.c = ch;
        lastXLow = xLow; lastXHigh = xHigh;
      }

      var mode = Math.round(params.mode || 0);
      var amtLow = params.amtLow || 0;
      var amtMid = params.amtMid || 0;
      var amtHigh = params.amtHigh || 0;
      var mixLow = params.mixLow != null ? params.mixLow : 1;
      var mixMid = params.mixMid != null ? params.mixMid : 1;
      var mixHigh = params.mixHigh != null ? params.mixHigh : 1;
      var outTrim = dbToLin(params.trim || 0);

      for (var i = 0; i < n; i++) {
        var l = inL[i], r = inR[i];

        var lowL = bqTickL(lpB, bqTickL(lpA, l));
        var lowR = bqTickR(lpB, bqTickR(lpA, r));
        var highL = bqTickL(hpB, bqTickL(hpA, l));
        var highR = bqTickR(hpB, bqTickR(hpA, r));
        var midL = l - lowL - highL;
        var midR = r - lowR - highR;

        var sLowL = lowL + (shape(lowL, mode, amtLow) - lowL) * mixLow * (amtLow > 0 ? 1 : 0);
        var sLowR = lowR + (shape(lowR, mode, amtLow) - lowR) * mixLow * (amtLow > 0 ? 1 : 0);
        var sMidL = midL + (shape(midL, mode, amtMid) - midL) * mixMid * (amtMid > 0 ? 1 : 0);
        var sMidR = midR + (shape(midR, mode, amtMid) - midR) * mixMid * (amtMid > 0 ? 1 : 0);
        var sHighL = highL + (shape(highL, mode, amtHigh) - highL) * mixHigh * (amtHigh > 0 ? 1 : 0);
        var sHighR = highR + (shape(highR, mode, amtHigh) - highR) * mixHigh * (amtHigh > 0 ? 1 : 0);

        outL[i] = (sLowL + sMidL + sHighL) * outTrim;
        outR[i] = (sLowR + sMidR + sHighR) * outTrim;
      }
    }
  };
}
`;

function Controls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  const mode = Math.round(params.mode ?? 0);

  const band = (label: string, amtId: string, mixId: string) => (
    <div className="flex flex-col items-center gap-3 rounded-md border border-[#242424] bg-[#111] px-5 py-4 flex-1 min-w-[150px]">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex items-end gap-5">
        <Knob label="Amount" value={params[amtId] ?? 0} min={0} max={1} defaultValue={0} format={fmtPct} size={64} onChange={(v) => setParam(amtId, v)} />
        <Knob label="Mix" value={params[mixId] ?? 1} min={0} max={1} defaultValue={1} format={fmtPct} size={48} onChange={(v) => setParam(mixId, v)} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={180} />

      {/* Mode selector */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Circuit</span>
        {MODES.map((m, i) => (
          <button
            key={m}
            onClick={() => setParam('mode', i)}
            className={`h-9 px-5 rounded-sm border text-xs font-semibold uppercase tracking-wider transition-all ${
              mode === i
                ? 'border-[#E8A030] bg-[#E8A030]/15 text-[#E8A030] shadow-[0_0_10px_rgba(232,160,48,0.2)]'
                : 'border-[#2E2E2E] bg-[#161616] text-muted-foreground hover:text-foreground'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        {band('Low Band', 'amtLow', 'mixLow')}
        {band('Mid Band', 'amtMid', 'mixMid')}
        {band('High Band', 'amtHigh', 'mixHigh')}
      </div>

      <div className="flex flex-wrap items-end justify-center gap-x-8 gap-y-4 rounded-md border border-[#242424] bg-[#111] p-4">
        <Knob label="Low X-Over" value={params.xLow ?? 200} min={60} max={800} defaultValue={200} log format={fmtHz} onChange={(v) => setParam('xLow', v)} />
        <Knob label="High X-Over" value={params.xHigh ?? 3000} min={1000} max={12000} defaultValue={3000} log format={fmtHz} onChange={(v) => setParam('xHigh', v)} />
        <Knob label="Trim" value={params.trim ?? 0} min={-12} max={12} defaultValue={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => setParam('trim', v)} />
      </div>
    </div>
  );
}

export const exciter: PluginDefinition = {
  id: 'exciter',
  name: 'VA Exciter',
  category: 'mastering',
  tagline: 'Multiband harmonic saturation',
  description: 'Multi-mode harmonic exciter with Warm, Tape, Tube and Retro saturation circuits, split across three bands with independent amount and mix per band.',
  available: true,
  kernelCode: KERNEL,
  Controls,
  params: [
    { id: 'mode', label: 'Circuit', min: 0, max: 3, default: 0, step: 1 },
    { id: 'xLow', label: 'Low X-Over', min: 60, max: 800, default: 200, scale: 'log', format: fmtHz },
    { id: 'xHigh', label: 'High X-Over', min: 1000, max: 12000, default: 3000, scale: 'log', format: fmtHz },
    { id: 'amtLow', label: 'Low Amount', min: 0, max: 1, default: 0, format: fmtPct },
    { id: 'mixLow', label: 'Low Mix', min: 0, max: 1, default: 1, format: fmtPct },
    { id: 'amtMid', label: 'Mid Amount', min: 0, max: 1, default: 0, format: fmtPct },
    { id: 'mixMid', label: 'Mid Mix', min: 0, max: 1, default: 1, format: fmtPct },
    { id: 'amtHigh', label: 'High Amount', min: 0, max: 1, default: 0, format: fmtPct },
    { id: 'mixHigh', label: 'High Mix', min: 0, max: 1, default: 1, format: fmtPct },
    { id: 'trim', label: 'Trim', min: -12, max: 12, default: 0, unit: 'dB' },
  ],
  factoryPresets: [
    { name: 'Warm Tape', params: { mode: 1, xLow: 180, xHigh: 3200, amtLow: 0.25, mixLow: 0.8, amtMid: 0.2, mixMid: 0.7, amtHigh: 0.15, mixHigh: 0.6, trim: -0.5 } },
    { name: 'Tube Sheen', params: { mode: 2, xLow: 200, xHigh: 4000, amtLow: 0.1, mixLow: 0.5, amtMid: 0.25, mixMid: 0.6, amtHigh: 0.35, mixHigh: 0.7, trim: -1 } },
    { name: 'Vocal Presence', params: { mode: 2, xLow: 250, xHigh: 2500, amtLow: 0, mixLow: 1, amtMid: 0.3, mixMid: 0.55, amtHigh: 0.2, mixHigh: 0.5, trim: 0 } },
    { name: 'Bass Growl', params: { mode: 0, xLow: 300, xHigh: 3000, amtLow: 0.5, mixLow: 0.7, amtMid: 0.1, mixMid: 0.5, amtHigh: 0, mixHigh: 1, trim: -1 } },
    { name: 'Air Sparkle', params: { mode: 0, xLow: 200, xHigh: 6000, amtLow: 0, mixLow: 1, amtMid: 0.05, mixMid: 0.5, amtHigh: 0.45, mixHigh: 0.65, trim: 0 } },
    { name: 'EDM Loud', params: { mode: 3, xLow: 150, xHigh: 4500, amtLow: 0.3, mixLow: 0.6, amtMid: 0.35, mixMid: 0.6, amtHigh: 0.4, mixHigh: 0.6, trim: -2 } },
    { name: 'Lo-Fi Retro', params: { mode: 3, xLow: 400, xHigh: 2500, amtLow: 0.45, mixLow: 0.9, amtMid: 0.5, mixMid: 0.9, amtHigh: 0.3, mixHigh: 0.8, trim: -3 } },
    { name: 'Subtle Glue', params: { mode: 1, xLow: 200, xHigh: 3000, amtLow: 0.1, mixLow: 0.5, amtMid: 0.1, mixMid: 0.5, amtHigh: 0.1, mixHigh: 0.5, trim: 0 } },
  ],
};
