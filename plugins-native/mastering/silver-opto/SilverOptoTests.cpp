#include "PluginProcessor.h"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <memory>
#include <stdexcept>

namespace
{
    constexpr double sampleRate = 48000.0;
    constexpr int blockSize = 256;

    void require(bool condition, const char* message)
    {
        if (!condition)
            throw std::runtime_error(message);
    }

    void setParameter(VASilverOptoProcessor& processor, const char* id, float value)
    {
        auto* parameter = processor.apvts.getParameter(id);
        require(parameter != nullptr, "Expected parameter was not registered");
        parameter->setValueNotifyingHost(parameter->convertTo0to1(value));
    }

    struct SignalResult
    {
        double rms = 0.0;
        float peak = 0.0f;
        float reductionDb = 0.0f;
    };

    SignalResult processTone(VASilverOptoProcessor& processor, float amplitude, double seconds)
    {
        juce::AudioBuffer<float> buffer(2, blockSize);
        juce::MidiBuffer midi;
        const int totalSamples = static_cast<int>(seconds * sampleRate);
        double sumSquares = 0.0;
        int measuredSamples = 0;
        float peak = 0.0f;
        double phase = 0.0;
        const double phaseStep = juce::MathConstants<double>::twoPi * 997.0 / sampleRate;

        for (int offset = 0; offset < totalSamples; offset += blockSize)
        {
            const int samples = std::min(blockSize, totalSamples - offset);
            buffer.setSize(2, samples, false, false, true);
            for (int i = 0; i < samples; ++i)
            {
                const float left = amplitude * static_cast<float>(std::sin(phase));
                const float right = amplitude * static_cast<float>(std::sin(phase + 0.37));
                phase += phaseStep;
                buffer.setSample(0, i, left);
                buffer.setSample(1, i, right);
            }

            processor.processBlock(buffer, midi);
            for (int channel = 0; channel < 2; ++channel)
                for (int i = 0; i < samples; ++i)
                {
                    const float sample = buffer.getSample(channel, i);
                    require(std::isfinite(sample), "Processed output contains NaN or Inf");
                    peak = std::max(peak, std::abs(sample));
                    sumSquares += static_cast<double>(sample) * sample;
                    ++measuredSamples;
                }
        }

        return { std::sqrt(sumSquares / measuredSamples), peak, processor.getGainReductionDb() };
    }

    void testParametersPresetsAndState()
    {
        VASilverOptoProcessor processor;
        require(processor.getBusCount(true) == 1 && processor.getBusCount(false) == 1,
                "Expected one stereo input and output bus");
        require(processor.getTotalNumInputChannels() == 2 && processor.getTotalNumOutputChannels() == 2,
                "Expected stereo input and output");
        require(processor.apvts.getParameter("gain") != nullptr, "Gain parameter missing");
        require(processor.apvts.getParameter("peakReduction") != nullptr, "Peak Reduction parameter missing");
        require(processor.apvts.getParameter("mode") != nullptr, "Compress/Limit parameter missing");
        require(processor.apvts.getParameter("meter") != nullptr, "Meter parameter missing");
        require(processor.getNumPrograms() >= 6, "Factory presets missing");

        processor.setCurrentProgram(5);
        require(processor.getCurrentProgram() == 5, "Preset selection did not update");
        require(*processor.apvts.getRawParameterValue("mode") > 0.5f,
                "Limit preset did not set Limit mode");

        setParameter(processor, "gain", 63.0f);
        setParameter(processor, "peakReduction", 41.0f);
        setParameter(processor, "mode", 0.0f);
        setParameter(processor, "meter", 1.0f);
        juce::MemoryBlock state;
        processor.getStateInformation(state);

        VASilverOptoProcessor restored;
        restored.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
        require(std::abs(*restored.apvts.getRawParameterValue("gain") - 63.0f) < 0.01f,
                "Gain did not survive state restore");
        require(std::abs(*restored.apvts.getRawParameterValue("peakReduction") - 41.0f) < 0.01f,
                "Peak Reduction did not survive state restore");
        require(*restored.apvts.getRawParameterValue("mode") < 0.5f,
                "Mode did not survive state restore");
        require(*restored.apvts.getRawParameterValue("meter") > 0.5f,
                "Meter mode did not survive state restore");

        std::unique_ptr<juce::AudioProcessorEditor> editor(restored.createEditor());
        require(editor != nullptr && editor->getWidth() > 0 && editor->getHeight() > 0,
                "Custom editor could not be created");
    }

    void testSilenceAndStereoSignal()
    {
        VASilverOptoProcessor processor;
        processor.prepareToPlay(sampleRate, blockSize);

        juce::AudioBuffer<float> silence(2, blockSize);
        silence.clear();
        juce::MidiBuffer midi;
        processor.processBlock(silence, midi);
        require(silence.getMagnitude(0, blockSize) == 0.0f, "Silence produced output");

        setParameter(processor, "gain", 50.0f);
        setParameter(processor, "peakReduction", 0.0f);
        const auto signal = processTone(processor, 0.2f, 0.25);
        require(signal.rms > 0.05, "Plugin did not pass audio");
        require(signal.peak < 2.0f, "Plugin produced an excessive output level");
    }

    void testLevelSweepAndRelease()
    {
        float previousReduction = 0.1f;
        for (const float amplitude : { 0.03f, 0.10f, 0.30f, 0.80f })
        {
            VASilverOptoProcessor processor;
            processor.prepareToPlay(sampleRate, blockSize);
            setParameter(processor, "gain", 50.0f);
            setParameter(processor, "peakReduction", 55.0f);
            setParameter(processor, "mode", 0.0f);
            const auto result = processTone(processor, amplitude, 0.6);
            require(result.peak < 2.0f, "Level sweep produced excessive output");
            require(result.reductionDb <= previousReduction + 0.25f,
                    "Gain reduction did not increase with input level");
            previousReduction = result.reductionDb;
        }
        require(previousReduction < -6.0f, "High-level signal did not produce useful gain reduction");

        VASilverOptoProcessor processor;
        processor.prepareToPlay(sampleRate, blockSize);
        setParameter(processor, "peakReduction", 70.0f);
        setParameter(processor, "mode", 1.0f);
        processTone(processor, 0.8f, 0.5);
        const float compressed = processor.getGainReductionDb();
        processTone(processor, 0.0f, 1.5);
        const float released = processor.getGainReductionDb();
        require(compressed < -10.0f, "Limit mode did not produce strong gain reduction");
        require(released > compressed + 3.0f, "Optical envelope did not release after signal ended");
        require(released <= 0.1f, "Release produced positive gain reduction");
    }
}

int main()
{
    try
    {
        juce::ScopedJuceInitialiser_GUI juce;
        testParametersPresetsAndState();
        testSilenceAndStereoSignal();
        testLevelSweepAndRelease();
        std::cout << "VA Silver Opto verification passed\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "VA Silver Opto verification failed: " << error.what() << '\n';
        return 1;
    }
}