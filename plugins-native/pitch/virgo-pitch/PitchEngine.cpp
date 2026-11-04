#include "PitchEngine.h"

namespace VirgoPitch
{
namespace
{
double wrap(double value) { return std::remainder(value, 2 * pi); }
double safe(float value) { return std::isfinite(value) ? std::clamp<double>(value, -8, 8) : 0; }
int previousBin(const std::vector<int>& peaks, int bin)
{
    const auto it = std::lower_bound(peaks.begin(), peaks.end(), bin);
    int result = bin, distance = 4;
    if (it != peaks.end() && std::abs(*it - bin) < distance)
    { result = *it; distance = std::abs(*it - bin); }
    if (it != peaks.begin() && std::abs(*(it - 1) - bin) < distance) result = *(it - 1);
    return result;
}
}
void Engine::prepare(double sampleRate)
{
    rate = std::clamp(sampleRate, 22050.0, 192000.0);
    size = 4096;
    while (size < rate * 0.17 && size < 32768) size *= 2;
    hop = size / 8;
    write = outputPosition = 0; untilFrame = hop;
    const auto bins = static_cast<size_t>(size / 2 + 1);
    for (int channel = 0; channel < 2; ++channel)
    {
        input[channel].assign(static_cast<size_t>(size), 0);
        output[channel].assign(static_cast<size_t>(size * 4), 0);
        spectrum[channel].assign(static_cast<size_t>(size), {});
        synthesis[channel].assign(static_cast<size_t>(size), {});
        previousPhase[channel].assign(bins, 0);
        frequency[channel].assign(bins, 0);
        envelope[channel].assign(bins, 0);
        prefix[channel].assign(bins + 1, 0);
        for (int voice = 0; voice < 3; ++voice)
        {
            phase[voice][channel].assign(bins, 0);
            nextPhase[voice][channel].assign(bins, 0);
        }
    }
    magnitude.assign(bins, 0); previousMagnitude.assign(bins, 0);
    previousRatio.assign(bins, 1); nextRatio.assign(bins, 1);
    owner.assign(bins, 0); previousPeaks.clear();
    previousPeaks.reserve(bins); peaks.clear(); peaks.reserve(bins);
    window.resize(static_cast<size_t>(size));
    bitReverse.resize(static_cast<size_t>(size)); roots.resize(static_cast<size_t>(size / 2));
    int bits = 0;
    for (int n = size; n > 1; n >>= 1) ++bits;
    for (int i = 0; i < size; ++i)
    {
        window[static_cast<size_t>(i)] = 0.5 - 0.5 * std::cos(2 * pi * i / size);
        int reverse = 0, value = i;
        for (int bit = 0; bit < bits; ++bit) { reverse = (reverse << 1) | (value & 1); value >>= 1; }
        bitReverse[static_cast<size_t>(i)] = reverse;
    }
    for (int i = 0; i < size / 2; ++i)
        roots[static_cast<size_t>(i)] = std::polar(1.0, -2 * pi * i / size);
    correctionActivity = tonalConfidence = 0;
}
void Engine::fft(std::vector<std::complex<double>>& data, bool inverse) const
{
    for (int i = 0; i < size; ++i)
        if (i < bitReverse[static_cast<size_t>(i)])
            std::swap(data[static_cast<size_t>(i)], data[static_cast<size_t>(bitReverse[static_cast<size_t>(i)])]);
    for (int length = 2; length <= size; length *= 2)
        for (int start = 0; start < size; start += length)
            for (int j = 0; j < length / 2; ++j)
            {
                auto rotation = roots[static_cast<size_t>(j * size / length)];
                if (inverse) rotation = std::conj(rotation);
                const auto odd = data[static_cast<size_t>(start + j + length / 2)] * rotation;
                const auto even = data[static_cast<size_t>(start + j)];
                data[static_cast<size_t>(start + j)] = even + odd;
                data[static_cast<size_t>(start + j + length / 2)] = even - odd;
            }
    if (inverse) for (auto& value : data) value /= size;
}
std::array<float, 2> Engine::process(float left, float right, const Settings& settings)
{
    std::array<float, 2> result {};
    const std::array<float, 2> samples {left, right};
    for (int channel = 0; channel < 2; ++channel)
    {
        result[static_cast<size_t>(channel)] = output[channel][static_cast<size_t>(outputPosition)];
        output[channel][static_cast<size_t>(outputPosition)] = 0;
        input[channel][static_cast<size_t>(write)] = static_cast<float>(safe(samples[static_cast<size_t>(channel)]));
    }
    write = (write + 1) % size;
    if (--untilFrame == 0) { frame(settings); untilFrame = hop; }
    outputPosition = (outputPosition + 1) % (size * 4);
    return result;
}
double Engine::envelopeAt(int channel, double bin) const
{
    bin = std::clamp(bin, 0.0, static_cast<double>(size / 2 - 1));
    const int index = static_cast<int>(bin);
    const double fraction = bin - index;
    return envelope[channel][static_cast<size_t>(index)] * (1 - fraction)
         + envelope[channel][static_cast<size_t>(index + 1)] * fraction;
}
void Engine::frame(const Settings& settings)
{
    const int half = size / 2;
    double energy = 0, flux = 0, maximum = 0;
    for (int channel = 0; channel < 2; ++channel)
    {
        for (int i = 0; i < size; ++i)
            spectrum[channel][static_cast<size_t>(i)] =
                input[channel][static_cast<size_t>((write + i) % size)] * window[static_cast<size_t>(i)];
        fft(spectrum[channel], false);
        prefix[channel][0] = 0;
        for (int k = 0; k <= half; ++k)
        {
            const auto index = static_cast<size_t>(k);
            const double angle = std::arg(spectrum[channel][index]);
            const double expected = 2 * pi * k * hop / size;
            frequency[channel][index] = (expected + wrap(angle - previousPhase[channel][index] - expected))
                                     * rate / (2 * pi * hop);
            previousPhase[channel][index] = angle;
            prefix[channel][index + 1] = prefix[channel][index]
                + std::log(std::max(1e-9, std::abs(spectrum[channel][index])));
        }
        const int radius = std::max(3, static_cast<int>(250 * size / rate));
        for (int k = 0; k <= half; ++k)
        {
            const int lo = std::max(0, k - radius), hi = std::min(half, k + radius);
            envelope[channel][static_cast<size_t>(k)] =
                (prefix[channel][static_cast<size_t>(hi + 1)] - prefix[channel][static_cast<size_t>(lo)]) / (hi - lo + 1);
        }
    }
    for (int k = 0; k <= half; ++k)
    {
        const auto index = static_cast<size_t>(k);
        magnitude[index] = std::abs(spectrum[0][index]) + std::abs(spectrum[1][index]);
        maximum = std::max(maximum, magnitude[index]);
        energy += magnitude[index];
        flux += std::max(0.0, magnitude[index] - previousMagnitude[index]);
        previousMagnitude[index] = magnitude[index];
    }
    const bool transient = settings.preserveTransients && flux > 0.32 * std::max(energy, 1e-8);
    peaks.clear();
    for (int k = 2; k < half - 1; ++k)
        if (magnitude[static_cast<size_t>(k)] > maximum * 0.008
            && magnitude[static_cast<size_t>(k)] > magnitude[static_cast<size_t>(k - 1)]
            && magnitude[static_cast<size_t>(k)] >= magnitude[static_cast<size_t>(k + 1)])
        {
            const int channel = std::abs(spectrum[0][static_cast<size_t>(k)]) >= std::abs(spectrum[1][static_cast<size_t>(k)]) ? 0 : 1;
            peaks.push_back({k, -1, frequency[channel][static_cast<size_t>(k)], magnitude[static_cast<size_t>(k)], 1});
        }
    // Greedy harmonic grouping. Strong low fundamentals establish groups before
    // upper partials. Ambiguous/noisy regions are deliberately left uncorrected.
    double tonalEnergy = 0, correctedEnergy = 0;
    const double smoothing = 1 - std::exp(-hop / (rate * std::max(10.0f, settings.responseMs) * 0.001));
    for (size_t i = 0; i < peaks.size(); ++i)
    {
        auto& peak = peaks[i];
        for (size_t j = 0; j < i; ++j)
        {
            const auto& fundamental = peaks[j];
            if (fundamental.parent >= 0 || fundamental.frequency < 50 || fundamental.frequency > 1600) continue;
            const double harmonic = std::round(peak.frequency / fundamental.frequency);
            if (harmonic >= 2 && harmonic <= 20
                && fundamental.magnitude > peak.magnitude * 0.08
                && std::abs(1200 * std::log2(std::max(1.0, peak.frequency)
                                           / (fundamental.frequency * harmonic))) < 28)
            { peak.parent = static_cast<int>(j); break; }
        }
        if (peak.parent >= 0) { peak.ratio = peaks[static_cast<size_t>(peak.parent)].ratio; continue; }
        if (peak.frequency < 50 || peak.frequency > 1600 || peak.magnitude < maximum * 0.04) continue;
        // A stable narrow peak must dominate the adjacent spectral noise floor.
        double neighbourhood = 0;
        for (int d = -8; d <= 8; ++d)
            if (std::abs(d) >= 3 && peak.bin + d >= 0 && peak.bin + d <= half)
                neighbourhood += magnitude[static_cast<size_t>(peak.bin + d)];
        if (peak.magnitude < neighbourhood * 1.2) continue;
        tonalEnergy += peak.magnitude;
        const double midi = 69 + 12 * std::log2(peak.frequency / 440);
        const double cents = 100 * (targetNote(midi, settings.root, settings.scale) - midi);
        double desired = 1;
        if (std::abs(cents) > settings.toleranceCents && std::abs(cents) <= settings.maximumCents && !transient)
            desired = std::exp2(cents * settings.amount / 1200);
        const int old = previousBin(previousPeaks, peak.bin);
        peak.ratio = previousRatio[static_cast<size_t>(old)]
                   + smoothing * (desired - previousRatio[static_cast<size_t>(old)]);
        if (transient) peak.ratio = 1;
        correctedEnergy += peak.magnitude * std::min(1.0, std::abs(std::log2(peak.ratio)) * 24);
    }
    tonalConfidence = static_cast<float>(std::clamp(tonalEnergy * 3 / std::max(energy, 1e-9), 0.0, 1.0));
    correctionActivity = static_cast<float>(correctedEnergy / std::max(tonalEnergy, 1e-9));
    // Each bin belongs to its nearest local peak, preserving the phase shape of
    // that peak rather than shifting each harmonic's leakage bins independently.
    size_t nearestPeak = 0;
    for (int k = 0; k <= half; ++k)
    {
        while (nearestPeak + 1 < peaks.size()
               && std::abs(peaks[nearestPeak + 1].bin - k) < std::abs(peaks[nearestPeak].bin - k)) ++nearestPeak;
        owner[static_cast<size_t>(k)] = static_cast<int>(nearestPeak);
    }
    for (int voice = 0; voice < 3; ++voice)
    {
        const double gain = voice == 0 ? 1.0 : settings.harmonyGain[static_cast<size_t>(voice - 1)];
        const double intervalRatio = voice == 0 ? 1.0 : std::exp2(settings.interval[static_cast<size_t>(voice - 1)] / 12.0);
        for (int channel = 0; channel < 2; ++channel)
        {
            std::fill(synthesis[channel].begin(), synthesis[channel].end(), std::complex<double>{});
            for (const auto& peak : peaks)
            {
                const int old = previousBin(previousPeaks, peak.bin);
                const auto index = static_cast<size_t>(peak.bin);
                const double ratio = peak.ratio * intervalRatio;
                const bool unchanged = std::abs(ratio - 1) < 1e-7;
                const double originalPhase = std::arg(spectrum[channel][index]);
                const double advance = 2 * pi * frequency[channel][index] * ratio * hop / rate;
                nextPhase[voice][channel][index] = unchanged || transient || previousPeaks.empty()
                    ? originalPhase : wrap(phase[voice][channel][static_cast<size_t>(old)] + advance);
            }
            if (gain > 1e-6)
                for (int k = 1; k < half; ++k)
                {
                    const auto index = static_cast<size_t>(k);
                    if (peaks.empty()) { if (voice == 0) synthesis[channel][index] = spectrum[channel][index]; continue; }
                    const auto& peak = peaks[static_cast<size_t>(owner[index])];
                    const double ratio = peak.ratio * intervalRatio;
                    const int destination = k + static_cast<int>(std::lround(peak.frequency * (ratio - 1) * size / rate));
                    if (destination <= 0 || destination >= half) continue;
                    const double angle = nextPhase[voice][channel][static_cast<size_t>(peak.bin)]
                        + wrap(std::arg(spectrum[channel][index]) - std::arg(spectrum[channel][static_cast<size_t>(peak.bin)]));
                    double amplitude = std::abs(spectrum[channel][index]);
                    if (settings.preserveFormants && std::abs(ratio - 1) > 1e-5)
                        amplitude *= std::clamp(std::exp(envelopeAt(channel, destination) - envelopeAt(channel, k)), 0.5, 2.0);
                    synthesis[channel][static_cast<size_t>(destination)] += std::polar(amplitude, angle);
                }
            for (int k = 1; k < half; ++k)
                synthesis[channel][static_cast<size_t>(size - k)] = std::conj(synthesis[channel][static_cast<size_t>(k)]);
            if (voice == 0)
            {
                synthesis[channel][0] = spectrum[channel][0];
                synthesis[channel][static_cast<size_t>(half)] = spectrum[channel][static_cast<size_t>(half)];
            }
            if (gain > 1e-6)
            {
                fft(synthesis[channel], true);
                for (int i = 0; i < size; ++i)
                {
                    const int destination = (outputPosition + 1 + i) % (size * 4);
                    const double sample = synthesis[channel][static_cast<size_t>(i)].real()
                                        * window[static_cast<size_t>(i)] * gain / 3.0;
                    output[channel][static_cast<size_t>(destination)] += static_cast<float>(std::isfinite(sample) ? sample : 0);
                }
            }
            phase[voice][channel].swap(nextPhase[voice][channel]);
        }
    }
    std::fill(nextRatio.begin(), nextRatio.end(), 1);
    previousPeaks.clear();
    for (const auto& peak : peaks)
    { nextRatio[static_cast<size_t>(peak.bin)] = peak.ratio; previousPeaks.push_back(peak.bin); }
    previousRatio.swap(nextRatio);
}
}
