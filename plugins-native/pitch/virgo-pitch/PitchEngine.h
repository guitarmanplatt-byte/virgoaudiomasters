#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <vector>

namespace VirgoPitch
{
constexpr double pi = 3.14159265358979323846;
struct Settings
{
    int root = 0, scale = 0;
    float amount = 0.85f, responseMs = 120, toleranceCents = 12, maximumCents = 100;
    std::array<int, 2> interval {12, -12};
    std::array<float, 2> harmonyGain {0, 0};
    bool preserveTransients = true, preserveFormants = true;
};

inline bool scaleContains(int midi, int root, int scale)
{
    static constexpr unsigned masks[] {
        0xAB5, // major: 0 2 4 5 7 9 11
        0x5AD, // natural minor: 0 2 3 5 7 8 10
        0x9AD, // harmonic minor: 0 2 3 5 7 8 11
        0xAAD, // melodic minor ascending: 0 2 3 5 7 9 11
        0xFFF  // chromatic
    };
    const int pitchClass = ((midi - root) % 12 + 12) % 12;
    return (masks[std::clamp(scale, 0, 4)] & (1u << pitchClass)) != 0;
}
inline double targetNote(double midi, int root, int scale)
{
    const int centre = static_cast<int>(std::floor(midi + 0.5));
    int nearest = centre;
    double best = 100;
    for (int note = centre - 3; note <= centre + 3; ++note)
        if (scaleContains(note, root, scale) && std::abs(note - midi) < best)
        { nearest = note; best = std::abs(note - midi); }
    return nearest;
}

// Fixed-allocation, stereo-linked short-time Fourier processor.
// This is a spectral polyphonic approximation, not instrument/source separation.
class Engine
{
public:
    void prepare(double sampleRate);
    std::array<float, 2> process(float left, float right, const Settings&);
    int latency() const { return size; }
    float activity() const { return correctionActivity; }
    float confidence() const { return tonalConfidence; }
private:
    struct Peak { int bin = 0, parent = -1; double frequency = 0, magnitude = 0, ratio = 1; };
    void fft(std::vector<std::complex<double>>&, bool inverse) const;
    void frame(const Settings&);
    double envelopeAt(int channel, double bin) const;
    double rate = 48000;
    int size = 8192, hop = 1024, write = 0, untilFrame = 1024, outputPosition = 0;
    std::array<std::vector<float>, 2> input, output;
    std::array<std::vector<std::complex<double>>, 2> spectrum, synthesis;
    std::array<std::vector<double>, 2> previousPhase, frequency, envelope, prefix;
    std::array<std::array<std::vector<double>, 2>, 3> phase, nextPhase;
    std::vector<double> window, magnitude, previousMagnitude, previousRatio, nextRatio;
    std::vector<int> bitReverse, owner, previousPeaks;
    std::vector<std::complex<double>> roots;
    std::vector<Peak> peaks;
    float correctionActivity = 0, tonalConfidence = 0;
};
}
