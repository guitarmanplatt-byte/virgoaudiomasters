#include "PluginProcessor.h"
#include <juce_audio_utils/juce_audio_utils.h>
#include <iostream>
#include <stdexcept>

namespace
{
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
void set(VirgoPitchProcessor& p, const char* id, float value)
{
    auto* parameter = p.apvts.getParameter(id);
    require(parameter != nullptr, "Missing parameter");
    parameter->setValueNotifyingHost(parameter->convertTo0to1(value));
}
std::vector<float> render(juce::AudioProcessor& p, double rate, int block, bool bypass = false, bool silence = false)
{
    std::vector<float> result(static_cast<size_t>(rate * 0.9));
    juce::AudioBuffer<float> audio(2, block);
    juce::MidiBuffer midi;
    for (int offset = 0; offset < static_cast<int>(result.size()); offset += block)
    {
        const int count = std::min(block, static_cast<int>(result.size()) - offset);
        audio.setSize(2, count, false, false, true);
        for (int i = 0; i < count; ++i)
        {
            const float sample = silence ? 0.0f : static_cast<float>(0.1 * std::sin(2 * VirgoPitch::pi * 445 * (offset + i) / rate));
            audio.setSample(0, i, sample); audio.setSample(1, i, sample * -0.5f);
        }
        if (bypass) p.processBlockBypassed(audio, midi); else p.processBlock(audio, midi);
        for (int i = 0; i < count; ++i)
        {
            const float l = audio.getSample(0, i), r = audio.getSample(1, i);
            require(std::isfinite(l) && std::isfinite(r), "Non-finite processor output");
            require(std::abs(l) < 4 && std::abs(r) < 4, "Excessive processor output");
            require(std::abs(r + l * 0.5f) < 1e-4f, "Stereo phase/amplitude relationship changed");
            result[static_cast<size_t>(offset + i)] = l;
        }
    }
    return result;
}
void dryCheck(const std::vector<float>& audio, double rate, int latency)
{
    for (size_t i = audio.size() / 2; i < audio.size(); ++i)
    {
        const double expected = 0.1 * std::sin(2 * VirgoPitch::pi * 445 * (i - latency) / rate);
        require(std::abs(audio[i] - expected) < 1e-6, "Bypass/dry signal did not match reported latency");
    }
}
void tests()
{
    for (const double rate : {44100.0, 48000.0, 96000.0})
    {
        VirgoPitchProcessor p; p.prepareToPlay(rate, 128);
        require(p.getLatencySamples() > 0, "Latency not reported");
        const auto silence = render(p, rate, 128, false, true);
        for (float sample : silence) require(sample == 0, "Silent input produced output");
        const auto processed = render(p, rate, 128);
        double energy = 0;
        for (float sample : processed) energy += sample * sample;
        require(energy > 1, "Processor did not pass audio");
        set(p, "bypass", 1); dryCheck(render(p, rate, 127), rate, p.getLatencySamples());
        set(p, "bypass", 0); dryCheck(render(p, rate, 257, true), rate, p.getLatencySamples());
        set(p, "mix", 0); dryCheck(render(p, rate, 1001), rate, p.getLatencySamples());
        set(p, "root", 9); set(p, "scale", 2); set(p, "voice1on", 1);
        set(p, "voice1interval", 10); set(p, "voice2interval", 12); set(p, "amount", 51);
        juce::MemoryBlock state; p.getStateInformation(state);
        VirgoPitchProcessor restored; restored.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
        for (const char* id : {"root", "scale", "voice1on", "voice1interval", "voice2interval", "amount", "mix"})
            require(restored.apvts.getRawParameterValue(id)->load() == p.apvts.getRawParameterValue(id)->load(), "Saved settings did not restore");
        restored.setStateInformation("bad", 3);
        VirgoPitchProcessor one, two;
        one.prepareToPlay(rate, 64); two.prepareToPlay(rate, 1024);
        const auto a = render(one, rate, 64), b = render(two, rate, 1001);
        for (size_t i = 0; i < a.size(); ++i) require(std::abs(a[i] - b[i]) < 1e-6, "Audio changed with host block size");
    }
    VirgoPitchProcessor mono;
    auto buses = mono.getBusesLayout();
    buses.inputBuses.getReference(0) = juce::AudioChannelSet::mono();
    buses.outputBuses.getReference(0) = juce::AudioChannelSet::mono();
    require(mono.setBusesLayout(buses), "Mono layout rejected");
    mono.prepareToPlay(48000, 64);
    juce::AudioBuffer<float> audio(1, 1001); audio.clear(); juce::MidiBuffer midi;
    mono.processBlock(audio, midi);
    require(audio.getMagnitude(0, 1001) == 0, "Mono silence failed");
    std::cout << "PASS: Virgo Pitch mono/stereo, silence, latency-aligned internal/host bypass and dry mix, state restoration, variable block sizes at 44.1/48/96 kHz\n";
}
}
int main(int argc, char** argv)
{
    std::cout.setf(std::ios::unitbuf);
    try
    {
        juce::ScopedJuceInitialiser_GUI initialise;
        tests();
        if (argc > 1)
        {
            const auto binary = juce::File(juce::String::fromUTF8(argv[1]));
            const auto bundle = binary.getParentDirectory().getParentDirectory().getParentDirectory();
            juce::AudioPluginFormatManager formats; formats.addDefaultFormats();
            juce::OwnedArray<juce::PluginDescription> descriptions;
            for (auto* format : formats.getFormats())
                if (format->getName() == "VST3") format->findAllTypesForFile(descriptions, bundle.getFullPathName());
            require(descriptions.size() == 1, "Virgo Pitch VST3 scan failed");
            juce::String error;
            auto plugin = formats.createPluginInstance(*descriptions[0], 48000, 128, error);
            require(plugin != nullptr, ("Virgo Pitch VST3 load failed: " + error).toRawUTF8());
            plugin->prepareToPlay(48000, 128);
            const auto audio = render(*plugin, 48000, 128);
            double energy = 0; for (float sample : audio) energy += sample * sample;
            require(energy > 1, "Loaded VST3 did not process audio");
            plugin->releaseResources();
            std::cout << "PASS: actual Virgo Pitch VST3 scan, host load and processed audio\n";
        }
        if (argc > 2)
        {
            VirgoPitchProcessor p; p.prepareToPlay(48000, 128);
            std::unique_ptr<juce::AudioProcessorEditor> editor(p.createEditor());
            const auto image = editor->createComponentSnapshot(editor->getLocalBounds());
            auto stream = juce::File(juce::String::fromUTF8(argv[2])).createOutputStream();
            require(stream != nullptr, "Could not write native preview");
            juce::PNGImageFormat png;
            require(png.writeImageToStream(image, *stream), "Editor screenshot failed");
            std::cout << "PASS: native Virgo Pitch editor rendered\n";
        }
        return 0;
    }
    catch (const std::exception& error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; }
}
