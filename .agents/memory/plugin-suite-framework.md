---
name: Plugin suite framework
description: How the browser plugin suite (Web Audio engine, shell, presets, registry) works and its gotchas.
---

# Plugin suite framework (virgo-web)

- New plugins register via `registerPlugin()` in `src/plugins/registry.tsx` with a `PluginDefinition`: id, category, params, factory presets, and `kernelCode` — the JS source of `(sampleRate) => { process(inputs, outputs, params) }`, evaluated inside the shared AudioWorklet.
- The worklet processor is a **static file** at `public/worklets/plugin-processor.js` (name `virgo-plugin-processor`). **Why:** blob-URL worklet modules hang (never resolve) in some Chromium environments. Keep DSP contract changes in sync between that file and `src/lib/plugin-engine/worklet-source.ts` docs.
- `PluginAudioEngine` (`src/lib/plugin-engine/engine.ts`): decode uses a throwaway AudioContext (never block load on worklet setup); realtime `addModule` is raced with a 4s timeout and falls back to passthrough (export always uses the offline worklet path); `resume()` is capped at 1s. **Why:** all three can hang indefinitely in headless/constrained browsers.
- Custom plugin UI goes in `PluginDefinition.renderUI(props: PluginUIProps)`; otherwise `PluginWindow` renders a generic spectrum + knobs layout. Shared controls in `src/components/plugin/` (Knob, Fader, LedMeter, SpectrumAnalyzer, BandNodeEditor, ToggleSwitch).
- User presets: `/api/plugin-presets` CRUD keyed by `pluginId`; contract-first (openapi.yaml → codegen; zod exports are PascalCase like `CreatePluginPresetBody`).
- E2E testing note: headless testers can't run the realtime worklet — verify DSP via export (offline render), and playback via transport-time advancing under the passthrough fallback.
