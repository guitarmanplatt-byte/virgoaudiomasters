/**
 * VA Vintage Tape — classic analog tape emulation.
 * DSP: soft tape saturation, head-bump low shelf, gentle HF rolloff, subtle
 * wow & flutter modulation via a tiny interpolated delay buffer, and optional
 * tape hiss that scales inversely with tape speed.
 */
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { Knob } from '@/components/plugin/Knob';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { BIQUAD_HELPERS, fmtDb, fmtHz, fmtPct, GOLD } from './kernel-utils';

// ─── Tape Speed → DSP parameter interpolation ─────────────────────────────
// Based on real IEC/NAB equalization curves and typical machine noise floors.
// All four values use log-IPS as the interpolation axis (t = 0 at 3.75, 1 at 30).

const IPS_MIN = 3.75;
const IPS_MAX = 30;

function ipsToT(ips: number): number {
  return Math.log(Math.max(IPS_MIN, Math.min(IPS_MAX, ips)) / IPS_MIN) /
         Math.log(IPS_MAX / IPS_MIN);
}

/**
 * Map a tape speed (IPS) to the four linked DSP parameters.
 * Frequency curves use logarithmic interpolation; gain is linear.
 */
export function speedToParams(ips: number): {
  bumpFreq: number;
  bumpGain: number;
  rolloffFreq: number;
  noiseAmt: number;
} {
  const t = ipsToT(ips);
  // bumpFreq:    120 Hz (slow) → 55 Hz (fast)  — log interp
  const bumpFreq = Math.exp(Math.log(120) + t * (Math.log(55) - Math.log(120)));
  // bumpGain:    5.0 dB (slow) → 1.0 dB (fast)  — linear interp
  const bumpGain = 5.0 - t * (5.0 - 1.0);
  // rolloffFreq: 4500 Hz (slow) → 19000 Hz (fast) — log interp
  const rolloffFreq = Math.exp(Math.log(4500) + t * (Math.log(19000) - Math.log(4500)));
  // noiseAmt:    subtle hiss, stronger at slow speeds (worse SNR)
  // 0.0030 at 3.75 IPS → 0.0003 at 30 IPS — log interp
  const noiseAmt = Math.exp(Math.log(0.003) + t * (Math.log(0.0003) - Math.log(0.003)));
  return { bumpFreq, bumpGain, rolloffFreq, noiseAmt };
}

// Tape speed preset shortcuts
const SPEED_PRESETS = [
  { label: '3¾ IPS', ips: 3.75 },
  { label: '7½ IPS', ips: 7.5  },
  { label: '15 IPS', ips: 15   },
  { label: '30 IPS', ips: 30   },
];

// ─── DSP Kernel ───────────────────────────────────────────────────────────

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

  // Simple LCG pseudo-random noise (avoids Math.random() variance in hot path)
  var noiseSeed = 123456789;
  function lcgNoise() {
    noiseSeed = (noiseSeed * 1664525 + 1013904223) & 0xffffffff;
    return (noiseSeed >>> 0) / 2147483648.0 - 1.0; // −1..+1
  }

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
      var noiseAmt    = params.noiseAmt    != null ? params.noiseAmt    : 0;

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
      var hasNoise   = noiseAmt > 0.000001;

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

        // 4. Tape hiss (correlated low-level noise, pre-modulation)
        if (hasNoise) {
          var hiss = lcgNoise() * noiseAmt;
          l += hiss;
          r += lcgNoise() * noiseAmt;
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

// ─── UI ────────────────────────────────────────────────────────────────────

function fmtIps(ips: number): string {
  // Display as a fraction when close to a standard speed, else decimal
  if (Math.abs(ips - 3.75) < 0.05) return '3¾ IPS';
  if (Math.abs(ips - 7.5)  < 0.05) return '7½ IPS';
  if (Math.abs(ips - 15)   < 0.1)  return '15 IPS';
  if (Math.abs(ips - 30)   < 0.1)  return '30 IPS';
  return `${ips.toFixed(1)} IPS`;
}

function Controls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  const tapeSpeed: number = (params.tapeSpeed as number) ?? 15;

  // Apply the speed macro — sets the three linked DSP params
  function applySpeed(ips: number) {
    const p = speedToParams(ips);
    setParam('tapeSpeed',   ips);
    setParam('bumpFreq',    Math.round(p.bumpFreq * 10) / 10);
    setParam('bumpGain',    Math.round(p.bumpGain * 100) / 100);
    setParam('rolloffFreq', Math.round(p.rolloffFreq));
    setParam('noiseAmt',    p.noiseAmt);
  }

  // Slider position (log scale) → IPS
  function sliderToIps(v: number): number {
    // v is 0..1000 integer steps
    return IPS_MIN * Math.pow(IPS_MAX / IPS_MIN, v / 1000);
  }
  function ipsToSlider(ips: number): number {
    return Math.round(1000 * ipsToT(ips));
  }

  const sliderVal = ipsToSlider(tapeSpeed);

  // Check which preset is active (within tolerance)
  const activePreset = SPEED_PRESETS.findIndex(
    (p) => Math.abs(tapeSpeed - p.ips) < 0.05,
  );

  return (
    <div className="space-y-4">
      <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={180} />

      {/* ── Tape Speed Macro ─────────────────────────────────────── */}
      <div className="rounded-md border border-[#2E2E2E] bg-[#111] px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Tape Speed
          </span>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: GOLD }}
          >
            {fmtIps(tapeSpeed)}
          </span>
        </div>

        {/* Continuous slider */}
        <div className="relative flex items-center gap-3">
          <span className="text-[9px] text-muted-foreground/60 whitespace-nowrap">3¾</span>
          <div className="relative flex-1">
            {/* Track fill */}
            <div
              className="absolute inset-y-0 left-0 rounded-full pointer-events-none"
              style={{
                width: `${sliderVal / 10}%`,
                background: `linear-gradient(90deg, ${GOLD}55, ${GOLD})`,
                top: '50%',
                transform: 'translateY(-50%)',
                height: 4,
              }}
            />
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={sliderVal}
              onChange={(e) => applySpeed(sliderToIps(Number(e.target.value)))}
              className="w-full appearance-none bg-transparent cursor-pointer"
              style={{
                ['--track-color' as string]: '#2E2E2E',
                ['--thumb-color' as string]: GOLD,
              }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground/60">30</span>
        </div>

        {/* Speed preset shortcuts */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mr-1">
            Presets
          </span>
          {SPEED_PRESETS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => applySpeed(s.ips)}
              className={`h-7 px-3 rounded-sm border text-[10px] font-semibold uppercase tracking-wider transition-all ${
                activePreset === i
                  ? 'border-[#E8A030] bg-[#E8A030]/15 text-[#E8A030] shadow-[0_0_8px_rgba(232,160,48,0.18)]'
                  : 'border-[#2E2E2E] bg-[#161616] text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main controls row ───────────────────────────────────── */}
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

      {/* ── Output row ──────────────────────────────────────────── */}
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

// ─── Plugin definition ─────────────────────────────────────────────────────

export const vintageTape: PluginDefinition = {
  id: 'vintage-tape',
  name: 'VA Vintage Tape',
  category: 'mastering',
  tagline: 'Analog tape warmth & character',
  description:
    'Classic open-reel tape emulation: soft saturation, pronounced head-bump low shelf, smooth HF rolloff, and optional wow & flutter pitch modulation. The Tape Speed macro continuously links head-bump frequency, gain, and HF rolloff from 3¾ to 30 IPS — matching real IEC/NAB equalization curves — with subtle tape hiss that eases off at faster speeds.',
  available: true,
  kernelCode: KERNEL,
  Controls,
  params: [
    { id: 'tapeSpeed',   label: 'Tape Speed',  min: 3.75,  max: 30,    default: 15,    scale: 'log' },
    { id: 'saturation',  label: 'Saturation',  min: 0,     max: 1,     default: 0.3,   format: fmtPct },
    { id: 'bumpFreq',    label: 'Bump Freq',   min: 40,    max: 200,   default: 80,    scale: 'log', format: fmtHz },
    { id: 'bumpGain',    label: 'Bump Gain',   min: 0,     max: 8,     default: 2.5,   unit: 'dB' },
    { id: 'rolloffFreq', label: 'HF Rolloff',  min: 4000,  max: 20000, default: 14000, scale: 'log', format: fmtHz },
    { id: 'noiseAmt',    label: 'Tape Hiss',   min: 0,     max: 0.005, default: 0.001 },
    { id: 'wow',         label: 'Wow',         min: 0,     max: 1,     default: 0.2,   format: fmtPct },
    { id: 'flutter',     label: 'Flutter',     min: 0,     max: 1,     default: 0.15,  format: fmtPct },
    { id: 'mix',         label: 'Mix',         min: 0,     max: 1,     default: 1,     format: fmtPct },
    { id: 'trim',        label: 'Trim',        min: -12,   max: 6,     default: 0,     unit: 'dB' },
  ],
  factoryPresets: [
    // 15 IPS baseline, gentle saturation — good transparent starting point
    {
      name: 'Studio 15 IPS',
      params: { tapeSpeed: 15, saturation: 0.25, bumpFreq: 80, bumpGain: 2.5, rolloffFreq: 14000, noiseAmt: 0.001, wow: 0.15, flutter: 0.1, mix: 1, trim: -0.5 },
    },
    // 30 IPS: very clean, extended HF — modern mastering tape sound
    {
      name: 'Modern 30 IPS',
      params: { tapeSpeed: 30, saturation: 0.15, bumpFreq: 60, bumpGain: 1.5, rolloffFreq: 18000, noiseAmt: 0.0003, wow: 0.05, flutter: 0.05, mix: 1, trim: 0 },
    },
    // 7.5 IPS: heavy bump, dark rolloff — lo-fi cassette warmth
    {
      name: 'Lo-Fi Cassette',
      params: { tapeSpeed: 7.5, saturation: 0.55, bumpFreq: 100, bumpGain: 3.5, rolloffFreq: 8000, noiseAmt: 0.002, wow: 0.45, flutter: 0.35, mix: 1, trim: -1 },
    },
    // Pushed saturation, subtle wow — classic rock mix glue
    {
      name: 'Rock Slam',
      params: { tapeSpeed: 15, saturation: 0.65, bumpFreq: 90, bumpGain: 3.0, rolloffFreq: 12000, noiseAmt: 0.001, wow: 0.2, flutter: 0.15, mix: 1, trim: -1.5 },
    },
    // Very subtle — just a hint of warmth on digital masters
    {
      name: 'Digital Warmth',
      params: { tapeSpeed: 15, saturation: 0.1, bumpFreq: 70, bumpGain: 1.2, rolloffFreq: 16000, noiseAmt: 0, wow: 0, flutter: 0, mix: 0.6, trim: 0 },
    },
    // Vintage soul / funk — dark and punchy
    {
      name: 'Vintage Soul',
      params: { tapeSpeed: 7.5, saturation: 0.45, bumpFreq: 110, bumpGain: 3.8, rolloffFreq: 9000, noiseAmt: 0.002, wow: 0.3, flutter: 0.2, mix: 1, trim: -1 },
    },
    // Maximum wow & flutter — dramatic deteriorated tape
    {
      name: 'Degraded Tape',
      params: { tapeSpeed: 3.75, saturation: 0.7, bumpFreq: 120, bumpGain: 5.0, rolloffFreq: 5000, noiseAmt: 0.003, wow: 0.85, flutter: 0.7, mix: 1, trim: -2 },
    },
    // No modulation, focused on the EQ shape — mastering chain insert
    {
      name: 'Mastering Insert',
      params: { tapeSpeed: 15, saturation: 0.2, bumpFreq: 75, bumpGain: 2.0, rolloffFreq: 15000, noiseAmt: 0.0005, wow: 0, flutter: 0, mix: 1, trim: 0 },
    },
  ],
  demoClip: '/demos/mastering-generic.wav',
};
