#include "../src/Quantize.h"
#include <iostream>
#include <stdexcept>

int main()
{
    try
    {
        const auto require = [](bool condition, const char* error)
        { if (!condition) throw std::runtime_error(error); };
        for (double rate : {44100.0, 48000.0, 96000.0})
        {
            const int size = static_cast<int>(rate * 2);
            std::vector<float> audio(static_cast<size_t>(size), 0), output(static_cast<size_t>(size));
            const int first = static_cast<int>(rate * 0.13), second = static_cast<int>(rate * 0.38);
            audio[static_cast<size_t>(first)] = 0.8f; audio[static_cast<size_t>(second)] = -0.7f;
            const auto markers = studio::quantizeMarkers(audio.data(), nullptr, size, rate, 120, 16, 1);
            require(markers.size() == 2, "Transient detection failed");
            require(std::abs(markers[0].target / rate - 0.125) < 1.0 / rate, "First transient not snapped to grid");
            require(std::abs(markers[1].target / rate - 0.375) < 1.0 / rate, "Second transient not snapped to grid");
            studio::renderQuantized(audio.data(), output.data(), size, rate, markers);
            require(output[static_cast<size_t>(markers[0].target)] == 0.8f, "Attack changed");
            require(output[static_cast<size_t>(markers[1].target)] == -0.7f, "Stereo-linked marker failed");
            const auto zero = studio::quantizeMarkers(audio.data(), nullptr, size, rate, 120, 16, 0);
            studio::renderQuantized(audio.data(), output.data(), size, rate, zero);
            require(audio == output, "Zero strength changed audio");
            const auto half = studio::quantizeMarkers(audio.data(), nullptr, size, rate, 120, 16, 0.5);
            require(std::abs(half[0].target - (first + markers[0].target) / 2) <= 1, "Strength interpolation failed");
            std::vector<float> silence(static_cast<size_t>(size), 0);
            require(studio::quantizeMarkers(silence.data(), nullptr, size, rate, 120, 16, 1).empty(), "Silence detected as transients");
            require(studio::quantizeMarkers(audio.data(), nullptr, size, rate, 0, 16, 1).empty(), "Invalid tempo accepted");
            require(audio[static_cast<size_t>(first)] == 0.8f, "Source was modified");
        }
        std::cout << "PASS: quantization grid, detection, strength, silence, input validation, source preservation at 44.1/48/96 kHz\n";
        return 0;
    }
    catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
