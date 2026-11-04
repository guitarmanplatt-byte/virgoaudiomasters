# VA Fuzz 66 — Virgo Audio Masters

A native guitar fuzz effect inspired by the late-1960s silicon Mosrite Fuzzrite.
This is an independent Virgo Audio Masters product, not an official Mosrite
plugin, an endorsed reproduction, or a measured capture of an original unit.

## Controls

- **Tone:** blends the opposing transistor-stage outputs, following the
  original pedal's **Depth** concept. This is not an ordinary treble EQ.
- **Volume:** output level with a squared control taper. Zero mutes the wet
  signal. Input level still determines how hard the transistor circuit clips;
  use your guitar volume or your host's input gain to change that response.
- **Footswitch:** toggles bypass. A short crossfade and matched dry-path delay
  avoid an abrupt digital switch. Double-click either knob to reset it.

The original pedal had no LED. The small gold status light and percentage
readouts are plugin additions. The brushed-metal enclosure, control placement,
large lettering and mechanical switch recall the original; the branding is
Virgo's and the surrounding interface is black and gold.

## Model

The audio path solves a seven-node nonlinear electrical network using two
grounded-emitter Ebers–Moll silicon transistor models. It includes:

- 9 V supply, 470k collector and collector-to-base feedback resistors
- 50n input/interstage coupling and 2n stage-mixing capacitors
- loaded 350k stage-blend potentiometer
- 22k second-stage mixing-node shunt and 35k output load
- an approximate 10k guitar-source resistance

The transistor gains and thermal behavior are nominal design choices, not
measurements of a particular vintage pedal. Capacitors use backward-Euler
companions; Newton iteration solves transistor cutoff and saturation.
Processing runs at 4x sample rate with anti-aliasing up/down filters.
The plugin reports oversampling latency to the host, supports mono or stereo,
and processes stereo channels independently. No cabinet, amplifier, room,
automatic loudness matching or artificial hiss is added.

Digital full scale corresponds approximately to one volt at the modeled
input. A direct guitar track is recommended. Start with modest input level;
try Tone around 75% and adjust Volume to match bypass loudness. Use an amp/cab
plugin after this effect if desired. Wet output has a +/-1 safety ceiling.

## Accuracy and limitations

This is a circuit-informed approximation, not a verified indistinguishable
replica. Original Fuzzrites varied, including germanium and silicon versions.
The plugin does not model every parasitic component, temperature drift,
pickup/cable impedance interaction or component tolerance. Reference recordings
from a real pedal are needed for measured tonal calibration and listening tests.

Historical and circuit references:
- https://fuzzboxes.org/features/fuzzrite
- https://homoelectromagneticus.com/projects/fuzzrite.php

Reference photographs and schematic artwork are not included in this product;
the editor is drawn in code.

## Windows installation

Copy the entire **VA Fuzz 66.vst3** folder, including its Contents folder, to:
`C:\Program Files\Common Files\VST3`

Rescan plugins in your DAW. In Virgo Studios: select a track, open the bottom
**VST3 Effects** button, choose **Browse / scan installed VST3 effects**, scan
that folder, then select **VA Fuzz 66** and choose **Load selected effect**.
Your host must support Windows x64 VST3 audio effects.
The standalone executable is unsigned and may trigger a Windows reputation
warning. Choose its audio device/input settings and start with low output
volume to avoid feedback. Use headphones.

No VST2 DLL or AAX version is provided. AU is a macOS source-build target;
the Windows distribution does not include a macOS binary.
Review JUCE licensing requirements before commercial distribution.
