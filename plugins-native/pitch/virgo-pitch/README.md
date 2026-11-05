# Virgo Pitch — Virgo Audio Masters

**Windows x64 VST3 polyphonic pitch-correction and harmony preview.**
Black-and-gold interface. Source targets also include AU and Standalone;
those targets are not necessarily included in the Windows download.

## What this preview does

- Processes mono or stereo audio, including multiple simultaneous notes.
- All 12 roots, with enharmonic labels (C#/Db, etc.).
- Major, natural minor, harmonic minor, melodic minor (ascending), and
  chromatic scales. Melodic minor is a fixed ascending pitch set; the plugin
  does not infer descending musical phrases.
- Adjustable strength, response time, natural pitch tolerance, and maximum
  correction distance.
- Two optional harmony voices with fixed semitone intervals: unison, octaves
  up/down (including two octaves), fifths, semitones, whole steps, tritones,
  major sevenths, minor ninths, and octave-plus-fifth.
- Individual harmony levels, wet/dry mix, output level, and bypass.
- Approximate spectral-envelope preservation and transient protection.
- Host automation, saved settings, and latency-compensated dry/bypass paths.

An exact octave is consonant. Dissonance here is provided by selectable fixed
intervals such as +/-1, +/-6, +/-11, and +/-13 semitones. Harmony voices shift
the corrected audio; they do not generate independent singers, isolate a lead
vocal, or automatically arrange diatonic thirds/fifths.

## Important accuracy limitations

This is an **experimental spectral polyphonic engine**, not a claim of
transparent commercial-grade full-mix retuning. It does not perform neural
source separation or editable per-note transcription. Dense chords, missing
fundamentals, overlapping harmonic series, distorted guitars, breathy voices,
reverb, and drums mixed with notes can confuse harmonic grouping.

Synthetic three-sine chords are a useful tuning check, not proof of accuracy
on real recordings. Pitch accuracy and naturalness on varied commercial music
have not been established. Audible modulation, smearing or incorrect note
assignment may occur. Isolated stems generally give better results.

For transparent work, begin with 60–85% correction, 100–250 ms response,
10–20 cents tolerance, 50–100 cents maximum shift, both protection options on,
and harmonies off. Pick the correct key. Intentional chromatic notes outside
the selected key may otherwise be moved to another note. A plugin cannot infer
whether a note is musically intentional merely from its key signature.

## Engine

Hann-window STFT with eightfold overlap and approximately 170–186 ms analysis
windows at common sample rates. Phase-derived frequencies, stereo-linked peak
regions, greedy harmonic grouping, smoothed note-to-scale ratios, and
identity-phase-locked spectral resynthesis. Harmony voices use independent
synthesis phases. Spectral-envelope preservation is a bounded approximation,
not a perfect vocal formant model.

Low-prominence/noisy peaks outside the detector's criteria are left uncorrected.
Detected fundamental range is approximately 50–1600 Hz; recognized upper
harmonics follow their fundamental. This is not universal instrument recognition.
Transient protection suspends correction at detected attacks but cannot isolate
percussion from a mix. Spectral filtering and window length add latency, which
is reported to the DAW. Use for mixing/offline work rather than live monitoring.
An uncompensated external parallel path can produce comb filtering.

No input/output clipping limiter is applied. Added harmonies can exceed digital
full scale; lower harmony/output levels and watch the output meter.

## Windows installation

1. Extract the ZIP.
2. Copy the entire **Virgo Pitch.vst3** folder to
   `C:\Program Files\Common Files\VST3`.
3. Rescan plugins in a Windows x64 VST3-compatible DAW.
4. Insert **Virgo Pitch** on the desired audio track.

In Virgo Studios, select a track, open **VST3 Effects**, choose
**Browse / scan installed VST3 effects**, scan the VST3 folder, select
**Virgo Pitch**, and choose **Load selected effect**.

No VST2 DLL or AAX binary is provided. A Windows download does not contain
a macOS AU binary. Review JUCE licensing before commercial distribution.

## Validation

Pure C++ engine checks cover scale targets, synthetic detuned chords, harmony
frequency, correction-off reconstruction, silence, independent audio channels,
parameter changes, and non-finite input protection at 44.1/48/96 kHz.
Native integration checks cover mono/stereo layouts, host block sizes,
latency-aligned bypass/mix, state restoration, actual VST3 scanning/loading,
audio processing, and editor rendering.

Real-world listening tests, objective full-mix note-assignment evaluation,
extensive automation stress tests, and cross-DAW compatibility remain necessary
before production use. Keep original audio and render to a new file.
