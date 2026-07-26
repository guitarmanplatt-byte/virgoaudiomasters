import type { PluginDefinition } from '@/lib/plugin-engine/types';
import { dynamicEq } from './mastering/dynamic-eq';
import { compressor } from './mastering/compressor';
import { limiter } from './mastering/limiter';
import { exciter } from './mastering/exciter';
import { imager } from './mastering/imager';
import { lowEndFocus } from './mastering/low-end-focus';
import { clarity } from './mastering/clarity';
import { vintageTape } from './mastering/vintage-tape';

/**
 * Central plugin registry. Modules from the mastering & restoration suites
 * register themselves here by pushing full definitions (with kernelCode and
 * Controls) via `registerPlugin`. Unimplemented modules appear as
 * "coming soon" tiles on the hub.
 */

const UTILITY_KERNEL = `
(sampleRate) => {
  // Stereo utility: gain, pan (constant-power), stereo width (M/S), soft drive
  let gainZ = 1;
  return {
    process(input, output, params) {
      const inL = input[0];
      const inR = input.length > 1 ? input[1] : input[0];
      const outL = output[0];
      const outR = output.length > 1 ? output[1] : output[0];
      const n = outL.length;

      const gain = Math.pow(10, (params.gain ?? 0) / 20);
      const width = params.width ?? 1;
      const pan = Math.max(-1, Math.min(1, params.pan ?? 0));
      const drive = params.drive ?? 0;

      const panL = Math.cos((pan + 1) * Math.PI / 4);
      const panR = Math.sin((pan + 1) * Math.PI / 4);
      const k = drive * 40;

      for (let i = 0; i < n; i++) {
        // smooth gain to avoid zipper noise
        gainZ += (gain - gainZ) * 0.002;
        let l = inL[i] * gainZ;
        let r = inR[i] * gainZ;

        // M/S width
        const mid = (l + r) * 0.5;
        const side = (l - r) * 0.5 * width;
        l = mid + side;
        r = mid - side;

        // saturation drive
        if (k > 0.5) {
          l = ((Math.PI + k) * l) / (Math.PI + k * Math.abs(l));
          r = ((Math.PI + k) * r) / (Math.PI + k * Math.abs(r));
        }

        outL[i] = l * panL * 1.4142;
        outR[i] = r * panR * 1.4142;
      }
    }
  };
}
`;

const registry: PluginDefinition[] = [
  // ── Reference module (framework demo, fully functional) ──────────────────
  {
    id: 'utility',
    name: 'VA Utility',
    category: 'mastering',
    tagline: 'Gain · Pan · Width · Drive',
    description: 'Reference channel utility: input trim, constant-power pan, mid/side stereo width and analog-style drive. Demonstrates the real-time engine.',
    available: true,
    kernelCode: UTILITY_KERNEL,
    params: [
      { id: 'gain', label: 'Gain', min: -24, max: 24, default: 0, unit: 'dB' },
      { id: 'pan', label: 'Pan', min: -1, max: 1, default: 0, format: (v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`) },
      { id: 'width', label: 'Width', min: 0, max: 2, default: 1, format: (v) => `${Math.round(v * 100)}%` },
      { id: 'drive', label: 'Drive', min: 0, max: 1, default: 0, format: (v) => `${Math.round(v * 100)}%` },
    ],
    factoryPresets: [
      { name: 'Default', params: { gain: 0, pan: 0, width: 1, drive: 0 } },
      { name: 'Wide & Warm', params: { gain: 0, pan: 0, width: 1.4, drive: 0.25 } },
      { name: 'Mono Check', params: { gain: 0, pan: 0, width: 0, drive: 0 } },
      { name: 'Hot Drive', params: { gain: 3, pan: 0, width: 1.1, drive: 0.6 } },
    ],
  },

  // ── Mastering suite ───────────────────────────────────────────────────────
  dynamicEq,
  compressor,
  limiter,
  exciter,
  imager,
  lowEndFocus,
  clarity,
  vintageTape,

  // ── Restoration suite slots (implemented in a later task) ────────────────
  { id: 'de-noise', name: 'VA De-noise', category: 'restoration', tagline: 'Broadband noise removal', description: 'Spectral noise reduction with learnable noise profiles.', available: false, params: [], factoryPresets: [] },
  { id: 'de-click', name: 'VA De-click', category: 'restoration', tagline: 'Click & pop repair', description: 'Removes vinyl clicks, mouth ticks and digital dropouts.', available: false, params: [], factoryPresets: [] },
  { id: 'de-hum', name: 'VA De-hum', category: 'restoration', tagline: 'Hum & buzz removal', description: 'Adaptive 50/60 Hz hum filtering with harmonic tracking.', available: false, params: [], factoryPresets: [] },
  { id: 'de-clip', name: 'VA De-clip', category: 'restoration', tagline: 'Clipping repair', description: 'Rebuilds waveform peaks lost to analog or digital clipping.', available: false, params: [], factoryPresets: [] },
  { id: 'de-ess', name: 'VA De-ess', category: 'restoration', tagline: 'Sibilance control', description: 'Spectral de-essing for harsh S and T sounds.', available: false, params: [], factoryPresets: [] },
  { id: 'de-reverb', name: 'VA De-reverb', category: 'restoration', tagline: 'Reverb reduction', description: 'Reduces room ambience and excessive reverb tails.', available: false, params: [], factoryPresets: [] },
];

/** Later tasks call this to replace a slot with a full implementation. */
export function registerPlugin(def: PluginDefinition): void {
  const idx = registry.findIndex((p) => p.id === def.id);
  if (idx >= 0) registry[idx] = def;
  else registry.push(def);
}

export function listPlugins(): PluginDefinition[] {
  return registry;
}

export function getPlugin(id: string): PluginDefinition | undefined {
  return registry.find((p) => p.id === id);
}
