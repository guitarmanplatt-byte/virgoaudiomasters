/**
 * Real-time Web Audio engine for the plugin suite.
 *
 * Graph:  source → inputGain → [inputAnalyser] → worklet(plugin DSP) →
 *         outputGain → [outputAnalyser] → destination
 *
 * The same AudioWorklet processor (see worklet-source.ts) is reused by
 * renderOffline() through an OfflineAudioContext, so the exported file is
 * bit-identical to what the user hears (minus real-time param automation).
 */
import { getWorkletUrl, PLUGIN_PROCESSOR_NAME } from './worklet-source';

export interface TransportState {
  isPlaying: boolean;
  position: number; // seconds
  duration: number;
  loop: boolean;
}

export class PluginAudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private inputGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  inputAnalyser: AnalyserNode | null = null;
  outputAnalyser: AnalyserNode | null = null;
  /** Per-channel output analysers (L/R) for stereo visualizations. */
  outputAnalyserL: AnalyserNode | null = null;
  outputAnalyserR: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;

  private kernelCode: string;
  private params: Record<string, number>;
  private bypass = false;
  private inputGainDb = 0;
  private outputGainDb = 0;

  private startedAt = 0; // ctx.currentTime when playback started
  private offset = 0; // seconds into the buffer where playback started
  isPlaying = false;
  loop = false;

  onEnded: (() => void) | null = null;

  constructor(kernelCode: string, initialParams: Record<string, number>) {
    this.kernelCode = kernelCode;
    this.params = { ...initialParams };
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get audioBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  get position(): number {
    if (!this.ctx || !this.buffer) return 0;
    if (!this.isPlaying) return this.offset;
    let pos = this.offset + (this.ctx.currentTime - this.startedAt);
    if (this.loop && this.buffer.duration > 0) pos = pos % this.buffer.duration;
    return Math.min(pos, this.buffer.duration);
  }

  async loadFile(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    // Decode with a throwaway context so loading never depends on (or blocks
    // on) worklet/graph setup — that happens lazily on first play().
    const tmp = new AudioContext();
    try {
      const buf = await tmp.decodeAudioData(arrayBuffer);
      this.stop();
      this.buffer = buf;
      this.offset = 0;
      return buf;
    } finally {
      tmp.close();
    }
  }

  private async ensureContext(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext();
    // Some constrained environments (e.g. headless browsers) never resolve
    // addModule on a realtime context. Fall back to a passthrough graph so
    // transport still works; offline export always uses the worklet DSP.
    let workletOk = true;
    await Promise.race([
      ctx.audioWorklet.addModule(getWorkletUrl()),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          workletOk = false;
          resolve();
        }, 4000)
      ),
    ]);

    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.inputAnalyser = ctx.createAnalyser();
    this.inputAnalyser.fftSize = 4096;
    this.inputAnalyser.smoothingTimeConstant = 0.82;
    this.outputAnalyser = ctx.createAnalyser();
    this.outputAnalyser.fftSize = 4096;
    this.outputAnalyser.smoothingTimeConstant = 0.82;

    if (workletOk) {
      this.worklet = new AudioWorkletNode(ctx, PLUGIN_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          kernelCode: this.kernelCode,
          params: this.params,
          bypass: this.bypass,
        },
      });
    } else {
      this.worklet = null;
      console.warn('[plugin-engine] realtime worklet unavailable — playing passthrough; export still uses full DSP');
    }

    this.inputGain.gain.value = dbToLinear(this.inputGainDb);
    this.outputGain.gain.value = dbToLinear(this.outputGainDb);

    this.inputGain.connect(this.inputAnalyser);
    if (this.worklet) {
      this.inputAnalyser.connect(this.worklet);
      this.worklet.connect(this.outputGain);
    } else {
      this.inputAnalyser.connect(this.outputGain);
    }
    this.outputGain.connect(this.outputAnalyser);
    this.outputAnalyser.connect(ctx.destination);

    // Stereo tap for vectorscope/correlation visualizations
    this.splitter = ctx.createChannelSplitter(2);
    this.outputAnalyserL = ctx.createAnalyser();
    this.outputAnalyserL.fftSize = 2048;
    this.outputAnalyserR = ctx.createAnalyser();
    this.outputAnalyserR.fftSize = 2048;
    this.outputGain.connect(this.splitter);
    this.splitter.connect(this.outputAnalyserL, 0);
    this.splitter.connect(this.outputAnalyserR, 1);

    this.ctx = ctx;
  }

  setParams(params: Record<string, number>): void {
    this.params = { ...params };
    this.worklet?.port.postMessage({ type: 'params', params: this.params });
  }

  setParam(id: string, value: number): void {
    this.params[id] = value;
    this.worklet?.port.postMessage({ type: 'params', params: { [id]: value } });
  }

  setBypass(bypass: boolean): void {
    this.bypass = bypass;
    this.worklet?.port.postMessage({ type: 'bypass', value: bypass });
  }

  setInputGainDb(db: number): void {
    this.inputGainDb = db;
    if (this.inputGain && this.ctx) {
      this.inputGain.gain.setTargetAtTime(dbToLinear(db), this.ctx.currentTime, 0.01);
    }
  }

  setOutputGainDb(db: number): void {
    this.outputGainDb = db;
    if (this.outputGain && this.ctx) {
      this.outputGain.gain.setTargetAtTime(dbToLinear(db), this.ctx.currentTime, 0.01);
    }
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.source) this.source.loop = loop;
  }

  async play(): Promise<void> {
    if (!this.buffer) return;
    await this.ensureContext();
    if (this.ctx!.state === 'suspended') {
      // Don't block playback on resume() — in some environments it never
      // resolves. Start the source anyway; audio flows once running.
      await Promise.race([
        this.ctx!.resume().catch(() => undefined),
        new Promise<void>((r) => setTimeout(r, 1000)),
      ]);
    }
    if (this.isPlaying) return;
    this.startSource(this.offset);
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.offset = this.position;
    this.stopSource();
  }

  stop(): void {
    this.stopSource();
    this.offset = 0;
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.duration));
    if (this.isPlaying) {
      this.stopSource();
      this.offset = clamped;
      this.startSource(clamped);
    } else {
      this.offset = clamped;
    }
  }

  private startSource(offset: number): void {
    if (!this.ctx || !this.buffer || !this.inputGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.loop;
    src.connect(this.inputGain);
    src.onended = () => {
      // Natural end of (non-looping) playback
      if (this.source === src && this.isPlaying) {
        this.isPlaying = false;
        this.offset = 0;
        this.source = null;
        this.onEnded?.();
      }
    };
    src.start(0, offset);
    this.source = src;
    this.startedAt = this.ctx.currentTime;
    this.offset = offset;
    this.isPlaying = true;
  }

  private stopSource(): void {
    if (this.source) {
      const src = this.source;
      this.source = null; // prevent onended handler from treating this as natural end
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.isPlaying = false;
  }

  /**
   * Offline (faster-than-real-time) render through the exact same worklet DSP.
   * Returns the fully processed AudioBuffer for encoding/export.
   */
  async renderOffline(onProgress?: (pct: number) => void): Promise<AudioBuffer> {
    if (!this.buffer) throw new Error('No audio loaded');
    onProgress?.(5);
    const channels = Math.max(2, this.buffer.numberOfChannels);
    const offline = new OfflineAudioContext(channels, this.buffer.length, this.buffer.sampleRate);
    await offline.audioWorklet.addModule(getWorkletUrl());

    const src = offline.createBufferSource();
    src.buffer = this.buffer;

    const inGain = offline.createGain();
    inGain.gain.value = dbToLinear(this.inputGainDb);
    const outGain = offline.createGain();
    outGain.gain.value = dbToLinear(this.outputGainDb);

    const worklet = new AudioWorkletNode(offline, PLUGIN_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        kernelCode: this.kernelCode,
        params: this.params,
        bypass: this.bypass,
      },
    });

    src.connect(inGain);
    inGain.connect(worklet);
    worklet.connect(outGain);
    outGain.connect(offline.destination);
    src.start(0);

    onProgress?.(15);
    const rendered = await offline.startRendering();
    onProgress?.(90);
    return rendered;
  }

  async dispose(): Promise<void> {
    this.stopSource();
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* noop */
      }
    }
    this.ctx = null;
    this.worklet = null;
    this.inputGain = null;
    this.outputGain = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.outputAnalyserL = null;
    this.outputAnalyserR = null;
    this.splitter = null;
    this.buffer = null;
  }
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}
