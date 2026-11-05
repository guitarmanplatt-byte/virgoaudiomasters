#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace studio
{
inline std::int64_t renderSampleCount(double duration, double rate)
{
    const double samples = duration * rate;
    if (!std::isfinite(samples) || samples <= 0) return 0;
    // A duration derived from N / rate can multiply back to N + one ULP.
    // Preserve genuinely fractional final samples without appending a phantom
    // sample at an integer boundary.
    const double nearest = std::round(samples);
    const double tolerance = 8 * std::numeric_limits<double>::epsilon() * std::max(1.0, samples);
    return static_cast<std::int64_t>(std::abs(samples - nearest) <= tolerance ? nearest : std::ceil(samples));
}
}
