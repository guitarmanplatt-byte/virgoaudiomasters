/**
 * Client-side audio processing utilities.
 * - Decode audio files into AudioBuffers
 * - Render through EQ + mastering chain via OfflineAudioContext
 * - Encode AudioBuffer → WAV (16-bit, 24-bit, 32-bit float)
 * - Draw a real waveform onto a <canvas>
 */

export interface EqBand {
  frequency: number;
  gain: number;
  q: number;
  type: string;
}

export interface MasteringParams {
  enabled: boolean;
  compressionAmount: number;
  targetLufs: number;
  exciterAmount: number;
  dynamicEqAmount: number;
}

export type WavBitDepth = 16 | 24 | 32;

export type OutputFormat = 'wav-16' | 'wav-24' | 'wav-32f';

export const OUTPUT_FORMATS: {
  value: OutputFormat;
  label: string;
  description: string;
}[] = [
  {
    value: 'wav-16',
    label: 'WAV 16-bit',
    description: 'CD Quality · universally compatible',
  },
  {
    value: 'wav-24',
    label: 'HD WAV 24-bit',
    description: 'Studio Master · full dynamic range',
  },
  {
    value: 'wav-32f',
    label: 'WAV 32-bit Float',
    description: 'Maximum precision · no quantization noise',
  },
];

/** Decode a File into an AudioBuffer (creates and immediately closes a temp AudioContext). */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

/** Fetch a URL and decode it into an AudioBuffer. */
export async function fetchAndDecodeAudio(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

/**
 * Render audio through an EQ filter chain + mastering chain offline.
 * onProgress receives values 0-100.
 */
export async function renderWithEffects(
  sourceBuffer: AudioBuffer,
  eqBands: EqBand[],
  mastering: MasteringParams,
  onProgress?: (pct: number) => void
): Promise<AudioBuffer> {
  onProgress?.(5);

  const offline = new OfflineAudioContext(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate
  );

  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;

  let node: AudioNode = source;

  // ── EQ ──────────────────────────────────────────────────────────────────
  for (const band of eqBands) {
    const f = offline.createBiquadFilter();
    f.type = band.type as BiquadFilterType;
    f.frequency.value = band.frequency;
    f.gain.value = band.gain;
    f.Q.value = band.q;
    node.connect(f);
    node = f;
  }

  if (mastering.enabled) {
    // ── Dynamics compression ────────────────────────────────────────────
    if (mastering.compressionAmount > 0.01) {
      const comp = offline.createDynamicsCompressor();
      const a = mastering.compressionAmount;
      comp.threshold.value = -12 - a * 22; // -12 → -34 dB
      comp.ratio.value = 2 + a * 12;       // 2:1 → 14:1
      comp.knee.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      node.connect(comp);
      node = comp;
    }

    // ── Exciter (soft-knee waveshaper for harmonic saturation) ──────────
    if (mastering.exciterAmount > 0.05) {
      const shaper = offline.createWaveShaper();
      const k = mastering.exciterAmount * 80;
      const curve = new Float32Array(4096);
      for (let i = 0; i < 4096; i++) {
        const x = (i * 2) / 4096 - 1;
        curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
      }
      shaper.curve = curve;
      shaper.oversample = '4x';
      node.connect(shaper);
      node = shaper;
    }

    // ── LUFS gain offset (relative to -14 LUFS reference) ───────────────
    const gainDb = mastering.targetLufs - -14;
    if (Math.abs(gainDb) > 0.05) {
      const gainNode = offline.createGain();
      gainNode.gain.value = Math.pow(10, gainDb / 20);
      node.connect(gainNode);
      node = gainNode;
    }
  }

  node.connect(offline.destination);
  source.start(0);

  onProgress?.(15);
  const rendered = await offline.startRendering();
  onProgress?.(90);
  return rendered;
}

// ── WAV encoder ─────────────────────────────────────────────────────────────

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** Encode an AudioBuffer to a WAV Blob. bitDepth: 16 (PCM), 24 (PCM), 32 (float). */
export function encodeToWav(buffer: AudioBuffer, bitDepth: WavBitDepth): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const numSamples = buffer.length;
  const bps = bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : 2;
  const dataSize = numSamples * numCh * bps;
  const isFloat = bitDepth === 32;

  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  writeStr(view, 0,  'RIFF');
  view.setUint32(4,  36 + dataSize, true);
  writeStr(view, 8,  'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);               // fmt chunk size
  view.setUint16(20, isFloat ? 3 : 1, true);  // 1=PCM, 3=float
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * bps, true); // byte rate
  view.setUint16(32, numCh * bps, true);      // block align
  view.setUint16(34, bitDepth, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: numCh }, (_, c) => buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      if (bitDepth === 32) {
        view.setFloat32(off, s, true); off += 4;
      } else if (bitDepth === 24) {
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        view.setUint8(off,     v & 0xff);
        view.setUint8(off + 1, (v >> 8)  & 0xff);
        view.setUint8(off + 2, (v >> 16) & 0xff);
        off += 3;
      } else {
        view.setInt16(off, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true); off += 2;
      }
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

/** Format seconds as m:ss */
export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Draw a real amplitude waveform on a canvas from an AudioBuffer.
 * Call this inside a useEffect whenever the canvas ref and buffer are both available.
 */
export function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.offsetWidth  || canvas.width;
  const cssH = canvas.offsetHeight || canvas.height;

  // Scale for sharp rendering on HiDPI displays
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width  = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.scale(dpr, dpr);
  }

  const W = cssW;
  const H = cssH;

  ctx.clearRect(0, 0, W, H);

  // Dark background matching app theme
  ctx.fillStyle = 'hsl(0,0%,5%)';
  ctx.fillRect(0, 0, W, H);

  // Mix down all channels to mono
  const numCh = buffer.numberOfChannels;
  const len   = buffer.length;
  const mono  = new Float32Array(len);
  for (let c = 0; c < numCh; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i] / numCh;
  }

  const barW = 2;
  const gap  = 1;
  const totalBars = Math.floor(W / (barW + gap));
  const samplesPerBar = Math.floor(len / totalBars) || 1;

  // Gold gradient — fills from center outward
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    'rgba(232,160,48,0.45)');
  grad.addColorStop(0.35, 'rgba(232,160,48,0.85)');
  grad.addColorStop(0.5,  'rgba(232,160,48,1.0)');
  grad.addColorStop(0.65, 'rgba(232,160,48,0.85)');
  grad.addColorStop(1,    'rgba(232,160,48,0.45)');
  ctx.fillStyle = grad;

  for (let i = 0; i < totalBars; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    for (let j = 0; j < samplesPerBar && start + j < len; j++) {
      const abs = Math.abs(mono[start + j]);
      if (abs > peak) peak = abs;
    }
    const barH = Math.max(1, peak * H * 0.95);
    const x = i * (barW + gap);
    const y = (H - barH) / 2;
    ctx.fillRect(x, y, barW, barH);
  }
}
