/**
 * Shared DSP source fragments injected into plugin kernelCode strings.
 * These run inside the AudioWorklet (see public/worklets/plugin-processor.js),
 * so they must be plain self-contained ES5-ish JavaScript.
 */

/** RBJ biquad coefficient calculator + tiny stereo biquad state helper. */
export const BIQUAD_HELPERS = `
  function biquadCoeffs(type, f0, gainDb, Q, sr) {
    var A = Math.pow(10, gainDb / 40);
    var w0 = 2 * Math.PI * Math.max(10, Math.min(sr * 0.49, f0)) / sr;
    var cw = Math.cos(w0), sw = Math.sin(w0);
    var alpha = sw / (2 * Math.max(0.05, Q));
    var b0, b1, b2, a0, a1, a2;
    if (type === 'peaking') {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else if (type === 'lowshelf') {
      var s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - s;
    } else if (type === 'highshelf') {
      var s2 = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s2);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - s2);
      a0 = (A + 1) - (A - 1) * cw + s2;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - s2;
    } else if (type === 'lowpass') {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else { // bandpass (constant peak gain)
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  function makeBiquad() {
    return { c: null, x1L: 0, x2L: 0, y1L: 0, y2L: 0, x1R: 0, x2R: 0, y1R: 0, y2R: 0 };
  }
  function bqTickL(s, x) {
    var c = s.c;
    var y = c.b0 * x + c.b1 * s.x1L + c.b2 * s.x2L - c.a1 * s.y1L - c.a2 * s.y2L;
    s.x2L = s.x1L; s.x1L = x; s.y2L = s.y1L; s.y1L = y;
    return y;
  }
  function bqTickR(s, x) {
    var c = s.c;
    var y = c.b0 * x + c.b1 * s.x1R + c.b2 * s.x2R - c.a1 * s.y1R - c.a2 * s.y2R;
    s.x2R = s.x1R; s.x1R = x; s.y2R = s.y1R; s.y1R = y;
    return y;
  }

  function dbToLin(db) { return Math.pow(10, db / 20); }
  function linToDb(v) { return v > 1e-7 ? 20 * Math.log10(v) : -140; }

  /** One-pole envelope coefficient from a time constant in ms. */
  function envCoef(ms, sr) {
    return Math.exp(-1 / (Math.max(0.02, ms) * 0.001 * sr));
  }
`;

/** UI-side biquad magnitude response in dB at frequency f (mirrors kernel coefficients). */
export function biquadMagnitudeDb(
  type: string, f0: number, gainDb: number, q: number, f: number, sr = 48000
): number {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.max(10, Math.min(sr * 0.49, f0))) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Math.max(0.05, q));
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'peaking') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else if (type === 'lowshelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cw + s);
    b1 = 2 * A * ((A - 1) - (A + 1) * cw);
    b2 = A * ((A + 1) - (A - 1) * cw - s);
    a0 = (A + 1) + (A - 1) * cw + s;
    a1 = -2 * ((A - 1) + (A + 1) * cw);
    a2 = (A + 1) + (A - 1) * cw - s;
  } else if (type === 'highshelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cw + s);
    b1 = -2 * A * ((A - 1) + (A + 1) * cw);
    b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s;
    a1 = 2 * ((A - 1) - (A + 1) * cw);
    a2 = (A + 1) - (A - 1) * cw - s;
  } else if (type === 'lowpass') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const w = (2 * Math.PI * f) / sr;
  const cosw = Math.cos(w), cos2w = Math.cos(2 * w);
  const num = (b0 + b1 + b2) ** 2 / 4 * 0 // placeholder to keep formula explicit below
    + (b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * cosw + 2 * b0 * b2 * cos2w);
  const den = 1 + a1 * a1 + a2 * a2 + 2 * (a1 + a1 * a2) * cosw + 2 * a2 * cos2w;
  const mag = Math.sqrt(Math.max(1e-12, num / Math.max(1e-12, den)));
  return 20 * Math.log10(mag);
}

export const GOLD = '#E8A030';

export function fmtHz(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
}
export function fmtDb(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
}
export function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
export function fmtMs(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v.toFixed(v < 10 ? 1 : 0)} ms`;
}
