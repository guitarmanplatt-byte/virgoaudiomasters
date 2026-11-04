#include "PitchEngine.h"
#include <iostream>
#include <stdexcept>
#include <chrono>
#include <limits>

namespace
{
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
double note(double midi) { return 440 * std::exp2((midi - 69) / 12); }
double power(const std::vector<float>& audio, double rate, double frequency)
{
    std::complex<double> result {};
    const size_t start = audio.size() / 2;
    for (size_t i = start; i < audio.size(); ++i)
    {
        const double w = 0.5 - 0.5 * std::cos(2 * VirgoPitch::pi * (i - start) / (audio.size() - start));
        result += std::polar(static_cast<double>(audio[i]) * w, -2 * VirgoPitch::pi * frequency * i / rate);
    }
    return std::norm(result);
}
double measured(const std::vector<float>& audio, double rate, double expected)
{
    double best = -1, frequency = expected;
    for (int cents = -60; cents <= 60; ++cents)
    {
        const double f = expected * std::exp2(cents / 1200.0);
        const double value = power(audio, rate, f);
        if (value > best) { best = value; frequency = f; }
    }
    return 1200 * std::log2(frequency / expected);
}
std::vector<float> render(VirgoPitch::Engine& engine, double rate,
    const VirgoPitch::Settings& settings, const std::vector<double>& frequencies, double seconds = 1.4)
{
    std::vector<float> result(static_cast<size_t>(seconds * rate));
    for (size_t i = 0; i < result.size(); ++i)
    {
        double sample = 0;
        for (auto f : frequencies) sample += 0.1 * std::sin(2 * VirgoPitch::pi * f * i / rate);
        const auto output = engine.process(static_cast<float>(sample), 0, settings);
        require(std::isfinite(output[0]) && std::abs(output[0]) < 4, "Invalid/unbounded output");
        require(std::abs(output[1]) < 1e-7, "Left channel leaked to right");
        result[i] = output[0];
    }
    return result;
}
}
int main()
{
    try
    {
        const auto start = std::chrono::steady_clock::now();
        for (int root = 0; root < 12; ++root)
            for (int scale = 0; scale < 5; ++scale)
                for (int noteIndex = 24; noteIndex < 108; ++noteIndex)
                {
                    const auto target = VirgoPitch::targetNote(noteIndex + 0.19, root, scale);
                    require(VirgoPitch::scaleContains(static_cast<int>(target), root, scale), "Invalid scale target");
                    require(std::abs(target - noteIndex - 0.19) <= 1.2, "Scale target too far");
                }
        for (const auto rate : {44100.0, 48000.0, 96000.0})
        {
            VirgoPitch::Engine engine; engine.prepare(rate);
            VirgoPitch::Settings settings;
            settings.amount = 1; settings.responseMs = 30; settings.toleranceCents = 0;
            settings.preserveFormants = settings.preserveTransients = false;
            const auto silence = render(engine, rate, settings, {});
            for (const auto value : silence) require(value == 0, "Silence produced audio");
            engine.prepare(rate);
            const auto chord = render(engine, rate, settings,
                {note(60.23), note(64 - 0.18), note(67.31)});
            for (const auto midi : {60, 64, 67})
            {
                const double error = measured(chord, rate, note(midi));
                std::cout << rate << " Hz: chord MIDI " << midi << " error " << error << " cents\n";
                require(std::abs(error) <= 5.0, "Synthetic chord tuning exceeded five cents");
            }
            engine.prepare(rate); settings.amount = 0;
            const auto unity = render(engine, rate, settings, {note(61.3)});
            double error = 0, original = 0;
            for (size_t i = unity.size() / 2; i < unity.size(); ++i)
            {
                const double expected = 0.1 * std::sin(2 * VirgoPitch::pi * note(61.3) * (i - engine.latency()) / rate);
                error += std::pow(unity[i] - expected, 2); original += expected * expected;
            }
            require(error / original < 1e-8, "Correction-off reconstruction is not transparent");
            engine.prepare(rate); settings.harmonyGain = {0.5f, 0.3f};
            settings.interval = {12, -1};
            const auto harmonies = render(engine, rate, settings, {440});
            require(std::abs(measured(harmonies, rate, 880)) <= 5, "Octave harmony tuning failed");
            require(std::abs(measured(harmonies, rate, 440 * std::exp2(-1.0 / 12))) <= 5, "Dissonant semitone tuning failed");
            engine.prepare(rate);
            settings.preserveFormants = settings.preserveTransients = true;
            for (int i = 0; i < static_cast<int>(rate / 2); ++i)
            {
                settings.root = (i / 4096) % 12;
                settings.interval[0] = (i / 1024) % 49 - 24;
                const auto out = engine.process(i % 5 == 0 ? std::numeric_limits<float>::quiet_NaN() : 0.2f, 0, settings);
                require(std::isfinite(out[0]) && std::isfinite(out[1]), "Automation/invalid input caused non-finite output");
            }
        }
        std::cout << "PASS: all key/scale targets, detuned three-note chords within five cents, octave and dissonant harmony tuning, transparent correction-off reconstruction, silence, stereo isolation, automation, invalid inputs at 44.1/48/96 kHz ("
                  << std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count() << " s)\n";
        return 0;
    }
    catch (const std::exception& error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; }
}
