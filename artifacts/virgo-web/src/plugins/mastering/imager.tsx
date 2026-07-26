/**
 * VA Imager — multiband mid/side stereo width with stereoize (Haas micro-delay)
 * and a vectorscope + correlation meter visualization.
 */
import { useEffect, useRef } from 'react';
import type { PluginDefinition, PluginUIProps } from '@/lib/plugin-engine/types';
import { Knob } from '@/components/plugin/Knob';
import { BIQUAD_HELPERS, fmtHz, fmtPct, GOLD } from './kernel-utils';

const KERNEL = `
(sampleRate) => {
${BIQUAD_HELPERS}
  var lpA = makeBiquad(), lpB = makeBiquad();
  var hpA = makeBiquad(), hpB = makeBiquad();
  var lastXLow = -1, lastXHigh = -1;

  // Haas delay for stereoize (side enhancement) ~ 9ms mono-derived side
  var hSamples = Math.max(1, Math.round(0.009 * sampleRate));
  var haas = new Float32Array(hSamples);
  var hw = 0;

  return {
    process(input, output, params) {
      var inL = input[0];
      var inR = input.length > 1 ? input[1] : input[0];
      var outL = output[0];
      var outR = output.length > 1 ? output[1] : output[0];
      var n = outL.length;

      var xLow = params.xLow || 250;
      var xHigh = params.xHigh || 4000;
      if (xLow !== lastXLow || xHigh !== lastXHigh) {
        var cl = biquadCoeffs('lowpass', xLow, 0, 0.707, sampleRate);
        var ch = biquadCoeffs('highpass', xHigh, 0, 0.707, sampleRate);
        lpA.c = cl; lpB.c = cl; hpA.c = ch; hpB.c = ch;
        lastXLow = xLow; lastXHigh = xHigh;
      }

      var wLow = params.widthLow != null ? params.widthLow : 1;
      var wMid = params.widthMid != null ? params.widthMid : 1;
      var wHigh = params.widthHigh != null ? params.widthHigh : 1;
      var stereoize = params.stereoize || 0;

      for (var i = 0; i < n; i++) {
        var l = inL[i], r = inR[i];

        var lowL = bqTickL(lpB, bqTickL(lpA, l));
        var lowR = bqTickR(lpB, bqTickR(lpA, r));
        var highL = bqTickL(hpB, bqTickL(hpA, l));
        var highR = bqTickR(hpB, bqTickR(hpA, r));
        var midL = l - lowL - highL;
        var midR = r - lowR - highR;

        // per-band M/S width
        var m1 = (lowL + lowR) * 0.5, s1 = (lowL - lowR) * 0.5 * wLow;
        var m2 = (midL + midR) * 0.5, s2 = (midL - midR) * 0.5 * wMid;
        var m3 = (highL + highR) * 0.5, s3 = (highL - highR) * 0.5 * wHigh;

        var om = m1 + m2 + m3;
        var os = s1 + s2 + s3;

        // stereoize: delayed mono blended into the side channel
        if (stereoize > 0.001) {
          var mono = om;
          var d = haas[hw];
          haas[hw] = mono;
          hw = (hw + 1) % hSamples;
          os += d * stereoize * 0.5;
        }

        outL[i] = om + os;
        outR[i] = om - os;
      }
    }
  };
}
`;

function Vectorscope({ analyserL, analyserR }: { analyserL?: AnalyserNode | null; analyserR?: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const corrRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const size = analyserL ? analyserL.fftSize : 2048;
    const bufL = new Float32Array(size);
    const bufR = new Float32Array(size);

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

      const cx = W / 2, cy = (H - 26) / 2;
      const rad = Math.min(cx, cy) - 8;

      // Lissajous frame (45° rotated square = L/R axes)
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - rad); ctx.lineTo(cx + rad, cy); ctx.lineTo(cx, cy + rad); ctx.lineTo(cx - rad, cy); ctx.closePath();
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - rad); ctx.lineTo(cx, cy + rad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - rad, cy); ctx.lineTo(cx + rad, cy); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('L', cx - rad - 2, cy - rad * 0.7);
      ctx.fillText('R', cx + rad - 6, cy - rad * 0.7);
      ctx.fillText('+M', cx - 8, cy - rad - 2);

      let corr = 0;
      if (analyserL && analyserR) {
        analyserL.getFloatTimeDomainData(bufL);
        analyserR.getFloatTimeDomainData(bufR);

        // dots
        ctx.fillStyle = 'rgba(232,160,48,0.55)';
        for (let i = 0; i < size; i += 4) {
          const l = bufL[i], r = bufR[i];
          // rotate 45°: x = (r - l), y = -(l + r)
          const x = cx + ((r - l) / 2) * rad * 1.35;
          const y = cy - ((l + r) / 2) * rad * 1.35;
          ctx.fillRect(x, y, 1.5, 1.5);
        }

        // correlation
        let sLR = 0, sLL = 0, sRR = 0;
        for (let i = 0; i < size; i++) { sLR += bufL[i] * bufR[i]; sLL += bufL[i] * bufL[i]; sRR += bufR[i] * bufR[i]; }
        const den = Math.sqrt(sLL * sRR);
        corr = den > 1e-9 ? sLR / den : 0;
      }
      corrRef.current = corrRef.current * 0.9 + corr * 0.1;
      const c = corrRef.current;

      // correlation bar (-1 .. +1)
      const barY = H - 18;
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(30, barY, W - 60, 8);
      const zeroX = 30 + (W - 60) / 2;
      const cX = 30 + ((c + 1) / 2) * (W - 60);
      ctx.fillStyle = c >= 0 ? GOLD : '#E04040';
      ctx.fillRect(Math.min(zeroX, cX), barY, Math.abs(cX - zeroX), 8);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('-1', 12, barY + 8);
      ctx.fillText('+1', W - 24, barY + 8);
      ctx.fillText(`corr ${c.toFixed(2)}`, zeroX - 24, barY - 4);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyserL, analyserR]);

  return <canvas ref={canvasRef} className="w-full rounded-md border border-[#242424]" style={{ height: 240, background: '#0C0C0C' }} />;
}

function Controls({ params, setParam, analyserL, analyserR }: PluginUIProps) {
  const widthKnob = (label: string, id: string) => (
    <Knob
      label={label}
      value={params[id] ?? 1}
      min={0} max={2} defaultValue={1}
      format={(v) => `${Math.round((v - 1) * 100) > 0 ? '+' : ''}${Math.round((v - 1) * 100)}%`}
      size={64}
      onChange={(v) => setParam(id, v)}
    />
  );

  return (
    <div className="space-y-4">
      <Vectorscope analyserL={analyserL} analyserR={analyserR} />
      <div className="flex flex-wrap items-end justify-center gap-x-8 gap-y-4 rounded-md border border-[#242424] bg-[#111] p-4">
        {widthKnob('Low Width', 'widthLow')}
        {widthKnob('Mid Width', 'widthMid')}
        {widthKnob('High Width', 'widthHigh')}
        <div className="w-px self-stretch bg-[#2A2A2A] mx-1" />
        <Knob label="Stereoize" value={params.stereoize ?? 0} min={0} max={1} defaultValue={0} format={fmtPct} onChange={(v) => setParam('stereoize', v)} />
        <Knob label="Low X-Over" value={params.xLow ?? 250} min={60} max={800} defaultValue={250} log format={fmtHz} size={48} onChange={(v) => setParam('xLow', v)} />
        <Knob label="High X-Over" value={params.xHigh ?? 4000} min={1000} max={12000} defaultValue={4000} log format={fmtHz} size={48} onChange={(v) => setParam('xHigh', v)} />
      </div>
    </div>
  );
}

export const imager: PluginDefinition = {
  id: 'imager',
  name: 'VA Imager',
  category: 'mastering',
  tagline: 'Multiband stereo imaging',
  description: 'Three-band mid/side stereo width control with a real-time vectorscope and correlation meter, plus a stereoize control that synthesizes width from mono material.',
  available: true,
  kernelCode: KERNEL,
  Controls,
  params: [
    { id: 'widthLow', label: 'Low Width', min: 0, max: 2, default: 1 },
    { id: 'widthMid', label: 'Mid Width', min: 0, max: 2, default: 1 },
    { id: 'widthHigh', label: 'High Width', min: 0, max: 2, default: 1 },
    { id: 'stereoize', label: 'Stereoize', min: 0, max: 1, default: 0, format: fmtPct },
    { id: 'xLow', label: 'Low X-Over', min: 60, max: 800, default: 250, scale: 'log', format: fmtHz },
    { id: 'xHigh', label: 'High X-Over', min: 1000, max: 12000, default: 4000, scale: 'log', format: fmtHz },
  ],
  factoryPresets: [
    { name: 'Mono Bass, Wide Top', params: { widthLow: 0.2, widthMid: 1.1, widthHigh: 1.4, stereoize: 0, xLow: 150, xHigh: 4000 } },
    { name: 'EDM Wide', params: { widthLow: 0.4, widthMid: 1.3, widthHigh: 1.7, stereoize: 0.15, xLow: 120, xHigh: 3500 } },
    { name: 'Gentle Widen', params: { widthLow: 0.9, widthMid: 1.1, widthHigh: 1.2, stereoize: 0, xLow: 250, xHigh: 4000 } },
    { name: 'Mono Maker', params: { widthLow: 0, widthMid: 0, widthHigh: 0, stereoize: 0, xLow: 250, xHigh: 4000 } },
    { name: 'Vinyl Safe', params: { widthLow: 0.1, widthMid: 1, widthHigh: 1, stereoize: 0, xLow: 300, xHigh: 4000 } },
    { name: 'Stereoize Mono Mix', params: { widthLow: 0.5, widthMid: 1, widthHigh: 1.2, stereoize: 0.55, xLow: 200, xHigh: 3000 } },
    { name: 'Focus Center Vocal', params: { widthLow: 1, widthMid: 0.7, widthHigh: 1.2, stereoize: 0, xLow: 250, xHigh: 5000 } },
    { name: 'Super Wide Air', params: { widthLow: 0.8, widthMid: 1.2, widthHigh: 1.9, stereoize: 0.25, xLow: 200, xHigh: 6000 } },
  ],
};
