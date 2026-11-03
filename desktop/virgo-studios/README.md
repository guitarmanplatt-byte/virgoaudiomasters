# Virgo Studios — Windows desktop preview

A native black-and-gold audio workstation by VirgoAudioMasters, built with
JUCE 7.0.12. This is an original application inspired by traditional multitrack
DAW workflows, not Cakewalk code or a complete replacement for Cakewalk.

## Run on Windows

Extract the downloaded ZIP and launch **Virgo Studios.exe**. This preview is
not code-signed; Windows may display a reputation warning. Only run downloads
from the repository/build you trust.

Choose **Audio Setup** to select your Windows audio device and enable inputs.
JUCE's standard Windows device backends are used; ASIO is not bundled in this
preview. Use headphones when recording to avoid feedback.

## Working features

- Import WAV, FLAC, AIFF, and MP3 files (or drag them into the window).
- Up to 32 tracks, with a 256 MB decoded limit per track and 512 MB per project.
- Stereo waveform timeline, track selection, seeking, zoom and vertical scroll.
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
3. Analyze audio in Virgo Studios, then choose **Ask Local AI**.

The app calls only `http://127.0.0.1:11434/api/generate`. It sends measured
statistics and the selected target, **not the audio file**. Full mix mode
applies bounded mastering settings; Selected track mode applies bounded repair
settings. The result appears in the report. Bypass to compare.

This model interprets measured features; it does not directly listen to a
waveform or perform neural audio enhancement. No cloud account or API key is
required. If Ollama is unavailable, a clear error is shown and no settings change.

## Current scope

This preview does **not** include MIDI/piano roll, VST hosting, comping,
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
cmake --build desktop/virgo-studios/build --target VirgoStudios VirgoStudiosDSPTests --parallel 2
ctest --test-dir desktop/virgo-studios/build --output-on-failure
```

The existing **Build VST3 (Windows x64)** GitHub Actions workflow also builds the
desktop application on Windows and includes `Virgo Studios_Standalone.exe`
in its native-suite download. The app can also be built independently using
the commands above. It does not publish or replace the existing web apps.

Review JUCE's licensing requirements before commercial distribution.
