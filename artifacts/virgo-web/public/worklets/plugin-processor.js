/**
 * Shared AudioWorklet processor for the Virgo plugin suite.
 * Loaded by both the real-time AudioContext and the OfflineAudioContext so
 * live preview and export run identical DSP.
 *
 * processorOptions: { kernelCode, params, bypass }
 *   kernelCode: source of a factory `(sampleRate) => kernel` where kernel has
 *   process(inputs: Float32Array[], outputs: Float32Array[], params).
 * Port messages: { type: 'params', params } | { type: 'bypass', value }
 */
class VirgoPluginProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.params = Object.assign({}, opts.params || {});
    this.bypass = !!opts.bypass;
    this.kernel = null;
    try {
      const factory = new Function('return (' + opts.kernelCode + ')')();
      this.kernel = factory(sampleRate);
    } catch (e) {
      this.kernel = null; // passthrough
    }
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'params') this.params = Object.assign({}, this.params, msg.params);
      else if (msg.type === 'bypass') this.bypass = !!msg.value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    if (this.bypass || !this.kernel) {
      for (let c = 0; c < output.length; c++) {
        const src = input[Math.min(c, input.length - 1)];
        if (src) output[c].set(src);
      }
      return true;
    }

    try {
      this.kernel.process(input, output, this.params);
    } catch (e) {
      for (let c = 0; c < output.length; c++) {
        const src = input[Math.min(c, input.length - 1)];
        if (src) output[c].set(src);
      }
    }
    return true;
  }
}
registerProcessor('virgo-plugin-processor', VirgoPluginProcessor);
