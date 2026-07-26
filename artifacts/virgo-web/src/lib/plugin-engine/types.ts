import type { ComponentType } from 'react';

export type PluginCategory = 'mastering' | 'restoration';

export type ParamScale = 'lin' | 'log';

export interface PluginParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  unit?: string;
  scale?: ParamScale;
  /** Custom display formatting, e.g. Hz → kHz */
  format?: (value: number) => string;
}

export interface FactoryPreset {
  name: string;
  params: Record<string, number>;
}

/** Props received by a plugin's custom controls/visualization UI. */
export interface PluginUIProps {
  params: Record<string, number>;
  setParam: (id: string, value: number) => void;
  /** AnalyserNode tapped post-processing, for visualizations. Null until audio is loaded. */
  analyser: AnalyserNode | null;
  /** AnalyserNode tapped pre-processing. Null until audio is loaded. */
  inputAnalyser: AnalyserNode | null;
  /** Per-channel post-processing analysers for stereo visualizations. */
  analyserL?: AnalyserNode | null;
  analyserR?: AnalyserNode | null;
  definition: PluginDefinition;
}

export interface PluginDefinition {
  id: string;
  name: string;
  category: PluginCategory;
  tagline: string;
  description: string;
  /** Whether the DSP module is implemented yet. */
  available: boolean;
  /** JS source of `(sampleRate) => kernel` factory. See worklet-source.ts. */
  kernelCode?: string;
  params: PluginParamDef[];
  factoryPresets: FactoryPreset[];
  /** Custom central UI. If omitted, a generic knob panel + spectrum is rendered. */
  Controls?: ComponentType<PluginUIProps>;
  /**
   * Path (relative to the app's public root) to a short demo audio clip that
   * showcases the artifact type of noise/distortion this plugin corrects.
   * When present, a "Try demo" button appears in PluginWindow before any file
   * is loaded.
   */
  demoClip?: string;
}

export function defaultParams(def: PluginDefinition): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.id] = p.default;
  return out;
}
