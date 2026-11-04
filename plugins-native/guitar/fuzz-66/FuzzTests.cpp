#include "PluginProcessor.h"
#include <juce_audio_utils/juce_audio_utils.h>
#include <iostream>
#include <stdexcept>

namespace
{
constexpr double pi = 3.14159265358979323846;
void require(bool condition, const char* message)
{
    if (!condition) throw std::runtime_error(message);
}
void set(VAFuzz66Processor& p, const char* id, float value)
{
    auto* parameter = p.apvts.getParameter(id);
    parameter->setValueNotifyingHost(parameter->convertTo0to1(value));
}
std::vector<float> render(juce::AudioProcessor& p, double rate, double frequency = 220,
    float level = 0.1f, int samples = 24000)
{
    juce::AudioBuffer<float> audio(2, 128);
    juce::MidiBuffer midi;
    std::vector<float> result;
    result.reserve(static_cast<size_t>(samples));
    for (int offset = 0; offset < samples; offset += 128)
    {
        const int count = std::min(128, samples - offset);
        audio.setSize(2, count, false, false, true);
        for (int i = 0; i < count; ++i)
        {
            audio.setSample(0, i, static_cast<float>(level * std::sin(2 * pi * frequency * (offset + i) / rate)));
            audio.setSample(1, i, 0);
        }
        p.processBlock(audio, midi);
        for (int i = 0; i < count; ++i)
        {
            const auto value = audio.getSample(0, i);
            require(std::isfinite(value) && std::abs(value) <= 1.001f, "Invalid/excessive fuzz output");
            require(std::abs(audio.getSample(1, i)) < 1e-6f, "Stereo channels leaked into one another");
            result.push_back(value);
        }
    }
    return result;
}
double rms(const std::vector<float>& audio)
{
    double sum = 0;
    for (size_t i = audio.size() / 2; i < audio.size(); ++i) sum += audio[i] * audio[i];
    return std::sqrt(sum / static_cast<double>(audio.size() - audio.size() / 2));
}
void tests()
{
    for (const auto rate : {44100.0, 48000.0, 96000.0})
    {
        VAFuzz66Processor p;
        p.prepareToPlay(rate, 128);
        require(rms(render(p, rate, 220, 0)) < 1e-6, "Silent input was not silent");
        const auto fuzz = render(p, rate);
        require(rms(fuzz) > 0.001, "Fuzz did not pass audio");
        set(p, "volume", 0);
        require(rms(render(p, rate)) < 1e-6, "Volume zero did not mute wet output");
        set(p, "volume", 100); set(p, "tone", 0);
        const auto first = render(p, rate);
        set(p, "tone", 100);
        const auto second = render(p, rate);
        double difference = 0;
        for (size_t i = first.size() / 2; i < first.size(); ++i)
            difference += std::abs(first[i] - second[i]);
        require(difference > 0.5, "Tone automation did not alter the fuzz");

        set(p, "bypass", 1); p.prepareToPlay(rate, 128);
        const auto dry = render(p, rate);
        const auto latency = p.getLatencySamples();
        require(latency > 0 && latency < 100, "Oversampling latency was not reported");
        for (size_t i = static_cast<size_t>(latency); i < dry.size(); ++i)
            require(std::abs(dry[i] - 0.1 * std::sin(2 * pi * 220 * (i - static_cast<size_t>(latency)) / rate))
                < 1e-6, "Bypass did not preserve latency-aligned dry audio");
    }
    VAFuzz66Processor original;
    set(original, "tone", 31); set(original, "volume", 63); set(original, "bypass", 1);
    juce::MemoryBlock state;
    original.getStateInformation(state);
    VAFuzz66Processor restored;
    restored.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
    require(std::abs(restored.apvts.getRawParameterValue("tone")->load() - 31) < 0.001f
        && std::abs(restored.apvts.getRawParameterValue("volume")->load() - 63) < 0.001f
        && restored.apvts.getRawParameterValue("bypass")->load() > 0.5f,
        "Saved tone, volume or bypass did not restore");
    VAFuzz66Processor mono;
    auto layout = mono.getBusesLayout();
    layout.inputBuses.getReference(0) = juce::AudioChannelSet::mono();
    layout.outputBuses.getReference(0) = juce::AudioChannelSet::mono();
    require(mono.setBusesLayout(layout), "Mono guitar input was rejected");
    mono.prepareToPlay(48000, 128);
    juce::AudioBuffer<float> odd(1, 1001);
    odd.clear(); odd.setSample(0, 0, 0.1f);
    juce::MidiBuffer midi;
    mono.processBlock(odd, midi);
    require(odd.getMagnitude(0, 1001) > 0, "Large mono block did not process");
    std::cout << "PASS: fuzz mono/stereo, silence, volume, tone automation, latency-aligned bypass, state, variable blocks at 44.1/48/96 kHz\n";
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
            juce::AudioPluginFormatManager formats;
            formats.addDefaultFormats();
            juce::OwnedArray<juce::PluginDescription> descriptions;
            for (auto* format : formats.getFormats())
                if (format->getName() == "VST3") format->findAllTypesForFile(descriptions, bundle.getFullPathName());
            require(descriptions.size() == 1, "Fuzz 66 VST3 did not scan");
            juce::String error;
            auto plugin = formats.createPluginInstance(*descriptions[0], 48000, 128, error);
            require(plugin != nullptr, ("Fuzz 66 VST3 load failed: " + error).toRawUTF8());
            plugin->prepareToPlay(48000, 128);
            require(rms(render(*plugin, 48000)) > 0.001, "Loaded VST3 did not process audio");
            plugin->releaseResources();
            std::cout << "PASS: actual VA Fuzz 66 VST3 scan, host load and processed audio\n";
        }
        if (argc > 2)
        {
            VAFuzz66Processor p;
            std::unique_ptr<juce::AudioProcessorEditor> editor(p.createEditor());
            const auto image = editor->createComponentSnapshot(editor->getLocalBounds());
            const auto file = juce::File(juce::String::fromUTF8(argv[2]));
            auto stream = file.createOutputStream();
            require(stream != nullptr, "Could not write editor preview");
            juce::PNGImageFormat png;
            require(png.writeImageToStream(image, *stream), "Editor snapshot failed");
            std::cout << "PASS: native fuzz pedal editor rendered\n";
        }
        return 0;
    }
    catch (const std::exception& error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; }
}
