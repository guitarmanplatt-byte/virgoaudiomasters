# VirgoAudioMasters — Native Plugin Suite

14 VST3/AU mastering and restoration plugins built with [JUCE](https://juce.com).
DSP algorithms are faithful C++ ports of the browser plugin suite.

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| CMake | 3.22 | https://cmake.org/download |
| C++ compiler | C++17 | Xcode 15+ (macOS) · Visual Studio 2022 (Windows) |
| Internet access | — | FetchContent downloads JUCE on first configure |

### macOS
```bash
xcode-select --install        # command-line tools
brew install cmake            # or download from cmake.org
```

### Windows
- Install **Visual Studio 2022** with the "Desktop development with C++" workload
- Install **CMake** (add to PATH during install)

---

## Building

```bash
# 1. Clone / navigate to this directory
cd plugins-native

# 2. Configure (downloads JUCE automatically on first run ~5 min)
cmake -B build -DCMAKE_BUILD_TYPE=Release

# macOS — also pass the deployment target
cmake -B build -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0

# 3. Build all plugins
cmake --build build --config Release --parallel

# 4. (Optional) Build a single plugin, e.g. VA Compressor
cmake --build build --config Release --target VACompressor_VST3
```

---

## Plugin output locations

### VST3
| OS | Directory |
|----|-----------|
| macOS | `~/Library/Audio/Plug-Ins/VST3/` |
| Windows | `C:\Program Files\Common Files\VST3\` |

The build system writes into the `build/` tree; copy manually or pass
`-DCOPY_PLUGIN_AFTER_BUILD=TRUE` inside each plugin's `juce_add_plugin()` call.

### AU (macOS only)
`~/Library/Audio/Plug-Ins/Components/`

Standalone executables land in `build/mastering/<name>/<name>_artefacts/Standalone/`.

---

## Loading in a DAW

1. Copy the `.vst3` bundle to your VST3 folder (see above).
2. In your DAW, rescan / refresh the plugin list.
3. Search for **"VA "** to find all Virgo plugins.
4. All plugins support **stereo in / stereo out**.

---

## Plugin list

### Mastering (8)
| Plugin | ID | Description |
|--------|----|-------------|
| VA Utility | `VaUt` | Gain, pan, M/S width, drive |
| VA Dynamic EQ | `VaDq` | 8-band parametric + dynamic EQ |
| VA Compressor | `VaCp` | Soft-knee compressor, program-dependent release |
| VA Exciter | `VaEx` | Multiband harmonic saturation (Warm/Tape/Tube/Retro) |
| VA Imager | `VaIm` | Multiband M/S stereo width + Haas stereoize |
| VA Maximizer | `VaMx` | Look-ahead brickwall limiter |
| VA Low End Focus | `VaLe` | Bass punch vs. smooth contrast |
| VA Clarity | `VaCl` | Adaptive spectral brightness enhancer |

### Restoration (6)
| Plugin | ID | Description |
|--------|----|-------------|
| VA De-clip | `VaDc` | Hermite cubic clipping repair |
| VA De-click | `VaDk` | Delta-based click/pop interpolation |
| VA De-crackle | `VaDr` | Median-filter surface noise removal |
| VA De-hum | `VaDh` | IIR notch bank — 50/60 Hz hum + harmonics |
| VA De-noise | `VaDn` | 4-band adaptive spectral noise gate |
| VA De-plosive | `VaDp` | LP energy detection + HP ducking |

---

## Factory presets

Each plugin ships factory presets accessible via the DAW's standard preset browser
(host implements APVTS `ValueTree` state save/restore automatically).

---

## Troubleshooting

**"Cannot open source file juce_*.h"** — JUCE was not fetched. Run `cmake -B build` again
with an active internet connection.

**AU validation fails on macOS** — Run `auval -v aufx <4cc> Vram` in Terminal.
Common fix: sign the bundle with `codesign --deep -f -s - plugin.component`.

**Plugin not appearing in DAW** — Confirm your DAW scans the correct VST3 folder and
that the architecture (arm64 vs x86_64) matches. Use `lipo -info plugin.vst3/...` to check.

---

## Architecture notes

- **Shared library** (`shared/`): `VirgoLookAndFeel` (obsidian + gold theme),
  `VirgoGenericEditor` (APVTS-driven knob layout), `VirgoHelpers.h` (ported DSP math).
- **Per-plugin**: `PluginProcessor` (APVTS + DSP), uses `VirgoGenericEditor` as its UI.
- **No external dependencies** beyond JUCE (fetched automatically).
- Manufacturer code: `Vram` · Company: VirgoAudioMasters
