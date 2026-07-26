/**
 * The shared AudioWorklet processor lives at public/worklets/plugin-processor.js
 * and is served as a static file (blob-URL worklet modules hang/fail in some
 * environments). Both the real-time AudioContext and OfflineAudioContext load
 * the same module, so live preview and export run identical DSP.
 *
 * Each plugin supplies `kernelCode`: the JS source of a factory function
 * `(sampleRate) => kernel` where kernel = {
 *   process(inputs: Float32Array[], outputs: Float32Array[], params: Record<string, number>): void
 * }
 * passed via processorOptions. Parameters update live via port messages.
 */
export const PLUGIN_PROCESSOR_NAME = 'virgo-plugin-processor';

/** URL of the worklet module (respects the artifact base path). */
export function getWorkletUrl(): string {
  return `${import.meta.env.BASE_URL}worklets/plugin-processor.js`;
}
