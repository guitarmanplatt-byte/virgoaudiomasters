/**
 * VA Maximizer — lookahead brickwall limiter with true-peak-style ceiling,
 * release character, plus loudness (LUFS-style / peak) and GR metering.
 */
import { useEffect, useRef } from 'react';
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { Knob } from '@/components/plugin/Knob';
import { SpectrumAnalyzer } from '@/components/plugin/SpectrumAnalyzer';
import { BIQUAD_HELPERS, fmtDb, fmtMs, GOLD } from './kernel-utils';

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}
  // 2ms lookahead delay
  var laSamples = Math.max(1, Math.round(0.002 * sampleRate));
  var delL = new Float32Array(laSamples);
  var delR = new Float32Array(laSamples);
  var w = 0;
  var gain = 1;      // smoothed limiter gain
  var peakHold = new Float32Array(laSamples);
  var ph = 0;

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      var boost = dbToLin(params.threshold != null ? -params.threshold : 0); // threshold = input drive (dB of boost)
      var ceiling = dbToLin(params.ceiling != null ? params.ceiling : -0.3);
      var character = Math.max(0, Math.min(1, params.character != null ? params.character : 0.5));
      // character 0 = transparent (slow ~400ms), 1 = aggressive (fast ~30ms)
      var relMs = 400 - character * 370;
      var relC = envCoef(relMs, sampleRate);
      // attack over the lookahead window
      var atkC = envCoef(0.4, sampleRate);

      for (var i = 0; i < n; i++) {
        var l = inL[i] * boost;
        var r = inR[i] * boost;

        // write into lookahead delay
        var dl = delL[w], dr = delR[w];
        delL[w] = l; delR[w] = r;
        w = (w + 1) % laSamples;

        // future peak within the lookahead window (cheap running max over ring)
        var det = Math.max(Math.abs(l), Math.abs(r));
        peakHold[ph] = det;
        ph = (ph + 1) % laSamples;
        var maxPeak = 0;
        for (var k = 0; k < laSamples; k++) if (peakHold[k] > maxPeak) maxPeak = peakHold[k];

        var target = maxPeak > ceiling ? ceiling / maxPeak : 1;
        var coef = target < gain ? atkC : relC;
        gain = coef * gain + (1 - coef) * target;

        var og = Math.min(gain, 1);
        var ol = dl * og, or_ = dr * og;
        // final hard safety clip at the ceiling (true-peak style guard)
        if (ol > ceiling) ol = ceiling; else if (ol < -ceiling) ol = -ceiling;
        if (or_ > ceiling) or_ = ceiling; else if (or_ < -ceiling) or_ = -ceiling;
        outL[i] = ol;
        outR[i] = or_;
      }
    }
  };
}
`;

function Controls({ params, setParam, analyser, inputAnalyser, definition }: PluginUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lufsRef = useRef({ sum: 0, count: 0, short: -70 });

  const threshold = params.threshold ?? 0;
  const ceiling = params.ceiling ?? -0.3;

  useEffect(() => {
    let raf = 0;
    const inBuf = new Float32Array(inputAnalyser ? inputAnalyser.fftSize : 2048);
    const outBuf = new Float32Array(analyser ? analyser.fftSize : 2048);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr); }
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0E0E0E';
      ctx.fillRect(0, 0, W, H);

      let inPeak = 0, outPeak = 0, outRms = 0;
      if (inputAnalyser) {
        inputAnalyser.getFloatTimeDomainData(inBuf);
        for (let i = 0; i < inBuf.length; i++) { const a = Math.abs(inBuf[i]); if (a > inPeak) inPeak = a; }
      }
      if (analyser) {
        analyser.getFloatTimeDomainData(outBuf);
        for (let i = 0; i < outBuf.length; i++) {
          const a = Math.abs(outBuf[i]);
          if (a > outPeak) outPeak = a;
          outRms += outBuf[i] * outBuf[i];
        }
        outRms = Math.sqrt(outRms / outBuf.length);
      }
      const inDb = inPeak > 0 ? 20 * Math.log10(inPeak) : -70;
      const outDb = outPeak > 0 ? 20 * Math.log10(outPeak) : -70;
      // Estimated GR: input (post threshold drive) exceeding ceiling
      const gr = Math.max(0, inDb + threshold - Math.max(outDb, ceiling));
      // LUFS-ish momentary: RMS - ~0.7dB offset (rough K-weighting approx)
      const mom = outRms > 0 ? 20 * Math.log10(outRms) - 0.7 : -70;
      const s = lufsRef.current;
      s.short = s.short === -70 ? mom : s.short * 0.97 + mom * 0.03;
      if (mom > -60) { s.sum += Math.pow(10, mom / 10); s.count++; }
      const integ = s.count > 0 ? 10 * Math.log10(s.sum / s.count) : -70;

      // ── draw three horizontal meters + readouts ──
      ctx.font = '10px ui-monospace, monospace';
      const rows: { label: string; value: string; frac: number; color: string }[] = [
        { label: 'GAIN REDUCTION', value: `${gr.toFixed(1)} dB`, frac: Math.min(1, gr / 18), color: '#E04040' },
        { label: 'OUTPUT PEAK', value: `${outDb.toFixed(1)} dBFS`, frac: Math.min(1, Math.max(0, (outDb + 40) / 40)), color: GOLD },
        { label: 'SHORT-TERM LOUDNESS', value: `${s.short.toFixed(1)} LUFS`, frac: Math.min(1, Math.max(0, (s.short + 40) / 40)), color: '#C8B060' },
        { label: 'INTEGRATED', value: `${integ.toFixed(1)} LUFS`, frac: Math.min(1, Math.max(0, (integ + 40) / 40)), color: '#7FB06A' },
      ];
      const rowH = H / rows.length;
      rows.forEach((row, i) => {
        const y = i * rowH;
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        ctx.fillText(row.label, 10, y + 14);
        ctx.fillStyle = '#1A1A1A';
        ctx.fillRect(10, y + 20, W - 110, 10);
        ctx.fillStyle = row.color;
        ctx.fillRect(10, y + 20, (W - 110) * row.frac, 10);
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.fillText(row.value, W - 92, y + 29);
        ctx.font = '10px ui-monospace, monospace';
      });
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, inputAnalyser, threshold, ceiling]);

  return (
    <div className="space-y-4">
      <SpectrumAnalyzer analyser={analyser} referenceAnalyser={inputAnalyser} height={150} />
      <canvas ref={canvasRef} className="w-full rounded-md border border-[#242424]" style={{ height: 140, background: '#0E0E0E' }} />
      <div className="flex flex-wrap items-end justify-center gap-x-8 gap-y-4 rounded-md border border-[#242424] bg-[#111] p-4">
        {definition.params.map((p) => (
          <Knob
            key={p.id}
            label={p.label}
            value={params[p.id] ?? p.default}
            min={p.min} max={p.max} defaultValue={p.default}
            log={p.scale === 'log'}
            format={p.format}
            size={p.id === 'threshold' ? 76 : 64}
            onChange={(v) => setParam(p.id, v)}
          />
        ))}
      </div>
    </div>
  );
}

export const limiter: PluginDefinition = {
  id: 'maximizer',
  name: 'VA Maximizer',
  category: 'mastering',
  tagline: 'Lookahead brickwall limiter',
  description: 'Final-stage loudness maximizer: lookahead brickwall limiting with a true-peak-style ceiling, release character morphing from transparent to aggressive, and LUFS/peak/gain-reduction metering.',
  available: true,
  kernelCode: KERNEL,
  Controls,
  params: [
    { id: 'threshold', label: 'Threshold', min: -24, max: 0, default: -6, format: fmtDb },
    { id: 'ceiling', label: 'Ceiling', min: -3, max: 0, default: -0.3, format: (v) => `${v.toFixed(2)} dB` },
    { id: 'character', label: 'Character', min: 0, max: 1, default: 0.5, format: (v) => (v < 0.33 ? 'Transparent' : v < 0.67 ? 'Balanced' : 'Aggressive') },
  ],
  factoryPresets: [
    { name: 'Streaming -14 LUFS', params: { threshold: -5, ceiling: -1, character: 0.35 } },
    { name: 'EDM Loud', params: { threshold: -12, ceiling: -0.3, character: 0.8 } },
    { name: 'Transparent Master', params: { threshold: -3, ceiling: -0.5, character: 0.15 } },
    { name: 'CD Master', params: { threshold: -8, ceiling: -0.2, character: 0.5 } },
    { name: 'Club Slam', params: { threshold: -15, ceiling: -0.1, character: 0.95 } },
    { name: 'Podcast Safe', params: { threshold: -6, ceiling: -1.5, character: 0.4 } },
    { name: 'Vinyl Pre-Master', params: { threshold: -4, ceiling: -2, character: 0.2 } },
  ],
  demoClip: '/demos/mastering-generic.wav',
};
