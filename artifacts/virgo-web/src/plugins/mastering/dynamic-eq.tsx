/**
 * VA Dynamic EQ — 8-band parametric EQ where each band can react to the
 * program level (duck or boost dynamically), rendered as draggable nodes on a
 * spectrum-overlaid curve.
 */
import { useMemo, useState } from 'react';
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { BandNodeEditor } from '@/components/plugin/BandNodeEditor';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { Knob } from '@/components/plugin/Knob';
import { ToggleSwitch } from '@/components/plugin/ToggleSwitch';
import { BIQUAD_HELPERS, biquadMagnitudeDb, fmtDb, fmtHz, fmtMs, GOLD } from './kernel-utils';

const NUM_BANDS = 8;
const TYPES = ['peaking', 'lowshelf', 'highshelf', 'highpass', 'lowpass'] as const;
const TYPE_LABELS = ['Bell', 'Low Shelf', 'High Shelf', 'Low Cut', 'High Cut'];
const BAND_COLORS = ['#E8A030', '#E86A30', '#D4C05A', '#7FB06A', '#5AA8C8', '#9A7FD0', '#D06A9A', '#B0B0B0'];

const DEFAULT_FREQS = [60, 150, 400, 1000, 2500, 6000, 10000, 15000];

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}
  var TYPES = ['peaking', 'lowshelf', 'highshelf', 'highpass', 'lowpass'];
  var bands = [];
  for (var i = 0; i < ${NUM_BANDS}; i++) {
    bands.push({
      filt: makeBiquad(), det: makeBiquad(),
      env: 0, dynDb: 0,
      lastKey: '', lastDetKey: '', lastAppliedGain: 1e9
    });
  }

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      // Update coefficients per block
      for (var b = 0; b < ${NUM_BANDS}; b++) {
        var st = bands[b];
        var on = (params['b' + b + 'on'] || 0) > 0.5;
        st.on = on;
        if (!on) continue;
        var type = TYPES[Math.round(params['b' + b + 'type'] || 0)] || 'peaking';
        var freq = params['b' + b + 'freq'] || 1000;
        var gain = params['b' + b + 'gain'] || 0;
        var q = params['b' + b + 'q'] || 1;
        var dynOn = (params['b' + b + 'dyn'] || 0) > 0.5;
        var range = params['b' + b + 'range'] || 0;
        var thresh = params['b' + b + 'thresh'] != null ? params['b' + b + 'thresh'] : -30;
        st.type = type; st.freq = freq; st.q = q; st.staticGain = gain;
        st.dynOn = dynOn; st.range = range; st.thresh = thresh;
        st.atk = envCoef(params['b' + b + 'atk'] || 10, sampleRate);
        st.rel = envCoef(params['b' + b + 'rel'] || 150, sampleRate);

        // detection bandpass (only depends on freq/q)
        var detKey = freq + '/' + q;
        if (st.lastDetKey !== detKey) {
          st.det.c = biquadCoeffs('bandpass', freq, 0, Math.max(0.3, q), sampleRate);
          st.lastDetKey = detKey;
        }

        var applied = gain + (dynOn ? st.dynDb : 0);
        var key = type + '/' + freq + '/' + q;
        if (st.lastKey !== key || Math.abs(applied - st.lastAppliedGain) > 0.1) {
          st.filt.c = biquadCoeffs(type, freq, applied, q, sampleRate);
          st.lastKey = key;
          st.lastAppliedGain = applied;
        }
      }

      for (var s = 0; s < n; s++) {
        var l = inL[s], r = inR[s];
        for (var b2 = 0; b2 < ${NUM_BANDS}; b2++) {
          var st2 = bands[b2];
          if (!st2.on) continue;
          if (st2.dynOn) {
            // envelope of the band-filtered mono signal
            var d = bqTickL(st2.det, (l + r) * 0.5);
            var mag = Math.abs(d);
            var coef = mag > st2.env ? st2.atk : st2.rel;
            st2.env = coef * st2.env + (1 - coef) * mag;
            var over = linToDb(st2.env) - st2.thresh;
            var amt = over > 0 ? Math.min(1, over / 12) : 0;
            st2.dynDb = st2.range * amt; // range<0 ducks, >0 boosts
          } else {
            st2.dynDb = 0;
          }
          l = bqTickL(st2.filt, l);
          r = bqTickR(st2.filt, r);
        }
        outL[s] = l;
        outR[s] = r;
      }
    }
  };
}
`;

function defaults(): Record<string, number> {
  const p: Record<string, number> = {};
  for (let b = 0; b < NUM_BANDS; b++) {
    p[`b${b}on`] = b < 4 ? 1 : 0;
    p[`b${b}type`] = 0;
    p[`b${b}freq`] = DEFAULT_FREQS[b];
    p[`b${b}gain`] = 0;
    p[`b${b}q`] = 1;
    p[`b${b}dyn`] = 0;
    p[`b${b}range`] = -3;
    p[`b${b}thresh`] = -30;
    p[`b${b}atk`] = 10;
    p[`b${b}rel`] = 150;
  }
  return p;
}

function bandParams(b: number, over: Partial<Record<'on' | 'type' | 'freq' | 'gain' | 'q' | 'dyn' | 'range' | 'thresh' | 'atk' | 'rel', number>>) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(over)) out[`b${b}${k}`] = v as number;
  return out;
}

function preset(name: string, bands: Parameters<typeof bandParams>[1][]): { name: string; params: Record<string, number> } {
  const params = defaults();
  for (let b = 0; b < NUM_BANDS; b++) params[`b${b}on`] = 0;
  bands.forEach((over, i) => Object.assign(params, bandParams(i, { on: 1, ...over })));
  return { name, params };
}

function Controls({ params, setParam, analyser, inputAnalyser }: PluginUIProps) {
  const [sel, setSel] = useState(0);

  const activeBands = useMemo(() =>
    Array.from({ length: NUM_BANDS }, (_, b) => b).filter((b) => (params[`b${b}on`] ?? 0) > 0.5),
    [params]);

  const nodes = activeBands.map((b) => ({
    freq: params[`b${b}freq`] ?? 1000,
    gain: params[`b${b}gain`] ?? 0,
    color: b === sel ? '#FFFFFF' : BAND_COLORS[b],
  }));

  const curve = useMemo(() => {
    const snapshot = activeBands.map((b) => ({
      type: TYPES[Math.round(params[`b${b}type`] ?? 0)] ?? 'peaking',
      freq: params[`b${b}freq`] ?? 1000,
      gain: params[`b${b}gain`] ?? 0,
      q: params[`b${b}q`] ?? 1,
    }));
    return (f: number) => snapshot.reduce((acc, s) => acc + biquadMagnitudeDb(s.type, s.freq, s.gain, s.q, f), 0);
  }, [params, activeBands]);

  const p = (k: string) => params[`b${sel}${k}`] ?? 0;
  const set = (k: string, v: number) => setParam(`b${sel}${k}`, v);
  const dynOn = p('dyn') > 0.5;

  return (
    <div className="space-y-4">
      <div className="relative">
        <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={210} className="absolute inset-0 opacity-60" />
        <div className="relative">
          <BandNodeEditor
            nodes={nodes}
            minGain={-18}
            maxGain={18}
            height={210}
            curve={curve}
            className="bg-transparent"
            onChange={(i, node) => {
              const b = activeBands[i];
              setSel(b);
              setParam(`b${b}freq`, node.freq);
              setParam(`b${b}gain`, node.gain);
            }}
          />
        </div>
      </div>

      {/* Band selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: NUM_BANDS }, (_, b) => {
          const on = (params[`b${b}on`] ?? 0) > 0.5;
          return (
            <button
              key={b}
              onClick={() => (on ? setSel(b) : (setParam(`b${b}on`, 1), setSel(b)))}
              onDoubleClick={() => setParam(`b${b}on`, on ? 0 : 1)}
              className={`w-8 h-8 rounded-sm text-xs font-semibold border transition-colors ${
                sel === b && on
                  ? 'border-[#E8A030] bg-[#E8A030]/20 text-[#E8A030]'
                  : on
                    ? 'border-[#3A3A3A] bg-[#1A1A1A] text-foreground'
                    : 'border-[#262626] bg-[#131313] text-muted-foreground/50'
              }`}
              style={on ? { color: sel === b ? GOLD : BAND_COLORS[b] } : undefined}
              title={on ? 'Click to select · double-click to disable' : 'Click to enable'}
            >
              {b + 1}
            </button>
          );
        })}
        <span className="text-[10px] text-muted-foreground ml-2">dbl-click toggles band</span>
        <div className="flex-1" />
        <select
          value={Math.round(p('type'))}
          onChange={(e) => set('type', Number(e.target.value))}
          className="h-8 px-2 rounded-sm bg-[#181818] border border-[#333] text-xs text-foreground"
        >
          {TYPE_LABELS.map((t, i) => <option key={t} value={i}>{t}</option>)}
        </select>
      </div>

      {/* Selected band controls */}
      <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-4 rounded-md border border-[#242424] bg-[#111] p-4">
        <Knob label="Freq" value={p('freq')} min={20} max={20000} defaultValue={DEFAULT_FREQS[sel]} log format={fmtHz} onChange={(v) => set('freq', v)} />
        <Knob label="Gain" value={p('gain')} min={-18} max={18} defaultValue={0} format={fmtDb} onChange={(v) => set('gain', v)} />
        <Knob label="Q" value={p('q')} min={0.1} max={12} defaultValue={1} log format={(v) => v.toFixed(2)} onChange={(v) => set('q', v)} />
        <div className="w-px self-stretch bg-[#2A2A2A] mx-1" />
        <ToggleSwitch checked={dynOn} label="Dynamic" onChange={(c) => set('dyn', c ? 1 : 0)} />
        <Knob label="Range" value={p('range')} min={-12} max={12} defaultValue={-3} disabled={!dynOn} format={fmtDb} onChange={(v) => set('range', v)} />
        <Knob label="Thresh" value={p('thresh')} min={-60} max={0} defaultValue={-30} disabled={!dynOn} format={fmtDb} onChange={(v) => set('thresh', v)} />
        <Knob label="Attack" value={p('atk')} min={0.5} max={200} defaultValue={10} log disabled={!dynOn} format={fmtMs} onChange={(v) => set('atk', v)} />
        <Knob label="Release" value={p('rel')} min={20} max={2000} defaultValue={150} log disabled={!dynOn} format={fmtMs} onChange={(v) => set('rel', v)} />
      </div>
    </div>
  );
}

const paramDefs = (() => {
  const defs = [];
  const d = defaults();
  for (const [id, def] of Object.entries(d)) {
    defs.push({ id, label: id, min: -20000, max: 20000, default: def });
  }
  return defs;
})();

export const dynamicEq: PluginDefinition = {
  id: 'eq-master',
  name: 'VA Dynamic EQ',
  category: 'mastering',
  tagline: 'Dynamic 8-band EQ',
  description: 'Eight-band parametric equalizer with per-band dynamics: each node can duck or boost its band based on the program level, for de-harshing, taming resonances, or adaptive tonal shaping.',
  available: true,
  kernelCode: KERNEL,
  params: paramDefs,
  Controls,
  factoryPresets: [
    preset('Gentle Master Tilt', [
      { type: 1, freq: 90, gain: 1.2, q: 0.8 },
      { freq: 350, gain: -0.8, q: 1.2 },
      { freq: 2800, gain: 0.8, q: 1.0 },
      { type: 2, freq: 11000, gain: 1.5, q: 0.8 },
    ]),
    preset('Vocal Master', [
      { type: 3, freq: 70, gain: 0, q: 0.7 },
      { freq: 300, gain: -1.5, q: 1.4 },
      { freq: 3200, gain: 2, q: 1.0, dyn: 1, range: -4, thresh: -26, atk: 4, rel: 120 },
      { type: 2, freq: 10000, gain: 2, q: 0.8 },
    ]),
    preset('De-Harsh', [
      { freq: 2500, gain: 0, q: 1.6, dyn: 1, range: -6, thresh: -28, atk: 2, rel: 90 },
      { freq: 4200, gain: 0, q: 1.8, dyn: 1, range: -5, thresh: -30, atk: 1.5, rel: 80 },
      { freq: 8000, gain: 0, q: 1.4, dyn: 1, range: -4, thresh: -32, atk: 1, rel: 70 },
    ]),
    preset('Tame The Low Mids', [
      { freq: 180, gain: -1, q: 1.2, dyn: 1, range: -4, thresh: -24, atk: 8, rel: 200 },
      { freq: 320, gain: -1.5, q: 1.6, dyn: 1, range: -3, thresh: -26, atk: 10, rel: 250 },
      { type: 2, freq: 9000, gain: 1, q: 0.8 },
    ]),
    preset('EDM Loud', [
      { type: 1, freq: 60, gain: 2.5, q: 0.8 },
      { freq: 250, gain: -2, q: 1.3 },
      { freq: 1000, gain: -1, q: 1.0, dyn: 1, range: -3, thresh: -22, atk: 5, rel: 120 },
      { freq: 4000, gain: 1.5, q: 1.0 },
      { type: 2, freq: 12000, gain: 3, q: 0.8 },
    ]),
    preset('Warm Tape Glow', [
      { type: 1, freq: 120, gain: 2, q: 0.7 },
      { freq: 800, gain: 0.8, q: 0.9 },
      { freq: 3000, gain: -1, q: 1.2 },
      { type: 4, freq: 16000, gain: 0, q: 0.7 },
    ]),
    preset('Bass Control', [
      { type: 1, freq: 80, gain: 0, q: 0.9, dyn: 1, range: -5, thresh: -20, atk: 12, rel: 220 },
      { freq: 55, gain: 1, q: 1.1 },
      { freq: 500, gain: -0.5, q: 1.0 },
    ]),
    preset('Air Lift', [
      { type: 2, freq: 12000, gain: 0, q: 0.8, dyn: 1, range: 4, thresh: -36, atk: 6, rel: 300 },
      { freq: 6000, gain: 0.8, q: 1.0 },
    ]),
  ],
};
