/**
 * VA Compressor — mastering compressor with soft knee, program-dependent
 * release, makeup and parallel mix. Custom UI draws the transfer curve and a
 * live gain-reduction trace estimated from the input analyser.
 */
import { useEffect, useRef } from 'react';
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { Knob } from '@/components/plugin/Knob';
import { ToggleSwitch } from '@/components/plugin/ToggleSwitch';
import { BIQUAD_HELPERS, fmtDb, fmtMs, fmtPct, GOLD } from './kernel-utils';

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}
  var env = 0;        // linear detector envelope
  var grDb = 0;       // smoothed gain reduction in dB
  var relEnv = 0;     // slow envelope for program-dependent release

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      var thresh = params.threshold != null ? params.threshold : -18;
      var ratio = Math.max(1, params.ratio || 4);
      var knee = Math.max(0, params.knee || 6);
      var atkC = envCoef(params.attack || 10, sampleRate);
      var relMs = params.release || 200;
      var auto = (params.autoRelease || 0) > 0.5;
      var makeup = dbToLin(params.makeup || 0);
      var mix = Math.max(0, Math.min(1, params.mix != null ? params.mix : 1));
      var slowC = envCoef(800, sampleRate);

      for (var i = 0; i < n; i++) {
        var l = inL[i], r = inR[i];
        var det = Math.max(Math.abs(l), Math.abs(r));

        // program-dependent release: transient material -> faster release
        relEnv = slowC * relEnv + (1 - slowC) * det;
        var effRelMs = relMs;
        if (auto) {
          var crest = det > 1e-6 && relEnv > 1e-6 ? det / relEnv : 1;
          effRelMs = relMs / Math.max(0.5, Math.min(4, crest));
        }
        var relC = envCoef(effRelMs, sampleRate);

        var coef = det > env ? atkC : relC;
        env = coef * env + (1 - coef) * det;

        var lvlDb = linToDb(env);
        var over = lvlDb - thresh;
        var gr = 0;
        if (knee > 0 && over > -knee / 2 && over < knee / 2) {
          var x = over + knee / 2;
          gr = ((1 / ratio - 1) * x * x) / (2 * knee);
        } else if (over >= knee / 2) {
          gr = (1 / ratio - 1) * over;
        }
        grDb = 0.9995 * grDb + 0.0005 * gr; // light smoothing to avoid zipper
        var g = dbToLin(gr) * makeup;

        outL[i] = l * (1 - mix) + l * g * mix;
        outR[i] = r * (1 - mix) + r * g * mix;
      }
    }
  };
}
`;

/** Static transfer curve value: input dB → output dB. */
function transfer(inDb: number, thresh: number, ratio: number, knee: number): number {
  const over = inDb - thresh;
  if (knee > 0 && over > -knee / 2 && over < knee / 2) {
    const x = over + knee / 2;
    return inDb + ((1 / ratio - 1) * x * x) / (2 * knee);
  }
  if (over >= knee / 2) return thresh + over / ratio;
  return inDb;
}

function Controls({ params, setParam, analyser, inputAnalyser, definition }: PluginUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>([]);

  const thresh = params.threshold ?? -18;
  const ratio = params.ratio ?? 4;
  const knee = params.knee ?? 6;

  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(inputAnalyser ? inputAnalyser.fftSize : 2048);
    const MIN = -60;

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
      ctx.fillStyle = '#0C0C0C';
      ctx.fillRect(0, 0, W, H);

      const curveW = Math.min(H, W * 0.42);
      const xOf = (db: number) => ((db - MIN) / -MIN) * curveW;
      const yOf = (db: number) => H - ((db - MIN) / -MIN) * H;

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '9px ui-monospace, monospace';
      for (let db = -50; db < 0; db += 10) {
        ctx.beginPath(); ctx.moveTo(xOf(db), 0); ctx.lineTo(xOf(db), H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, yOf(db)); ctx.lineTo(curveW, yOf(db)); ctx.stroke();
        ctx.fillText(`${db}`, xOf(db) + 2, H - 3);
      }
      // unity line
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.moveTo(xOf(MIN), yOf(MIN)); ctx.lineTo(xOf(0), yOf(0)); ctx.stroke();

      // transfer curve
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let db = MIN; db <= 0; db += 0.5) {
        const x = xOf(db), y = yOf(transfer(db, thresh, ratio, knee));
        if (db === MIN) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;

      // live input level dot + GR estimate
      let inDb = MIN;
      if (inputAnalyser) {
        inputAnalyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
        inDb = peak > 0 ? Math.max(MIN, 20 * Math.log10(peak)) : MIN;
      }
      const outDb = transfer(inDb, thresh, ratio, knee);
      const gr = Math.max(0, inDb - outDb);
      if (inDb > MIN + 1) {
        ctx.fillStyle = '#FFF0D0';
        ctx.beginPath(); ctx.arc(xOf(inDb), yOf(outDb), 4, 0, Math.PI * 2); ctx.fill();
      }

      // GR history strip (right side)
      const hist = historyRef.current;
      hist.push(gr);
      const stripX = curveW + 16;
      const stripW = W - stripX - 8;
      const maxPts = Math.max(10, Math.floor(stripW));
      while (hist.length > maxPts) hist.shift();

      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillText('GAIN REDUCTION', stripX, 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      for (const g of [0, 6, 12, 18]) {
        const y = 18 + (g / 24) * (H - 30);
        ctx.beginPath(); ctx.moveTo(stripX, y); ctx.lineTo(W - 8, y); ctx.stroke();
        ctx.fillText(`-${g}`, W - 26, y - 2);
      }
      ctx.strokeStyle = GOLD;
      ctx.beginPath();
      hist.forEach((g, i) => {
        const x = stripX + (i / maxPts) * stripW;
        const y = 18 + (Math.min(24, g) / 24) * (H - 30);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // current GR bar
      ctx.fillStyle = 'rgba(232,160,48,0.25)';
      ctx.fillRect(W - 14, 18, 5, (Math.min(24, gr) / 24) * (H - 30));
      ctx.fillStyle = GOLD;
      ctx.fillText(`${gr.toFixed(1)} dB`, stripX, H - 4);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [inputAnalyser, analyser, thresh, ratio, knee]);

  return (
    <div className="space-y-4">
      <canvas ref={canvasRef} className="w-full rounded-md border border-[#242424]" style={{ height: 220, background: '#0C0C0C' }} />
      <div className="flex flex-wrap items-end justify-center gap-x-7 gap-y-4 rounded-md border border-[#242424] bg-[#111] p-4">
        {definition.params.filter((p) => p.id !== 'autoRelease').map((p) => (
          <Knob
            key={p.id}
            label={p.label}
            value={params[p.id] ?? p.default}
            min={p.min} max={p.max} defaultValue={p.default}
            log={p.scale === 'log'}
            format={p.format}
            onChange={(v) => setParam(p.id, v)}
          />
        ))}
        <ToggleSwitch
          checked={(params.autoRelease ?? 0) > 0.5}
          label="Auto Rel"
          onChange={(c) => setParam('autoRelease', c ? 1 : 0)}
        />
      </div>
    </div>
  );
}

export const compressor: PluginDefinition = {
  id: 'dynamics',
  name: 'VA Compressor',
  category: 'mastering',
  tagline: 'Mastering compressor',
  description: 'Soft-knee mastering compressor with program-dependent auto release, makeup gain and parallel mix, visualized with a live transfer curve and gain-reduction trace.',
  available: true,
  kernelCode: KERNEL,
  Controls,
  params: [
    { id: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, format: fmtDb },
    { id: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, scale: 'log', format: (v) => `${v.toFixed(1)}:1` },
    { id: 'knee', label: 'Knee', min: 0, max: 24, default: 6, format: (v) => `${v.toFixed(1)} dB` },
    { id: 'attack', label: 'Attack', min: 0.1, max: 250, default: 10, scale: 'log', format: fmtMs },
    { id: 'release', label: 'Release', min: 20, max: 2500, default: 200, scale: 'log', format: fmtMs },
    { id: 'makeup', label: 'Makeup', min: 0, max: 24, default: 0, format: fmtDb },
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, format: fmtPct },
    { id: 'autoRelease', label: 'Auto Release', min: 0, max: 1, default: 1, step: 1 },
  ],
  factoryPresets: [
    { name: 'Glue Master', params: { threshold: -20, ratio: 2, knee: 12, attack: 30, release: 300, makeup: 1.5, mix: 1, autoRelease: 1 } },
    { name: 'Vocal Master', params: { threshold: -24, ratio: 3, knee: 8, attack: 8, release: 180, makeup: 3, mix: 1, autoRelease: 1 } },
    { name: 'EDM Loud', params: { threshold: -18, ratio: 6, knee: 4, attack: 2, release: 90, makeup: 5, mix: 1, autoRelease: 0 } },
    { name: 'Punch Keeper', params: { threshold: -16, ratio: 4, knee: 6, attack: 40, release: 150, makeup: 2, mix: 1, autoRelease: 1 } },
    { name: 'Parallel Thickener', params: { threshold: -35, ratio: 8, knee: 6, attack: 1, release: 120, makeup: 8, mix: 0.35, autoRelease: 1 } },
    { name: 'Gentle Leveler', params: { threshold: -26, ratio: 1.6, knee: 18, attack: 60, release: 600, makeup: 1, mix: 1, autoRelease: 1 } },
    { name: 'Drum Bus Smash', params: { threshold: -22, ratio: 10, knee: 3, attack: 5, release: 80, makeup: 6, mix: 0.6, autoRelease: 0 } },
    { name: 'Warm Tape Squeeze', params: { threshold: -19, ratio: 2.5, knee: 14, attack: 15, release: 400, makeup: 2, mix: 0.85, autoRelease: 1 } },
  ],
};
