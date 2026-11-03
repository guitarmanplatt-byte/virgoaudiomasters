#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace studio
{
constexpr double pi = 3.14159265358979323846;
inline float gain(float db) { return std::pow(10.0f, db / 20.0f); }
inline float db(float value) { return 20.0f * std::log10(std::max(1.0e-8f, value)); }

struct Measurements
{
    std::uint64_t samples = 0, clipped = 0, clicks = 0;
    double sum = 0.0, squares = 0.0;
    float peak = 0.0f, previous = 0.0f;
    void push(float value)
    {
        peak = std::max(peak, std::abs(value));
        sum += value;
        squares += static_cast<double>(value) * value;
        clipped += std::abs(value) >= 0.999f;
        // A warning heuristic, not a claim that musical transients are defects.
        clicks += samples > 0 && std::abs(value - previous) > 0.65f;
        previous = value;
        ++samples;
    }
    float rmsDb() const { return db(samples ? static_cast<float>(std::sqrt(squares / samples)) : 0.0f); }
    float peakDb() const { return db(peak); }
    float dc() const { return samples ? static_cast<float>(sum / samples) : 0.0f; }
    float crestDb() const { return peakDb() - rmsDb(); }
};

struct RepairSettings
{
    bool enabled = false, highPass = true, hum = false, gate = false, deClick = false;
    float humHz = 60.0f, gateDb = -55.0f;
};

struct MasterSettings
{
    bool enabled = false;
    float gainDb = 0.0f, thresholdDb = -16.0f, ceilingDb = -1.0f, warmth = 0.12f;
};

struct Biquad
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
    void highPass(double rate, double frequency)
    {
        const auto w = 2.0 * pi * frequency / rate;
        const auto c = std::cos(w), alpha = std::sin(w) / (2.0 * 0.707);
        b0 = (1 + c) / (2 * (1 + alpha)); b1 = -(1 + c) / (1 + alpha); b2 = b0;
        a1 = -2 * c / (1 + alpha); a2 = (1 - alpha) / (1 + alpha);
    }
    void notch(double rate, double frequency)
    {
        const auto w = 2 * pi * frequency / rate;
        const auto c = std::cos(w), alpha = std::sin(w) / 60.0;
        b0 = 1 / (1 + alpha); b1 = -2 * c / (1 + alpha); b2 = b0;
        a1 = b1; a2 = (1 - alpha) / (1 + alpha);
    }
    float tick(float input)
    {
        const double y = input * b0 + z1;
        z1 = input * b1 + z2 - a1 * y; z2 = input * b2 - a2 * y;
        return static_cast<float>(y);
    }
};

class RepairDSP
{
public:
    void prepare(double rate, RepairSettings value)
    {
        settings = value; envelope = 0; previous = {};
        highPass = {}; hum = {};
        for (int ch = 0; ch < 2; ++ch)
        {
            highPass[ch].highPass(rate, 30);
            for (int band = 0; band < 3; ++band)
                hum[ch][band].notch(rate, value.humHz * (band + 1));
        }
        attack = static_cast<float>(std::exp(-1.0 / (rate * 0.003)));
        release = static_cast<float>(std::exp(-1.0 / (rate * 0.12)));
        gateThreshold = gain(value.gateDb);
    }
    void process(float& left, float& right)
    {
        if (!settings.enabled) return;
        float values[2] = { left, right };
        const float detected = std::max(std::abs(left), std::abs(right));
        const float coefficient = detected > envelope ? attack : release;
        envelope = coefficient * envelope + (1 - coefficient) * detected;
        const float gateGain = settings.gate ? std::clamp(envelope / gateThreshold, 0.0f, 1.0f) : 1.0f;
        for (int ch = 0; ch < 2; ++ch)
        {
            float value = values[ch];
            // Conservative slew suppression. Not spectral reconstruction.
            if (settings.deClick)
                value = previous[ch] + std::clamp(value - previous[ch], -0.45f, 0.45f);
            previous[ch] = value;
            if (settings.highPass) value = highPass[ch].tick(value);
            if (settings.hum)
                for (auto& filter : hum[ch]) value = filter.tick(value);
            values[ch] = value * gateGain * gateGain;
        }
        left = values[0]; right = values[1];
    }
private:
    RepairSettings settings;
    std::array<Biquad, 2> highPass;
    std::array<std::array<Biquad, 3>, 2> hum;
    std::array<float, 2> previous {};
    float envelope = 0, attack = 0, release = 0, gateThreshold = 0;
};

class MasterDSP
{
public:
    void prepare(double rate, MasterSettings value)
    {
        settings = value; envelope = 0; reduction = 1;
        inputGain = gain(value.gainDb); threshold = gain(value.thresholdDb);
        ceiling = gain(value.ceilingDb);
        attack = static_cast<float>(std::exp(-1.0 / (rate * 0.02)));
        release = static_cast<float>(std::exp(-1.0 / (rate * 0.25)));
    }
    void process(float& left, float& right)
    {
        if (!settings.enabled) return;
        left *= inputGain; right *= inputGain;
        const float detected = std::max(std::abs(left), std::abs(right));
        const float coefficient = detected > envelope ? attack : release;
        envelope = coefficient * envelope + (1 - coefficient) * detected;
        const float target = envelope > threshold
            ? std::pow(threshold / std::max(envelope, 1.0e-8f), 0.5f) : 1.0f;
        reduction = coefficient * reduction + (1 - coefficient) * target;
        left *= reduction; right *= reduction;
        // Unity-slope harmonic coloration; does not add gain at small signals.
        for (auto* value : { &left, &right })
            *value = (1 - settings.warmth) * *value
                   + settings.warmth * std::tanh(1.4f * *value) / 1.4f;
        // Linked instantaneous SAMPLE-peak guard. Not a true-peak limiter.
        const float peak = std::max(std::abs(left), std::abs(right));
        const float limit = peak > ceiling ? ceiling / peak : 1.0f;
        left *= limit; right *= limit;
    }
private:
    MasterSettings settings;
    float envelope = 0, reduction = 1, inputGain = 1, threshold = 1, ceiling = 1;
    float attack = 0, release = 0;
};

inline MasterSettings recommendMaster(const Measurements& measured, float targetRms)
{
    MasterSettings settings;
    settings.enabled = true;
    settings.gainDb = measured.peak < 1.0e-7f ? 0.0f
        : std::clamp(targetRms - measured.rmsDb(), -12.0f, 12.0f);
    settings.thresholdDb = measured.crestDb() > 14 ? -18.0f : -12.0f;
    return settings;
}
}
