#pragma once
#include <algorithm>
#include <cmath>
#include <vector>

namespace studio
{
struct TransientMove { int source = 0, target = 0; };

// Detect energy rises in 2 ms windows; move slices without resampling/pitch shift.
inline std::vector<TransientMove> quantizeMarkers(const float* left, const float* right,
    int samples, double rate, double bpm, int division, double strength,
    double timelineOffset = 0)
{
    std::vector<TransientMove> result;
    if (!left || samples <= 0 || rate <= 0 || bpm < 20 || bpm > 300 || division < 1 || division > 32)
        return result;
    const int hop = std::max(1, static_cast<int>(rate * 0.002));
    const int separation = static_cast<int>(rate * 0.06);
    const double grid = rate * 60.0 / bpm * 4.0 / division;
    float envelope = 0;
    int previous = -separation;
    strength = std::clamp(strength, 0.0, 1.0);
    for (int start = 0; start < samples; start += hop)
    {
        float peak = 0;
        int onset = start;
        for (int i = start; i < std::min(samples, start + hop); ++i)
        {
            const float value = std::max(std::abs(left[i]), right ? std::abs(right[i]) : 0.0f);
            if (value > peak) { peak = value; onset = i; }
        }
        if (peak > 0.015f && peak > std::max(0.01f, envelope * 2.5f) && onset - previous >= separation)
        {
            // Find the start of the attack rather than aligning its loudest sample.
            int attack = onset;
            while (attack > start && std::max(std::abs(left[attack - 1]),
                right ? std::abs(right[attack - 1]) : 0.0f) > peak * 0.1f) --attack;
            const double absolute = attack + timelineOffset * rate;
            const double destination = std::round(absolute / grid) * grid - timelineOffset * rate;
            const int target = std::clamp(static_cast<int>(std::llround(attack + (destination - attack) * strength)), 0, samples - 1);
            if (result.empty() || target > result.back().target)
                result.push_back({attack, target});
            previous = onset;
        }
        envelope = std::max(peak, envelope * 0.85f);
    }
    return result;
}

inline void renderQuantized(const float* source, float* output, int samples, double rate,
    const std::vector<TransientMove>& markers)
{
    std::fill(output, output + samples, 0.0f);
    if (markers.empty() || std::all_of(markers.begin(), markers.end(),
        [](const TransientMove& marker) { return marker.source == marker.target; }))
    { std::copy(source, source + samples, output); return; }
    // Preserve the pre-attack material and fade slice boundaries to reduce clicks.
    std::copy(source, source + std::min(markers.front().source, markers.front().target), output);
    const int fade = std::max(1, static_cast<int>(rate * 0.001));
    for (size_t index = 0; index < markers.size(); ++index)
    {
        const auto marker = markers[index];
        const int end = index + 1 < markers.size() ? markers[index + 1].source : samples;
        const int nextTarget = index + 1 < markers.size() ? markers[index + 1].target : samples;
        const int count = std::max(0, std::min({end - marker.source, nextTarget - marker.target, samples - marker.target}));
        for (int i = 0; i < count; ++i)
        {
            const float edge = std::min(1.0f, static_cast<float>(count - i) / fade);
            output[marker.target + i] = source[marker.source + i] * edge;
        }
    }
}
}
