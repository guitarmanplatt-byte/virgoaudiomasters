# Virgo Studios — Windows desktop preview

A native black-and-gold audio workstation by VirgoAudioMasters, built with
JUCE 7.0.12. This is an original application inspired by traditional multitrack
DAW workflows, not Cakewalk code or a complete replacement for Cakewalk.

## Run on Windows

Extract the downloaded ZIP and launch **Virgo Studios.exe**. This preview is
not code-signed; Windows may display a reputation warning. Only run downloads
from the repository/build you trust.

If Windows reports a missing `MSVCP140` or `VCRUNTIME140` DLL, install the latest
Microsoft Visual C++ v14 **x64** Redistributable from Microsoft's
[supported downloads page](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist).
Do not download individual DLLs from third-party websites.

Choose **Audio Setup** to select your Windows audio device and enable inputs.
JUCE's standard Windows device backends are used; ASIO is not bundled in this
preview. Use headphones when recording to avoid feedback.

## Working features

- Import WAV, FLAC, AIFF, and MP3 files (or drag them into the window).
- Up to 32 tracks, with a 256 MB decoded limit per track and 512 MB per project.
- Stereo waveform timeline, track selection, seeking, zoom and vertical scroll.
  Double-click the transport time to seek to any `minutes:seconds` position.
- Play/pause/stop; Space toggles playback when the main timeline has focus.
- Per-track gain, stereo balance, mute and solo.
- Move clips with Shift-drag or the Position control.
- Non-destructive Trim in / Trim out controls.
- Record a stereo input take to disk alongside playback. Finish Take adds the
  recording to the timeline at its original timeline offset.
- Recordings are kept in Documents / Virgo Studios Recordings.
- Save/open `.virgo` projects. Saving copies source files to an adjacent
  `.media` directory. Keep that folder alongside the project when moving it.
- Export a stereo 48 kHz / 24-bit WAV using the same processing as playback.
  Unmastered over-range exports are rejected instead of silently clipping.

## VST3 effects, quantization and rendering (0.2)

Select a track, then **VST3 Effects > Browse / scan installed VST3 effects**.
Choose **Scan plugin folders**, confirm the standard Windows VST3 folders,
and use **+** to include any custom plugin folders. The scan searches those
folders recursively and displays discovered plugins by name and manufacturer.
Select an effect and click **Load selected effect** to add it to the currently
selected track. The list and search folders are saved between app launches.
Use the list's column headers to sort, or **Scan / manage plugins** to rescan,
remove stale entries or manage failed plugins. Cancel is available while scanning.
The browser lists VST3 plugins; instruments cannot be loaded by this preview.
You can still use **Choose VST3 file manually** to select a trusted Windows
x64 `.vst3` file or bundle, normally in `C:\Program Files\Common Files\VST3`.
Scanning loads plugin code in the DAW process. Save first and scan only trusted
folders: a broken plugin can hang or crash the app. A crash-marker file helps
skip plugins involved in an interrupted scan on the next scan.
The rack supports eight stereo audio effects per track, native plugin editors
(or a generic parameter editor), bypass, removal and effect ordering.
Silver Opto and other compatible VST3 effects can be loaded this way.
The chain order is **repair → effects → gain/pan → master**.
Plugin identities and settings are saved in the `.virgo` project. Plugins are
not copied into the project; install the same plugins when moving computers.
A missing plugin prevents opening that project rather than silently changing
its sound. Your currently open project remains intact.

**Quantize** opens tempo (20–300 BPM), grid (quarter through 32nd notes) and
strength controls. It detects energy rises in the trimmed audio and moves
transient slices toward a grid anchored at timeline zero. Stereo channels use
the same markers. It creates a new audio take and mutes the original track;
source files are never overwritten. This is rhythmic slice quantization, not
elastic time stretching: gaps can appear and overlapping decays can shorten.
It works best with clear drum/percussion attacks, not sustained/polyphonic
material. Zero strength preserves audio exactly. Audition before committing.

**Bounce Track** renders the selected track's repair, VST3 effects, gain and
pan to a new 48 kHz / 24-bit WAV, adds it to the session, and mutes the original.
Master processing is excluded to avoid applying it twice. The new track does
not retain active effects because those effects are already in its audio.

**Batch Export** renders one WAV per track in a new `Virgo Stems` folder.
All tracks are included, even muted tracks, and solo states are ignored.
Each file preserves its timeline offset and the files have equal lengths.
Track processing is included; master processing is excluded. The queue runs
automatically without a separate export dialog for each file. Files are
processed in sequence, not simultaneously on multiple CPU threads. A failed
batch removes its temporary outputs and leaves existing files untouched.

Bounce/quantized takes are kept in `Documents\Virgo Studios Renders` and copied
to the project's `.media` folder on save. Re-enable the original track and mute
the rendered take to compare or revert. There is not yet a full undo system.

Plugin latency is compensated across tracks (up to two seconds per rack), and
offline rendering uses independent plugin instances so it does not advance the
live rack's internal state. Reported effect tails are included up to ten seconds.
Only stereo-compatible VST3 **effects** are supported: no VST2, AU, MIDI
instruments or sidechain routing. Tempo/transport synchronization is not yet
provided to plugins. Plugins run inside the DAW process, not in a crash-isolated
sandbox; a faulty or malicious plugin can crash the application. Save first.

## Audio intelligence

### Measured analysis and mastering

Choose **Full mix** or **Selected track**, then **Analyze Audio**. The analyzer
reads actual decoded samples, not file names or guessed genres. It reports
sample peak, RMS, crest factor, DC, near-full-scale samples and large transitions.
These last two counts are warnings, not definitive diagnoses.

**Apply Mastering** uses a full-mix report to set bounded gain and compression.
Choose a Dynamic, Balanced, or Loud RMS starting target, then compare using
**Master processing**. Gain and sample ceiling can also be adjusted manually.
The target is a starting point, not guaranteed final loudness.

RMS is **not integrated LUFS**. The safety stage is a **sample-peak guard**,
not an oversampled true-peak limiter. There is no promise that a master meets
a streaming platform's delivery specifications.

### Repair

Select a track and enable **Repair enabled**. Available processors:

- 30 Hz DC/rumble high-pass
- 50/60 Hz hum notches at the fundamental and first two harmonics
- Adjustable, stereo-linked soft noise gate
- Conservative slew-based click suppression

These are real DSP tools, not neural restoration. A noise gate reduces noise
in quiet passages; it does not separate noise from music during loud passages.
Click suppression can soften musical transients. Severe clipping, reverb,
missing frequencies and damaged recordings cannot be perfectly reconstructed.
Source audio files are never modified by these processors.

### Optional local AI

1. Install and run [Ollama](https://ollama.com/) on the Windows computer.
2. Download a model: `ollama pull llama3.2`.
3. Analyze audio in Virgo Studios, then choose **AI Plan + Apply**.

The app calls only `http://127.0.0.1:11434/api/generate`. It sends measured
statistics and the selected target, **not the audio file**. Full mix mode
applies bounded mastering settings; Selected track mode applies bounded repair
settings. The result appears in the report. Bypass to compare.

This model interprets measured features; it does not directly listen to a
waveform or perform neural audio enhancement. No cloud account or API key is
required. If Ollama is unavailable, a clear error is shown and no settings change.

## Current scope

This preview does **not** include MIDI/piano roll, VST instruments, comping,
automation lanes, time stretching, pitch editing, buses/sends, spectral editing,
neural denoising, de-reverberation, or a full undo history. Track removal is
non-destructive to the source file. Save a separate project before major edits.
Existing audio files are limited to stereo; multichannel imports use their first
two channels. Playback uses linear sample-rate conversion in this first version.
There is no input-monitoring switch or latency compensation for overdubbing yet.

## Build

Requirements: CMake 3.22+, Git, and a C++17 compiler. On Windows use Visual
Studio Build Tools with the C++ workload and Windows SDK.

```powershell
cmake -S desktop/virgo-studios -B desktop/virgo-studios/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build desktop/virgo-studios/build --target VirgoStudios VirgoStudiosDSPTests VirgoStudiosQuantizeTests --parallel 2
ctest --test-dir desktop/virgo-studios/build --output-on-failure
```

The existing **Build VST3 (Windows x64)** GitHub Actions workflow also builds the
desktop application on Windows and includes `Virgo Studios_Standalone.exe`
in its native-suite download. The app can also be built independently using
the commands above. It does not publish or replace the existing web apps.

### Verification

The preview has passed a Windows x64 Release compilation, native window-render
check and engine integration checks covering import, waveform generation,
mixing, clip positions, trimming, mute, mastering, WAV round-trip, source-file
protection and preservation of an existing file after a failed export.
The Windows build host has no usable sound driver; physical input/output and
overdub timing are not hardware-verified.

Review JUCE's licensing requirements before commercial distribution.
