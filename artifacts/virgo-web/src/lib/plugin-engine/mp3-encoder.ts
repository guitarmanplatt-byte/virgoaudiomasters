import { Mp3Encoder } from '@breezystack/lamejs';

/** Encode an AudioBuffer to an MP3 Blob (320 kbps CBR). */
export function encodeToMp3(
  buffer: AudioBuffer,
  kbps = 320,
  onProgress?: (pct: number) => void
): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);

  const left = toInt16(buffer.getChannelData(0));
  const right = channels === 2 ? toInt16(buffer.getChannelData(1)) : null;

  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  const total = left.length;
  for (let i = 0; i < total; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right ? right.subarray(i, i + blockSize) : undefined;
    const mp3buf = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
    if (onProgress && i % (blockSize * 200) === 0) {
      onProgress(Math.round((i / total) * 100));
    }
  }
  const end = encoder.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));
  onProgress?.(100);

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}

function toInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
