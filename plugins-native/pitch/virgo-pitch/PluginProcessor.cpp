#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace
{
juce::AudioProcessorValueTreeState::ParameterLayout layout()
{
    using Float = juce::AudioParameterFloat;
    using Choice = juce::AudioParameterChoice;
    using Bool = juce::AudioParameterBool;
    juce::AudioProcessorValueTreeState::ParameterLayout result;
    result.add(std::make_unique<Choice>("root", "Key root",
        juce::StringArray{"C", "C# / Db", "D", "D# / Eb", "E", "F", "F# / Gb", "G", "G# / Ab", "A", "A# / Bb", "B"}, 0));
    result.add(std::make_unique<Choice>("scale", "Scale",
        juce::StringArray{"Major", "Natural minor", "Harmonic minor", "Melodic minor (ascending)", "Chromatic"}, 0));
    result.add(std::make_unique<Float>("amount", "Correction strength", 0, 100, 85));
    result.add(std::make_unique<Float>("speed", "Correction response (ms)", juce::NormalisableRange<float>(10, 600, 1, 0.5f), 120));
    result.add(std::make_unique<Float>("tolerance", "Natural pitch tolerance (cents)", 0, 50, 12));
    result.add(std::make_unique<Float>("maximum", "Maximum correction (cents)", 0, 200, 100));
    result.add(std::make_unique<Bool>("transients", "Preserve transients", true));
    result.add(std::make_unique<Bool>("formants", "Preserve spectral envelope", true));
    for (int voice = 1; voice <= 2; ++voice)
    {
        const auto prefix = "voice" + juce::String(voice);
        result.add(std::make_unique<Bool>(prefix + "on", "Harmony " + juce::String(voice), false));
        result.add(std::make_unique<Choice>(prefix + "interval", "Harmony " + juce::String(voice) + " interval",
                                           VirgoPitchProcessor::intervalNames(), voice == 1 ? 15 : 3));
        result.add(std::make_unique<Float>(prefix + "level", "Harmony " + juce::String(voice) + " level (dB)", -60, 0, voice == 1 ? -12 : -15));
    }
    result.add(std::make_unique<Float>("mix", "Wet mix", 0, 100, 100));
    result.add(std::make_unique<Float>("output", "Output (dB)", -24, 12, 0));
    result.add(std::make_unique<Bool>("bypass", "Bypass", false));
    return result;
}
}
juce::StringArray VirgoPitchProcessor::intervalNames()
{
    return {"-24 / two octaves down", "-19 / octave + fifth down", "-13 / minor ninth down",
        "-12 / octave down", "-11 / major seventh down", "-7 / fifth down", "-6 / tritone down",
        "-2 / whole step down", "-1 / semitone down", "0 / unison", "+1 / semitone up",
        "+2 / whole step up", "+6 / tritone up", "+7 / fifth up", "+11 / major seventh up",
        "+12 / octave up", "+13 / minor ninth up", "+19 / octave + fifth up", "+24 / two octaves up"};
}
VirgoPitchProcessor::VirgoPitchProcessor()
    : AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true)
                                      .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "VirgoPitchState", layout()) {}
void VirgoPitchProcessor::prepareToPlay(double rate, int)
{
    engine.prepare(rate);
    for (auto& channel : dryDelay) channel.assign(static_cast<size_t>(engine.latency()), 0);
    dryPosition = 0;
    setLatencySamples(engine.latency());
    mix.reset(rate, 0.03); outputGain.reset(rate, 0.03); bypassMix.reset(rate, 0.02);
    mix.setCurrentAndTargetValue(apvts.getRawParameterValue("mix")->load() * 0.01f);
    outputGain.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(apvts.getRawParameterValue("output")->load()));
    bypassMix.setCurrentAndTargetValue(apvts.getRawParameterValue("bypass")->load() > 0.5f ? 0.0f : 1.0f);
    inputMeter.store(0); outputMeter.store(0); confidence.store(0); activity.store(0);
    prepared = true;
}
bool VirgoPitchProcessor::isBusesLayoutSupported(const BusesLayout& buses) const
{
    return buses.getMainInputChannelSet() == buses.getMainOutputChannelSet()
        && (buses.getMainOutputChannelSet() == juce::AudioChannelSet::mono()
            || buses.getMainOutputChannelSet() == juce::AudioChannelSet::stereo());
}
void VirgoPitchProcessor::processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer&)
{ process(audio, false); }
void VirgoPitchProcessor::processBlockBypassed(juce::AudioBuffer<float>& audio, juce::MidiBuffer&)
{ process(audio, true); }
void VirgoPitchProcessor::process(juce::AudioBuffer<float>& audio, bool hostBypass)
{
    juce::ScopedNoDenormals noDenormals;
    if (!prepared) { audio.clear(); return; }
    const auto value = [this](const char* id) { return apvts.getRawParameterValue(id)->load(); };
    VirgoPitch::Settings settings;
    settings.root = static_cast<int>(value("root")); settings.scale = static_cast<int>(value("scale"));
    settings.amount = value("amount") * 0.01f; settings.responseMs = value("speed");
    settings.toleranceCents = value("tolerance"); settings.maximumCents = value("maximum");
    settings.preserveTransients = value("transients") > 0.5f;
    settings.preserveFormants = value("formants") > 0.5f;
    settings.interval[0] = intervals[static_cast<size_t>(juce::jlimit(0, 18, static_cast<int>(value("voice1interval"))))];
    settings.interval[1] = intervals[static_cast<size_t>(juce::jlimit(0, 18, static_cast<int>(value("voice2interval"))))];
    settings.harmonyGain[0] = value("voice1on") > 0.5f ? juce::Decibels::decibelsToGain(value("voice1level")) : 0;
    settings.harmonyGain[1] = value("voice2on") > 0.5f ? juce::Decibels::decibelsToGain(value("voice2level")) : 0;
    mix.setTargetValue(value("mix") * 0.01f);
    outputGain.setTargetValue(juce::Decibels::decibelsToGain(value("output")));
    bypassMix.setTargetValue(hostBypass || value("bypass") > 0.5f ? 0.0f : 1.0f);
    float inPeak = 0, outPeak = 0;
    for (int i = 0; i < audio.getNumSamples(); ++i)
    {
        std::array<float, 2> input {}, dry {};
        for (int channel = 0; channel < std::min(2, audio.getNumChannels()); ++channel)
        {
            auto sample = audio.getSample(channel, i);
            if (!std::isfinite(sample)) sample = 0;
            input[static_cast<size_t>(channel)] = juce::jlimit(-8.0f, 8.0f, sample);
            inPeak = std::max(inPeak, std::abs(sample));
        }
        const auto wet = engine.process(input[0], input[1], settings);
        const float blend = mix.getNextValue(), gain = outputGain.getNextValue(), enabled = bypassMix.getNextValue();
        for (int channel = 0; channel < std::min(2, audio.getNumChannels()); ++channel)
        {
            dry[static_cast<size_t>(channel)] = dryDelay[channel][dryPosition];
            dryDelay[channel][dryPosition] = input[static_cast<size_t>(channel)];
            const float processed = (wet[static_cast<size_t>(channel)] * blend + dry[static_cast<size_t>(channel)] * (1 - blend)) * gain;
            float result = dry[static_cast<size_t>(channel)] * (1 - enabled) + processed * enabled;
            if (!std::isfinite(result)) result = 0;
            audio.setSample(channel, i, result);
            outPeak = std::max(outPeak, std::abs(result));
        }
        dryPosition = (dryPosition + 1) % dryDelay[0].size();
    }
    for (int channel = 2; channel < audio.getNumChannels(); ++channel) audio.clear(channel, 0, audio.getNumSamples());
    inputMeter.store(std::max(inPeak, inputMeter.load() * 0.93f));
    outputMeter.store(std::max(outPeak, outputMeter.load() * 0.93f));
    confidence.store(engine.confidence()); activity.store(engine.activity());
}
void VirgoPitchProcessor::getStateInformation(juce::MemoryBlock& data)
{
    if (auto xml = apvts.copyState().createXml()) copyXmlToBinary(*xml, data);
}
void VirgoPitchProcessor::setStateInformation(const void* data, int size)
{
    if (auto xml = getXmlFromBinary(data, size))
        if (xml->hasTagName(apvts.state.getType())) apvts.replaceState(juce::ValueTree::fromXml(*xml));
}
juce::AudioProcessorEditor* VirgoPitchProcessor::createEditor() { return new VirgoPitchEditor(*this); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VirgoPitchProcessor(); }
