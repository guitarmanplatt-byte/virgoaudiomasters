# Vintage Tape release checks

Run from the repository root with CMake 3.22+, a C++17 compiler, and JUCE's
platform dependencies installed. JUCE 7.0.12 is fetched on first configure.

## macOS: VST3 and AU

```sh
cmake -S plugins-native -B generated-artifacts/vintage-tape-build \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON -DVIRGO_BUILD_STUDIOS=OFF
cmake --build generated-artifacts/vintage-tape-build --config Release \
  --target VAVintageTape_VST3 VAVintageTape_AU VAVintageTapeTests --parallel 2
ctest --test-dir generated-artifacts/vintage-tape-build -C Release \
  --output-on-failure -R '^VAVintageTapeSignalTests$'
```

AU uses Apple's frameworks and SDK; Linux/Windows cannot build that target.
The root `.github/workflows/vintage-tape-validation.yml` runs these macOS
commands and a separate Linux ASan/UBSan build on pushes, pull requests,
or manual dispatch. A workflow definition is not evidence of a passing run.

## Linux/Windows: VST3 and signal flow

Use the same commands but omit `VAVintageTape_AU` from the target list.
On Linux install ALSA, FreeType, Fontconfig, X11/Xext/Xinerama/Xrandr/Xcursor,
and OpenGL development headers/libraries. GTK/WebKit and cURL are disabled.

## Sanitizers (GCC/Clang)

Configure a separate build directory with:

```sh
cmake -S plugins-native -B generated-artifacts/vintage-tape-sanitized \
  -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON -DVIRGO_BUILD_STUDIOS=OFF \
  -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer" \
  -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address,undefined"
cmake --build generated-artifacts/vintage-tape-sanitized \
  --target VAVintageTapeTests --parallel 2
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1 \
UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
ctest --test-dir generated-artifacts/vintage-tape-sanitized \
  --output-on-failure -R '^VAVintageTapeSignalTests$'
```

## Assertions

The console test instantiates the actual JUCE processor and exercises
`prepareToPlay` / `processBlock` / `releaseResources`, not a DSP imitation:

- At 44.1, 48, and 96 kHz, fully dry audio with unity trim is bit-exact,
  including samples above full scale, mono/stereo, 1/127/512-sample blocks,
  and partial final blocks.
- Partial mono dry/wet processing matches identical-channel stereo processing.
- A hot symmetric sine is clipped to unity, remains audible, and has less
  than 0.001 DC after settling.
- A 1 kHz sine's zero-crossing periods show under 0.1 Hz RMS pitch error with
  modulation off, and over 1 Hz RMS deviation for wow and flutter separately.
- For wet/partial mixes, trim sets the **sample-peak** ceiling at -12, -6, 0,
  and +6 dBFS, on both channels. This is a hard clip, not an oversampled
  true-peak limiter. Fully dry audio remains exempt from clipping; trim still
  applies as output gain.
- An impulse decays into silence, subnormal input does not produce subnormal
  output, re-preparing clears old audio, and very hot finite input stays finite.

`ScopedNoDenormals` changes floating-point handling; it does not emit warnings.
The test explicitly rejects non-finite and subnormal output on both channels.

## Recorded local verification (2026-11-05)

Linux x86-64, GCC 15.3.0, JUCE 7.0.12:

- CMake Debug configure and `VAVintageTape_VST3` / `VAVintageTapeTests` build:
  passed. The shared editor archive requires position-independent code for
  Linux plugin linking.
- `VAVintageTapeSignalTests`: passed (1.80 seconds).
- Separate ASan + UBSan Debug build and the same test suite: passed
  (5.96 seconds), with leak detection enabled and no sanitizer diagnostics.
- Saturation sample peak: 1.0 at all three tested rates. Largest measured
  steady-state DC magnitude: 0.00000995.
- Unmodulated pitch error: below 0.005 Hz RMS. Wow and flutter each produced
  measurable deviation above the 1 Hz threshold.

Build and test logs are retained locally under
`generated-artifacts/vintage-tape-validation/` (ignored by Git).
**AU/macOS verification has not run.** It remains a release requirement;
the workflow must complete on a macOS runner before this task can be closed.
