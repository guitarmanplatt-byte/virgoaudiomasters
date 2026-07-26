/**
 * VA Vintage Tape — classic analog tape emulation.
 * DSP: soft tape saturation, head-bump low shelf, gentle HF rolloff, subtle
 * wow & flutter modulation via a tiny interpolated delay buffer.
 */
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { Knob } from '@/components/plugin/Knob';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { BIQUAD_HELPERS, fmtDb, fmtHz, fmtPct, GOLD } from './kernel-utils';

// Tape speed presets: [bumpFreq, bumpGain, rolloffFreq]
const SPEEDS = [
  { label: '7½ IPS', bumpFreq: 100, bumpGain: 3.5, rolloffFreq: 8000 },
  { label: '15 IPS', bumpFreq: 80,  bumpGain: 2.5, rolloffFreq: 14000 },
  { label: '30 IPS', bumpFreq: 60,  bumpGain: 1.5, rolloffFreq: 18000 },
];

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}

  // Head-bump (low shelf) + HF rolloff (lowpass) biquads
  var bumpL = makeBiquad(), bumpR = makeBiquad();
  var hfL   = makeBiquad(), hfR   = makeBiquad();
  var lastBumpFreq = -1, lastBumpGain = -9999, lastRolloff = -1;

  // Wow / flutter: circular delay buffer for pitch modulation
  var maxDelayMs = 6;
  var bufSize = Math.ceil(sampleRate * maxDelayMs / 1000) + 4;
  var bufL = new Float32Array(bufSize);
  var bufR = new Float32Array(bufSize);
  var writePos = 0;

  // LFO phases
  var wowPhase     = 0;
  var flutterPhase = 0;
  var flutterPhase2 = 1.7; // second flutter partial at a slightly different rate

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      var saturation  = params.saturation  != null ? params.saturation  : 0.3;
      var bumpFreq    = params.bumpFreq    || 80;
      var bumpGain    = params.bumpGain    != null ? params.bumpGain    : 2.5;
      var rolloffFreq = params.rolloffFreq || 14000;
      var wow         = params.wow         != null ? params.wow         : 0.2;
      var flutter     = params.flutter     != null ? params.flutter     : 0.15;
      var mix         = params.mix         != null ? params.mix         : 1;
      var trim        = params.trim        != null ? params.trim        : 0;

      // Recompute filters only when parameters change
      if (bumpFreq !== lastBumpFreq || bumpGain !== lastBumpGain) {
        var bc = biquadCoeffs('lowshelf', bumpFreq, bumpGain, 0.71, sampleRate);
        bumpL.c = bc; bumpR.c = bc;
        lastBumpFreq = bumpFreq; lastBumpGain = bumpGain;
      }
      if (rolloffFreq !== lastRolloff) {
        var rc = biquadCoeffs('lowpass', rolloffFreq, 0, 0.71, sampleRate);
        hfL.c = rc; hfR.c = rc;
        lastRolloff = rolloffFreq;
      }

      var trimLin = dbToLin(trim);
      var hasWow     = wow     > 0.001;
      var hasFlutter = flutter > 0.001;
      var hasMod     = hasWow || hasFlutter;

      // LFO increments per sample
      var wowInc      = 6.283185 * 0.5   / sampleRate; // 0.5 Hz wow
      var flutterInc  = 6.283185 * 6.0   / sampleRate; // 6 Hz flutter
      var flutterInc2 = 6.283185 * 11.3  / sampleRate; // 11.3 Hz flutter partial

      // Base delay offset so modulation can go both directions (3 ms)
      var baseDelaySamples = hasMod ? (sampleRate * 0.003) : 0;

      for (var i = 0; i < n; i++) {
        var l = inL[i];
        var r = inR[i];

        // 1. Head-bump low shelf
        if (bumpL.c) {
          l = bqTickL(bumpL, l);
          r = bqTickR(bumpR, r);
        }

        // 2. Soft tape saturation (tanh-style, odd harmonics)
        if (saturation > 0.001) {
          var k = saturation * 5;
          var kp1 = 1 + k;
          l = (kp1 * l) / (1 + k * (l < 0 ? -l : l));
          r = (kp1 * r) / (1 + k * (r < 0 ? -r : r));
        }

        // 3. HF rolloff
        if (hfL.c) {
          l = bqTickL(hfL, l);
          r = bqTickR(hfR, r);
        }

        // Write processed sample into delay buffer
        bufL[writePos] = l;
        bufR[writePos] = r;

        var outSampleL, outSampleR;

        if (hasMod) {
          // Wow LFO (slow, random-ish via two partials)
          var wowAmt = hasWow ? (
            Math.sin(wowPhase) * 0.6 + Math.sin(wowPhase * 1.71 + 0.9) * 0.4
          ) * wow * 2.0 : 0; // ±2 ms max

          // Flutter LFO (faster, irregular blend)
          var flutterAmt = hasFlutter ? (
            Math.sin(flutterPhase) * 0.55 + Math.sin(flutterPhase2 + 0.4) * 0.45
          ) * flutter * 0.4 : 0; // ±0.4 ms max

          var delaySamples = baseDelaySamples + (wowAmt + flutterAmt) * sampleRate * 0.001;

          // Clamp to valid buffer range
          if (delaySamples < 0) delaySamples = 0;
          if (delaySamples >= bufSize - 1) delaySamples = bufSize - 2;

          // Linear interpolation read
          var readF = writePos - delaySamples;
          while (readF < 0) readF += bufSize;
          var ri0  = (readF | 0) % bufSize;
          var ri1  = (ri0 + 1) % bufSize;
          var frac = readF - (readF | 0);
          outSampleL = bufL[ri0] * (1 - frac) + bufL[ri1] * frac;
          outSampleR = bufR[ri0] * (1 - frac) + bufR[ri1] * frac;

          // Advance LFOs
          wowPhase += wowInc;
          if (wowPhase > 6.283185) wowPhase -= 6.283185;
          flutterPhase  += flutterInc;
          if (flutterPhase  > 6.283185) flutterPhase  -= 6.283185;
          flutterPhase2 += flutterInc2;
          if (flutterPhase2 > 6.283185) flutterPhase2 -= 6.283185;
        } else {
          // No modulation: read immediately from write position
          outSampleL = bufL[writePos];
          outSampleR = bufR[writePos];
        }

        writePos = (writePos + 1) % bufSize;

        // Dry/wet mix and output trim
        outL[i] = (inL[i] * (1 - mix) + outSampleL * mix) * trimLin;
        outR[i] = (inR[i] * (1 - mix) + outSampleR * mix) * trimLin;
      }
    }
  };
}
`;

function Controls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  // Detect which speed preset is active (or none)
  const activeSpeed = SPEEDS.findIndex(
    (s) =>
      Math.abs((params.bumpFreq ?? 80) - s.bumpFreq) < 1 &&
      Math.abs((params.bumpGain ?? 2.5) - s.bumpGain) < 0.05 &&
      Math.abs((params.rolloffFreq ?? 14000) - s.rolloffFreq) < 1,
  );

  function applySpeed(idx: number) {
    const s = SPEEDS[idx];
    setParam('bumpFreq',    s.bumpFreq);
    setParam('bumpGain',    s.bumpGain);
    setParam('rolloffFreq', s.rolloffFreq);
  }

  return (
    <div className="space-y-4">
      <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={180} />

      {/* Tape speed selector */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Tape Speed</span>
        {SPEEDS.map((s, i) => (
          <button
            key={s.label}
            onClick={() => applySpeed(i)}
            className={`h-9 px-5 rounded-sm border text-xs font-semibold uppercase tracking-wider transition-all ${
              activeSpeed === i
                ? 'border-[#E8A030] bg-[#E8A030]/15 text-[#E8A030] shadow-[0_0_10px_rgba(232,160,48,0.2)]'
                : 'border-[#2E2E2E] bg-[#161616] text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Main controls row */}
      <div className="flex flex-wrap gap-3">
        {/* Saturation panel */}
        <div className="flex flex-col items-center gap-3 rounded-md border border-[#242424] bg-[#111] px-5 py-4 flex-1 min-w-[140px]">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Tape Character</span>
          <div className="flex items-end gap-5">
            <Knob
              label="Saturation"
              value={params.saturation ?? 0.3}
              min={0} max={1} defaultValue={0.3}
              format={fmtPct}
              size={64}
              onChange={(v) => setParam('saturation', v)}
            />
          </div>
        </div>

        {/* Head Bump panel */}
        <div className="flex flex-col items-center gap-3 rounded-md border border-[#242424] bg-[#111] px-5 py-4 flex-1 min-w-[170px]">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Head Bump</span>
          <div className="flex items-end gap-5">
            <Knob
              label="Freq"
              value={params.bumpFreq ?? 80}
              min={40} max={200} defaultValue={80}
              log format={fmtHz} size={56}
              onChange={(v) => setParam('bumpFreq', v)}
            />
            <Knob
              label="Gain"
              value={params.bumpGain ?? 2.5}
              min={0} max={8} defaultValue={2.5}
              format={fmtDb} size={56}
              onChange={(v) => setParam('bumpGain', v)}
            />
          </div>
        </div>

        {/* HF Rolloff panel */}
        <div className="flex flex-col items-center gap-3 rounded-md border border-[#242424] bg-[#111] px-5 py-4 flex-1 min-w-[140px]">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">HF Rolloff</span>
          <div className="flex items-end gap-5">
            <Knob
              label="Cutoff"
              value={params.rolloffFreq ?? 14000}
              min={4000} max={20000} defaultValue={14000}
              log format={fmtHz} size={64}
              onChange={(v) => setParam('rolloffFreq', v)}
            />
          </div>
        </div>

        {/* Wow / Flutter panel */}
        <div className="flex flex-col items-center gap-3 rounded-md border border-[#242424] bg-[#111] px-5 py-4 flex-1 min-w-[170px]">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Transport</span>
          <div className="flex items-end gap-5">
            <Knob
              label="Wow"
              value={params.wow ?? 0.2}
              min={0} max={1} defaultValue={0.2}
              format={fmtPct} size={56}
              onChange={(v) => setParam('wow', v)}
            />
            <Knob
              label="Flutter"
              value={params.flutter ?? 0.15}
              min={0} max={1} defaultValue={0.15}
              format={fmtPct} size={56}
              onChange={(v) => setParam('flutter', v)}
            />
          </div>
        </div>
      </div>

      {/* Output row */}
      <div className="flex flex-wrap items-end justify-center gap-x-8 gap-y-4 rounded-md border border-[#242424] bg-[#111] p-4">
        <Knob
          label="Mix"
          value={params.mix ?? 1}
          min={0} max={1} defaultValue={1}
          format={fmtPct}
          onChange={(v) => setParam('mix', v)}
        />
        <Knob
          label="Trim"
          value={params.trim ?? 0}
          min={-12} max={6} defaultValue={0}
          format={fmtDb}
          onChange={(v) => setParam('trim', v)}
        />
      </div>
    </div>
  );
}

export const vintageTape: PluginDefinition = {
  id: 'vintage-tape',
  name: 'VA Vintage Tape',
  category: 'mastering',
  tagline: 'Analog tape warmth & character',
  description:
    'Classic open-reel tape emulation: soft saturation, pronounced head-bump low shelf, smooth HF rolloff, and optional wow & flutter pitch modulation. Three tape-speed presets model 7½, 15 and 30 IPS formulations.',
  available: true,
  kernelCode: KERNEL,
  Controls,
  params: [
    { id: 'saturation',  label: 'Saturation',  min: 0,     max: 1,     default: 0.3,   format: fmtPct },
    { id: 'bumpFreq',    label: 'Bump Freq',   min: 40,    max: 200,   default: 80,    scale: 'log', format: fmtHz },
    { id: 'bumpGain',    label: 'Bump Gain',   min: 0,     max: 8,     default: 2.5,   unit: 'dB' },
    { id: 'rolloffFreq', label: 'HF Rolloff',  min: 4000,  max: 20000, default: 14000, scale: 'log', format: fmtHz },
    { id: 'wow',         label: 'Wow',         min: 0,     max: 1,     default: 0.2,   format: fmtPct },
    { id: 'flutter',     label: 'Flutter',     min: 0,     max: 1,     default: 0.15,  format: fmtPct },
    { id: 'mix',         label: 'Mix',         min: 0,     max: 1,     default: 1,     format: fmtPct },
    { id: 'trim',        label: 'Trim',        min: -12,   max: 6,     default: 0,     unit: 'dB' },
  ],
  factoryPresets: [
    // 15 IPS baseline, gentle saturation — good transparent starting point
    {
      name: 'Studio 15 IPS',
      params: { saturation: 0.25, bumpFreq: 80, bumpGain: 2.5, rolloffFreq: 14000, wow: 0.15, flutter: 0.1, mix: 1, trim: -0.5 },
    },
    // 30 IPS: very clean, extended HF — modern mastering tape sound
    {
      name: 'Modern 30 IPS',
      params: { saturation: 0.15, bumpFreq: 60, bumpGain: 1.5, rolloffFreq: 18000, wow: 0.05, flutter: 0.05, mix: 1, trim: 0 },
    },
    // 7.5 IPS: heavy bump, dark rolloff — lo-fi cassette warmth
    {
      name: 'Lo-Fi Cassette',
      params: { saturation: 0.55, bumpFreq: 100, bumpGain: 3.5, rolloffFreq: 8000, wow: 0.45, flutter: 0.35, mix: 1, trim: -1 },
    },
    // Pushed saturation, subtle wow — classic rock mix glue
    {
      name: 'Rock Slam',
      params: { saturation: 0.65, bumpFreq: 90, bumpGain: 3.0, rolloffFreq: 12000, wow: 0.2, flutter: 0.15, mix: 1, trim: -1.5 },
    },
    // Very subtle — just a hint of warmth on digital masters
    {
      name: 'Digital Warmth',
      params: { saturation: 0.1, bumpFreq: 70, bumpGain: 1.2, rolloffFreq: 16000, wow: 0, flutter: 0, mix: 0.6, trim: 0 },
    },
    // Vintage soul / funk — dark and punchy
    {
      name: 'Vintage Soul',
      params: { saturation: 0.45, bumpFreq: 110, bumpGain: 3.8, rolloffFreq: 9000, wow: 0.3, flutter: 0.2, mix: 1, trim: -1 },
    },
    // Maximum wow & flutter — dramatic deteriorated tape
    {
      name: 'Degraded Tape',
      params: { saturation: 0.7, bumpFreq: 100, bumpGain: 3.0, rolloffFreq: 7000, wow: 0.85, flutter: 0.7, mix: 1, trim: -2 },
    },
    // No modulation, focused on the EQ shape — mastering chain insert
    {
      name: 'Mastering Insert',
      params: { saturation: 0.2, bumpFreq: 75, bumpGain: 2.0, rolloffFreq: 15000, wow: 0, flutter: 0, mix: 1, trim: 0 },
    },
  ],
};
