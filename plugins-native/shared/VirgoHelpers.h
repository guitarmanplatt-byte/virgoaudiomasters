#pragma once
/**
 * VirgoHelpers.h — Pure C++ DSP math helpers.
 *
 * Deliberately free of JUCE headers so it can be included before JuceHeader.h
 * in plugin source files.  Mirrors the JavaScript kernel-utils.ts helpers
 * (biquad coefficient calculator, envelope follower, Hermite interpolation, etc.)
 */

#include <cmath>
#include <algorithm>
#include <array>
#include <cstring>

namespace Virgo
{

// ── Constants ─────────────────────────────────────────────────────────────────
static constexpr float kPi  = 3.14159265358979323846f;
static constexpr float kTwoPi = 2.0f * kPi;

// ── Biquad filter (RBJ Audio EQ Cookbook) ────────────────────────────────────
struct BiquadCoeffs
{
    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
    float a1 = 0.0f, a2 = 0.0f;  // a0 already normalised out
};

/** Single-channel biquad state (Direct Form I). */
struct BiquadState
{
    float x1 = 0.0f, x2 = 0.0f, y1 = 0.0f, y2 = 0.0f;

    inline float tick(const BiquadCoeffs& c, float x) noexcept
    {
        float y = c.b0 * x + c.b1 * x1 + c.b2 * x2
                            - c.a1 * y1 - c.a2 * y2;
        x2 = x1;  x1 = x;
        y2 = y1;  y1 = y;
        return y;
    }

    void reset() noexcept { x1 = x2 = y1 = y2 = 0.0f; }
};

/** Stereo biquad: one coefficients set, two state machines. */
struct StereoBiquad
{
    BiquadCoeffs c;
    BiquadState L, R;

    float tickL(float x) noexcept { return L.tick(c, x); }
    float tickR(float x) noexcept { return R.tick(c, x); }
    void reset() noexcept { L.reset(); R.reset(); }
};

enum class FType { Peaking, LowShelf, HighShelf, LowPass, HighPass, BandPass, Notch };

/**
 * Calculate RBJ biquad coefficients.  Mirrors biquadCoeffs() in kernel-utils.ts.
 *
 * @param type    Filter character
 * @param f0      Centre/corner frequency in Hz
 * @param gainDb  Shelf/peaking gain in dB  (ignored for LP/HP/BP)
 * @param Q       Quality factor
 * @param sr      Sample rate in Hz
 */
inline BiquadCoeffs calcBiquad(FType type, float f0, float gainDb, float Q, float sr) noexcept
{
    const float A   = std::pow(10.0f, gainDb / 40.0f);
    const float w0  = kTwoPi * std::max(10.0f, std::min(sr * 0.49f, f0)) / sr;
    const float cw  = std::cos(w0);
    const float sw  = std::sin(w0);
    const float alp = sw / (2.0f * std::max(0.05f, Q));

    float b0, b1, b2, a0, a1, a2;

    switch (type)
    {
        case FType::Peaking:
            b0 = 1.0f + alp * A;  b1 = -2.0f * cw;  b2 = 1.0f - alp * A;
            a0 = 1.0f + alp / A;  a1 = -2.0f * cw;  a2 = 1.0f - alp / A;
            break;
        case FType::LowShelf: {
            const float s = 2.0f * std::sqrt(A) * alp;
            b0 = A * ((A+1) - (A-1)*cw + s);
            b1 = 2.0f*A * ((A-1) - (A+1)*cw);
            b2 = A * ((A+1) - (A-1)*cw - s);
            a0 = (A+1) + (A-1)*cw + s;
            a1 = -2.0f * ((A-1) + (A+1)*cw);
            a2 = (A+1) + (A-1)*cw - s;
            break;
        }
        case FType::HighShelf: {
            const float s = 2.0f * std::sqrt(A) * alp;
            b0 = A * ((A+1) + (A-1)*cw + s);
            b1 = -2.0f*A * ((A-1) + (A+1)*cw);
            b2 = A * ((A+1) + (A-1)*cw - s);
            a0 = (A+1) - (A-1)*cw + s;
            a1 = 2.0f * ((A-1) - (A+1)*cw);
            a2 = (A+1) - (A-1)*cw - s;
            break;
        }
        case FType::LowPass:
            b0 = (1.0f-cw)/2.0f;  b1 = 1.0f-cw;    b2 = (1.0f-cw)/2.0f;
            a0 = 1.0f+alp;         a1 = -2.0f*cw;    a2 = 1.0f-alp;
            break;
        case FType::HighPass:
            b0 = (1.0f+cw)/2.0f;  b1 = -(1.0f+cw);  b2 = (1.0f+cw)/2.0f;
            a0 = 1.0f+alp;         a1 = -2.0f*cw;    a2 = 1.0f-alp;
            break;
        case FType::BandPass:
            b0 = alp;  b1 = 0.0f;  b2 = -alp;
            a0 = 1.0f+alp;  a1 = -2.0f*cw;  a2 = 1.0f-alp;
            break;
        case FType::Notch:
        default:
            b0 = 1.0f;  b1 = -2.0f*cw;  b2 = 1.0f;
            a0 = 1.0f+alp;  a1 = -2.0f*cw;  a2 = 1.0f-alp;
            break;
    }

    BiquadCoeffs out;
    out.b0 = b0/a0;  out.b1 = b1/a0;  out.b2 = b2/a0;
    out.a1 = a1/a0;  out.a2 = a2/a0;
    return out;
}

// ── Utility functions ─────────────────────────────────────────────────────────

inline float dbToLin(float db) noexcept { return std::pow(10.0f, db / 20.0f); }
inline float linToDb(float v)  noexcept { return v > 1e-7f ? 20.0f * std::log10(v) : -140.0f; }

/** One-pole envelope coefficient from a time constant in milliseconds. */
inline float envCoef(float ms, float sr) noexcept
{
    return std::exp(-1.0f / (std::max(0.02f, ms) * 0.001f * sr));
}

inline float clamp01(float v) noexcept { return std::max(0.0f, std::min(1.0f, v)); }
inline float clampf(float v, float lo, float hi) noexcept { return std::max(lo, std::min(hi, v)); }

/** Hermite cubic spline interpolation (matches de-clip kernel). */
inline float hermite(float x0, float x1, float x2, float x3, float t) noexcept
{
    const float c0 = x1;
    const float c1 = 0.5f * (x2 - x0);
    const float c2 = x0 - 2.5f * x1 + 2.0f * x2 - 0.5f * x3;
    const float c3 = 0.5f * (x3 - x0) + 1.5f * (x1 - x2);
    return ((c3 * t + c2) * t + c1) * t + c0;
}

/** Arctan saturation shape (warm). */
inline float shapeWarm(float x, float k) noexcept
{
    if (k < 0.001f) return x;
    return std::atan(x * (1.0f + k * 4.0f)) / std::atan(1.0f + k * 4.0f);
}

/** Tape-style cubic clip. */
inline float shapeTape(float x, float k) noexcept
{
    if (k < 0.001f) return x;
    float d = x * (1.0f + k * 2.0f);
    d = clampf(d, -1.0f, 1.0f);
    return (d - (d * d * d) / 3.0f) / (1.0f + k * 0.9f) * 1.5f;
}

/** Tube asymmetric transfer. */
inline float shapeTube(float x, float k) noexcept
{
    if (k < 0.001f) return x;
    const float g = 1.0f + k * 5.0f;
    const float denom = 1.0f - std::exp(-g);
    if (x >= 0.0f) return (1.0f - std::exp(-g * x)) / denom;
    return -(1.0f - std::exp(g * x)) * (1.0f - k * 0.25f) / denom;
}

/** Retro hard-ish fold. */
inline float shapeRetro(float x, float k) noexcept
{
    if (k < 0.001f) return x;
    const float kk = 1.0f + k * 30.0f;
    return (kTwoPi / 2.0f + kk) * x / (kTwoPi / 2.0f + kk * std::abs(x));
}

/** Apply saturation mode (0=Warm, 1=Tape, 2=Tube, 3=Retro). */
inline float shapeMode(float x, int mode, float k) noexcept
{
    switch (mode)
    {
        case 0: return shapeWarm(x, k);
        case 1: return shapeTape(x, k);
        case 2: return shapeTube(x, k);
        default: return shapeRetro(x, k);
    }
}

/** Insertion-sort median of a small array (copy). */
template <int N>
inline float medianN(float (&arr)[N]) noexcept
{
    float tmp[N];
    std::copy(arr, arr + N, tmp);
    for (int i = 1; i < N; ++i)
    {
        float key = tmp[i];
        int j = i - 1;
        while (j >= 0 && tmp[j] > key) { tmp[j+1] = tmp[j]; --j; }
        tmp[j+1] = key;
    }
    return tmp[N / 2];
}

} // namespace Virgo
