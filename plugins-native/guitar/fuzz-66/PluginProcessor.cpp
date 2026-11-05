#include "PluginProcessor.h"
#include "PluginEditor.h"

VAFuzz66Processor::VAFuzz66Processor()
    : AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true)
                                     .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "VAFuzz66", {
          std::make_unique<juce::AudioParameterFloat>(juce::ParameterID("tone", 1), "Tone",
              juce::NormalisableRange<float>(0, 100, 0.01f), 75),
          std::make_unique<juce::AudioParameterFloat>(juce::ParameterID("volume", 1), "Volume",
              juce::NormalisableRange<float>(0, 100, 0.01f), 70),
          std::make_unique<juce::AudioParameterBool>(juce::ParameterID("bypass", 1), "Bypass", false)
      })
{}

bool VAFuzz66Processor::isBusesLayoutSupported(const BusesLayout& layout) const
{
    return (layout.getMainInputChannelSet() == juce::AudioChannelSet::mono()
        || layout.getMainInputChannelSet() == juce::AudioChannelSet::stereo())
        && layout.getMainInputChannelSet() == layout.getMainOutputChannelSet();
}

void VAFuzz66Processor::prepareToPlay(double rate, int blockSize)
{
    chunkSize = std::max(1, blockSize);
    const auto channels = static_cast<size_t>(getTotalNumInputChannels());
    oversampling = std::make_unique<juce::dsp::Oversampling<float>>(
        channels, 2, juce::dsp::Oversampling<float>::filterHalfBandPolyphaseIIR, true, true);
    oversampling->initProcessing(static_cast<size_t>(chunkSize));
    oversampling->reset();
    latency = static_cast<int>(std::round(oversampling->getLatencyInSamples()));
    setLatencySamples(latency);
    for (auto& samples : delay) samples.assign(static_cast<size_t>(std::max(1, latency)), 0);
    cursor = 0;
    dry.setSize(static_cast<int>(channels), chunkSize);
    const auto t = apvts.getRawParameterValue("tone")->load() / 100;
    for (auto& circuit : circuits) circuit.prepare(rate * 4, t);
    tone.reset(rate * 4, 0.02); tone.setCurrentAndTargetValue(t);
    volume.reset(rate, 0.02);
    volume.setCurrentAndTargetValue(apvts.getRawParameterValue("volume")->load() / 100);
    wetMix.reset(rate, 0.01);
    wetMix.setCurrentAndTargetValue(apvts.getRawParameterValue("bypass")->load() > 0.5f ? 0.0f : 1.0f);
}
void VAFuzz66Processor::processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer&)
{
    process(audio, apvts.getRawParameterValue("bypass")->load() > 0.5f);
}
void VAFuzz66Processor::processBlockBypassed(juce::AudioBuffer<float>& audio, juce::MidiBuffer&)
{
    process(audio, true);
}
void VAFuzz66Processor::process(juce::AudioBuffer<float>& audio, bool bypassed)
{
    juce::ScopedNoDenormals noDenormals;
    if (!oversampling) { audio.clear(); return; }
    const int channels = std::min(2, getTotalNumInputChannels());
    for (int c = channels; c < audio.getNumChannels(); ++c) audio.clear(c, 0, audio.getNumSamples());
    tone.setTargetValue(apvts.getRawParameterValue("tone")->load() / 100);
    volume.setTargetValue(apvts.getRawParameterValue("volume")->load() / 100);
    wetMix.setTargetValue(bypassed ? 0.0f : 1.0f);
    for (int offset = 0; offset < audio.getNumSamples(); offset += chunkSize)
    {
        const int count = std::min(chunkSize, audio.getNumSamples() - offset);
        for (int c = 0; c < channels; ++c)
        {
            auto* samples = audio.getWritePointer(c, offset);
            for (int i = 0; i < count; ++i) if (!std::isfinite(samples[i])) samples[i] = 0;
            dry.copyFrom(c, 0, audio, c, offset, count);
        }
        auto block = juce::dsp::AudioBlock<float>(audio).getSubsetChannelBlock(0, static_cast<size_t>(channels))
            .getSubBlock(static_cast<size_t>(offset), static_cast<size_t>(count));
        auto up = oversampling->processSamplesUp(block);
        for (size_t i = 0; i < up.getNumSamples(); ++i)
        {
            const auto t = tone.getNextValue();
            for (int c = 0; c < channels; ++c)
                up.getChannelPointer(static_cast<size_t>(c))[i] =
                    circuits[static_cast<size_t>(c)].process(up.getChannelPointer(static_cast<size_t>(c))[i], t);
        }
        oversampling->processSamplesDown(block);
        for (int i = 0; i < count; ++i)
        {
            const float gain = volume.getNextValue(), mix = wetMix.getNextValue();
            for (int c = 0; c < channels; ++c)
            {
                const auto index = static_cast<size_t>(c);
                const auto input = dry.getSample(c, i);
                const auto delayed = latency > 0 ? delay[index][cursor] : input;
                delay[index][cursor] = input;
                const auto wet = std::clamp(audio.getSample(c, offset + i) * gain * gain, -1.0f, 1.0f);
                audio.setSample(c, offset + i, delayed * (1 - mix) + wet * mix);
            }
            cursor = (cursor + 1) % delay[0].size();
        }
    }
}
juce::AudioProcessorEditor* VAFuzz66Processor::createEditor() { return new VAFuzz66Editor(*this); }
void VAFuzz66Processor::getStateInformation(juce::MemoryBlock& destination)
{
    if (auto xml = apvts.copyState().createXml()) copyXmlToBinary(*xml, destination);
}
void VAFuzz66Processor::setStateInformation(const void* data, int size)
{
    if (auto xml = getXmlFromBinary(data, size))
        if (xml->hasTagName(apvts.state.getType())) apvts.replaceState(juce::ValueTree::fromXml(*xml));
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VAFuzz66Processor(); }
