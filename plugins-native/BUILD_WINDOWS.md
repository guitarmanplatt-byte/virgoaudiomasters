# Building VST3 Plugins for Windows

## Option A — GitHub Actions (easiest, no local tools needed)

Push this repository to GitHub, then:

1. Go to **Actions** tab in your GitHub repo
2. Click **Build VST3 (Windows x64)** in the left sidebar
3. Click **Run workflow → Run workflow**
4. Wait ~10–15 minutes for the build to complete
5. Click the finished run → scroll to **Artifacts** → download **VirgoAudioMasters-VST3-Windows-x64.zip**

Every push that changes `plugins-native/` also triggers a build automatically.

The workflow file is at `.github/workflows/build-vst3-windows.yml`.

---

## Option B — Build locally on Windows

### Prerequisites

| Tool | Download | Notes |
|------|----------|-------|
| **CMake 3.22+** | https://cmake.org/download/ | Add to PATH during install |
| **Visual Studio 2019 or 2022** | https://visualstudio.microsoft.com/downloads/ | Select **"Desktop development with C++"** workload. The free **Build Tools** edition works. |
| **Git** | https://git-scm.com/download/win | Needed for JUCE download |

### Steps

**Option 1 — Double-click**
```
build-windows.bat
```

**Option 2 — PowerShell**
```powershell
cd plugins-native
.\build-windows.ps1
```

**Option 3 — Manual CMake**
```bat
cd plugins-native
cmake -B build -S . -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release --parallel
```

### First-run time
JUCE (~80 MB) is downloaded automatically on first configure. After that, only changed files recompile.

| Stage | Estimated time |
|-------|----------------|
| First configure + JUCE download | 3–5 min |
| First full build (all 15 plugins) | 10–20 min |
| Incremental rebuild | < 1 min |

### Output location

After a successful build, VST3 bundles are at:
```
plugins-native\build\<PluginName>_artefacts\Release\VST3\<PluginName>.vst3
```

The build script collects them all into:
```
plugins-native\dist\VirgoAudioMasters-VST3-Windows-x64\
plugins-native\dist\VirgoAudioMasters-VST3-Windows-x64.zip   ← ready to share
```

### Installation

Copy each `.vst3` folder to:
```
C:\Program Files\Common Files\VST3\
```

Then rescan plugins in your DAW (Ableton Live, FL Studio, Reaper, Studio One, Cubase, etc.).

---

## Plugins included (15 total)

### Mastering
| Plugin | Description |
|--------|-------------|
| VA Utility | Gain, pan, M/S width, harmonic drive |
| VA Compressor | Soft-knee, program-dependent auto-release, parallel mix |
| VA Dynamic EQ | 8-band parametric EQ with per-band dynamics |
| VA Exciter | 3-band harmonic saturation (Warm / Tape / Tube / Retro) |
| VA Imager | 3-band M/S width + Haas stereoize |
| VA Maximizer | Look-ahead brickwall limiter with LUFS metering |
| VA Low End Focus | Crossover bass punch / smooth contrast shaper |
| VA Clarity | Adaptive high-shelf brightness enhancer |
| VA Vintage Tape | Wow, flutter, saturation + bandwidth (tape emulation) |

### Restoration
| Plugin | Description |
|--------|-------------|
| VA De-clip | Hermite cubic spline reconstruction of clipped peaks |
| VA De-click | Transient delta detection + cubic interpolation |
| VA De-crackle | Sliding median filter for vinyl crackle |
| VA De-hum | IIR notch bank (50/60 Hz + up to 5 harmonics) |
| VA De-noise | 4-band adaptive spectral gate with noise floor learning |
| VA De-plosive | LP/HP energy detection + fast-attack ducking gate |

---

## Troubleshooting

**"CMake not found"** — Add CMake's `bin` folder to your system PATH, or re-run the installer and check "Add CMake to PATH".

**"No Visual Studio installation found"** — Install [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) and select "Desktop development with C++".

**Build fails with JUCE error** — Delete `plugins-native\build\_deps` and try again (cached JUCE may be corrupt).

**Plugin not showing in DAW** — Make sure the `.vst3` *folder* (not the contents) is in `C:\Program Files\Common Files\VST3\` and rescan in your DAW settings.

**Ableton Live** — Live uses VST3 paths set in **Preferences → Plug-Ins → VST3 Plug-In Custom Folder**. Point it to your VST3 directory and click Rescan.
