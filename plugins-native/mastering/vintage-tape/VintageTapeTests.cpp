#include "PluginProcessor.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace
{
    using Processor = VAVintageTapeProcessor;
    constexpr double twoPi = 6.28318530717958647692;

    void require(bool condition, const char* message)
    {
        if (!condition)
            throw std::runtime_error(message);
    }

    void set(Processor& processor, const char* id, float value)
    {
        auto* parameter = processor.apvts.getParameter(id);
        require(parameter != nullptr, "Missing parameter");
        parameter->setValueNotifyingHost(parameter->convertTo0to1(value));
    }

    void neutral(Processor& processor)
    {
        set(processor, "saturation", 0);
        set(processor, "bumpGain", 0);
        set(processor, "rolloffFreq", 20000);
        set(processor, "wow", 0);
        set(processor, "flutter", 0);
        set(processor, "mix", 1);
        set(processor, "trim", 0);
    }

    using Signal = std::function<float(int, int)>;

    // Exercise the real AudioProcessor, including unequal stereo channels,
    // partial final blocks and JUCE's ScopedNoDenormals in processBlock.
    std::vector<float> render(Processor& processor, int count,
                              int blockSize, const Signal& input, int channels = 2,
                              float ceiling = std::numeric_limits<float>::max())
    {
        std::vector<float> output(static_cast<size_t>(count));
        juce::AudioBuffer<float> buffer(channels, blockSize);
        juce::MidiBuffer midi;
        for (int offset = 0; offset < count; offset += blockSize)
        {
            const int size = std::min(blockSize, count - offset);
            buffer.setSize(channels, size, false, false, true);
            for (int channel = 0; channel < channels; ++channel)
                for (int i = 0; i < size; ++i)
                    buffer.setSample(channel, i, input(offset + i, channel));
            processor.processBlock(buffer, midi);
            for (int channel = 0; channel < channels; ++channel)
                for (int i = 0; i < size; ++i)
                {
                    const float sample = buffer.getSample(channel, i);
                    require(std::isfinite(sample), "NaN/Inf in output");
                    require(std::fpclassify(sample) != FP_SUBNORMAL, "Subnormal in output");
                    require(std::abs(sample) <= ceiling, "Output exceeded ceiling");
                    if (channel == 0)
                        output[static_cast<size_t>(offset + i)] = sample;
                }
        }
        return output;
    }

    void bypass(double rate, int blockSize, int channels)
    {
        Processor processor;
        // Leave the wet chain active to catch in-place aliasing bugs.
        set(processor, "mix", 0);
        processor.prepareToPlay(rate, blockSize);
        const auto input = [rate](int i, int channel)
        {
            return static_cast<float>(1.3 * std::sin(twoPi * (channel == 0 ? 997 : 431) * i / rate));
        };
        const int count = static_cast<int>(rate) + 13;
        const auto output = render(processor, count, blockSize, input, channels);
        for (int i = 0; i < count; ++i)
            require(output[static_cast<size_t>(i)] == input(i, 0), "Mix=0 changed dry input");

        // Check both dry stereo channels independently (render returns only L).
        juce::AudioBuffer<float> buffer(channels, 7);
        juce::MidiBuffer midi;
        for (int channel = 0; channel < channels; ++channel)
            for (int i = 0; i < 7; ++i)
                buffer.setSample(channel, i, input(i + 123, channel));
        processor.processBlock(buffer, midi);
        for (int channel = 0; channel < channels; ++channel)
            for (int i = 0; i < 7; ++i)
                require(buffer.getSample(channel, i) == input(i + 123, channel), "Dry channel changed");
    }

    void saturation(double rate)
    {
        Processor processor;
        neutral(processor);
        set(processor, "saturation", 1);
        processor.prepareToPlay(rate, 257);
        const auto output = render(processor, static_cast<int>(rate * 2), 257,
            [rate](int i, int channel)
            {
                const float value = static_cast<float>(4 * std::sin(twoPi * 1000 * i / rate));
                return channel == 0 ? value : -value;
            });
        double mean = 0, power = 0;
        float peak = 0;
        const int start = static_cast<int>(rate);
        for (size_t i = static_cast<size_t>(start); i < output.size(); ++i)
        {
            mean += output[i];
            power += static_cast<double>(output[i]) * output[i];
            peak = std::max(peak, std::abs(output[i]));
        }
        const double n = static_cast<double>(output.size()) - start;
        std::cout << "  saturation peak=" << peak << " DC=" << mean / n << std::endl;
        require(peak <= 1.000001f, "Saturation exceeded unity ceiling");
        require(std::sqrt(power / n) > 0.3, "Saturation output is silent or too quiet");
        require(std::abs(mean / n) < 0.001, "Saturation introduced DC offset");
    }

    double pitchDeviation(double rate, float wow, float flutter)
    {
        Processor processor;
        neutral(processor);
        set(processor, "wow", wow);
        set(processor, "flutter", flutter);
        processor.prepareToPlay(rate, 256);
        const auto output = render(processor, static_cast<int>(rate * 5), 256,
            [rate](int i, int) { return static_cast<float>(0.25 * std::sin(twoPi * 1000 * i / rate)); });
        double previousCrossing = -1, sum = 0;
        int periods = 0;
        for (size_t i = static_cast<size_t>(rate / 2); i < output.size(); ++i)
        {
            if (output[i - 1] <= 0 && output[i] > 0)
            {
                const double crossing = static_cast<double>(i - 1)
                    - output[i - 1] / static_cast<double>(output[i] - output[i - 1]);
                if (previousCrossing >= 0)
                {
                    const double deltaHz = rate / (crossing - previousCrossing) - 1000;
                    sum += deltaHz * deltaHz;
                    ++periods;
                }
                previousCrossing = crossing;
            }
        }
        require(periods > 4000, "Pitch test lost signal/zero crossings");
        return std::sqrt(sum / periods);
    }

    void modulation(double rate)
    {
        const double baseline = pitchDeviation(rate, 0, 0);
        const double wow = pitchDeviation(rate, 1, 0);
        const double flutter = pitchDeviation(rate, 0, 1);
        std::cout << "  pitch RMS Hz: baseline=" << baseline << " wow=" << wow
                  << " flutter=" << flutter << std::endl;
        require(baseline < 0.1, "Unmodulated tone is unstable");
        require(wow > 1 && wow > baseline * 10, "Wow did not modulate pitch");
        require(flutter > 1 && flutter > baseline * 10, "Flutter did not modulate pitch");
    }

    void ceiling(double rate)
    {
        for (const float trim : {-12.0f, -6.0f, 0.0f, 6.0f})
            for (const float mix : {0.25f, 1.0f})
            {
                Processor processor;
                neutral(processor);
                set(processor, "trim", trim);
                set(processor, "mix", mix);
                processor.prepareToPlay(rate, 127);
                const float limit = Virgo::dbToLin(trim);
                const auto output = render(processor, static_cast<int>(rate), 127,
                    [rate](int i, int channel)
                    {
                        return static_cast<float>((channel ? -1 : 1) * 8 * std::sin(twoPi * 1000 * i / rate));
                    }, 2, limit + 0.000001f);
                float peak = 0;
                for (float sample : output)
                    peak = std::max(peak, std::abs(sample));
                require(peak <= limit + 0.000001f, "Trim did not enforce sample ceiling");
                require(peak >= limit * 0.99f, "Ceiling test never reached limit");
            }
    }

    void silenceAndLifecycle(double rate)
    {
        Processor processor;
        set(processor, "saturation", 1);
        set(processor, "bumpGain", 8);
        set(processor, "wow", 1);
        set(processor, "flutter", 1);
        processor.prepareToPlay(rate, 256);
        const auto tail = render(processor, static_cast<int>(rate * 3), 256,
            [](int i, int channel)
            {
                return i == 0 ? (channel ? -1.0f : 1.0f) : 0.0f;
            });
        for (size_t i = tail.size() - 256; i < tail.size(); ++i)
            require(std::abs(tail[i]) < 1e-15f, "Impulse tail failed to decay");

        const auto tiny = render(processor, 4096, 31,
            [](int, int) { return std::numeric_limits<float>::denorm_min(); });
        juce::ignoreUnused(tiny);
        processor.releaseResources();
        processor.prepareToPlay(rate, 256);
        const auto reset = render(processor, 1024, 256, [](int, int) { return 0.0f; });
        for (float value : reset)
            require(value == 0.0f, "Re-prepare retained stale audio");

        // Maximum controls, both polarities, and unusually hot finite samples.
        for (float input : {-1e20f, 1e20f})
        {
            const auto hot = render(processor, 4096, 31, [input](int, int) { return input; });
            for (float value : hot)
                require(std::abs(value) <= 1.000001f, "Hot input escaped ceiling");
        }
    }

    void monoMatchesStereo(double rate)
    {
        Processor mono, stereo;
        for (auto* processor : {&mono, &stereo})
        {
            set(*processor, "mix", 0.4f);
            set(*processor, "trim", -3.0f);
            processor->prepareToPlay(rate, 127);
        }
        const auto input = [rate](int i, int)
        {
            return static_cast<float>(0.3 * std::sin(twoPi * 997 * i / rate));
        };
        const auto a = render(mono, 8193, 127, input, 1);
        const auto b = render(stereo, 8193, 127, input, 2);
        require(a == b, "Mono dry/wet mix differs from stereo");
    }
}

int main()
{
    juce::ScopedJuceInitialiser_GUI init;
    try
    {
        std::cout << "Vintage Tape signal tests started" << std::endl;
        for (double rate : {44100.0, 48000.0, 96000.0})
        {
            std::cout << "Sample rate " << rate << std::endl;
            for (int block : {1, 127, 512})
                for (int channels : {1, 2})
                    bypass(rate, block, channels);
            std::cout << "  bypass PASS" << std::endl;
            monoMatchesStereo(rate);
            saturation(rate);
            modulation(rate);
            ceiling(rate);
            silenceAndLifecycle(rate);
        }
        std::cout << "PASS: bypass, saturation/DC, wow/flutter, ceiling, denormals and reset" << std::endl;
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL: " << error.what() << std::endl;
        return 1;
    }
}
