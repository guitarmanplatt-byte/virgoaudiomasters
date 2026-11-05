#include "FuzzCircuit.h"
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <vector>

static void require(bool condition, const char* message)
{
    if (!condition) throw std::runtime_error(message);
}
int main()
{
    try
    {
        constexpr double pi = 3.14159265358979323846;
        const auto start = std::chrono::steady_clock::now();
        for (const double rate : {44100.0, 48000.0, 96000.0})
            for (const double tone : {0.0, 0.25, 0.5, 0.75, 1.0})
            {
                VirgoFuzz::Circuit circuit;
                circuit.prepare(rate * 4, tone);
                double silencePeak = 0, energy = 0, peak = 0, dc = 0;
                for (int i = 0; i < 1024; ++i)
                    silencePeak = std::max(silencePeak, std::abs(static_cast<double>(circuit.process(0, tone))));
                require(silencePeak < 1e-5, "DC initialisation produced a pop");
                for (int i = 0; i < 8192; ++i)
                {
                    const auto x = static_cast<float>(0.1 * std::sin(2 * pi * 220 * i / (rate * 4)));
                    const auto y = circuit.process(x, tone);
                    require(std::isfinite(y), "Circuit generated non-finite audio");
                    energy += y * y; dc += y; peak = std::max(peak, std::abs(static_cast<double>(y)));
                }
                require(energy > 1e-5 && peak < 2, "Circuit was silent or unstable");
                require(std::abs(dc / 8192) < 0.03, "Circuit generated excessive DC");
                for (int i = 0; i < 50000; ++i) circuit.process(0, tone);
                require(std::abs(circuit.process(0, tone)) < 1e-4, "Circuit did not decay to silence");
            }
        VirgoFuzz::Circuit low, high;
        low.prepare(192000, 0); high.prepare(192000, 1);
        double difference = 0;
        for (int i = 0; i < 8192; ++i)
        {
            const auto x = static_cast<float>(0.2 * std::sin(2 * pi * 440 * i / 192000));
            difference += std::abs(low.process(x, 0) - high.process(x, 1));
        }
        require(difference > 1, "Tone did not change the stage blend");
        VirgoFuzz::Circuit harmonics;
        harmonics.prepare(192000, 0.75);
        for (int i = 0; i < 48000; ++i)
            harmonics.process(static_cast<float>(0.1 * std::sin(2 * pi * 220 * i / 192000)), 0.75);
        std::array<double, 4> real {}, imaginary {};
        for (int i = 0; i < 48000; ++i)
        {
            const auto y = harmonics.process(static_cast<float>(0.1 * std::sin(2 * pi * 220 * i / 192000)), 0.75);
            for (int h = 1; h <= 4; ++h)
            {
                const double angle = 2 * pi * 220 * h * i / 192000;
                real[static_cast<size_t>(h - 1)] += y * std::cos(angle);
                imaginary[static_cast<size_t>(h - 1)] += y * std::sin(angle);
            }
        }
        const auto fundamental = std::hypot(real[0], imaginary[0]);
        const auto distortion = std::hypot(real[1], imaginary[1]) + std::hypot(real[2], imaginary[2]);
        require(distortion > fundamental * 0.05, "Circuit did not generate meaningful fuzz harmonics");
        for (int i = 0; i < 10000; ++i)
            require(std::isfinite(low.process(i % 2 ? 8.0f : -8.0f, (i % 100) / 100.0)),
                "Extreme input/automation destabilised the circuit");
        const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
        std::cout << "PASS: Fuzz 66 circuit, DC startup, tone blend, finite output, extremes, decay, 44.1/48/96 kHz ("
                  << elapsed << " seconds)\n";
        return 0;
    }
    catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
