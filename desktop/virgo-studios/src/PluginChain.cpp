#include "PluginChain.h"
#include <stdexcept>

namespace studio
{
PluginChain::~PluginChain()
{
    for (auto& entry : entries) entry.processor->removeListener(this);
}
juce::AudioPluginFormatManager& PluginChain::formats()
{
    static juce::AudioPluginFormatManager manager;
    static const bool added = [] { manager.addDefaultFormats(); return true; }();
    juce::ignoreUnused(added);
    return manager;
}

juce::String PluginChain::instantiate(const juce::PluginDescription& description,
    const juce::MemoryBlock& state, bool bypass, double rate)
{
    if (description.isInstrument) return "This rack accepts VST3 audio effects, not instruments.";
    juce::String error;
    auto processor = formats().createPluginInstance(description, rate, 128, error);
    if (!processor) return error.isNotEmpty() ? error : "Could not create plugin.";
    auto layout = processor->getBusesLayout();
    if (layout.inputBuses.isEmpty() || layout.outputBuses.isEmpty())
        return "The plugin has no audio input/output.";
    layout.inputBuses.getReference(0) = juce::AudioChannelSet::stereo();
    layout.outputBuses.getReference(0) = juce::AudioChannelSet::stereo();
    for (int i = 1; i < layout.inputBuses.size(); ++i) layout.inputBuses.getReference(i) = juce::AudioChannelSet::disabled();
    for (int i = 1; i < layout.outputBuses.size(); ++i) layout.outputBuses.getReference(i) = juce::AudioChannelSet::disabled();
    if (!processor->setBusesLayout(layout)) return "This preview requires a stereo-compatible audio effect.";
    processor->setRateAndBufferSizeDetails(rate, 128);
    if (state.getSize() > 0) processor->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
    processor->prepareToPlay(rate, 128);
    if (processor->getLatencySamples() > static_cast<int>(rate * 2)
        || latency() + processor->getLatencySamples() > static_cast<int>(rate * 2))
        return "This preview supports up to two seconds of total plugin latency per track.";
    processor->addListener(this);
    entries.push_back({description, std::move(processor), bypass});
    currentRate = rate;
    return {};
}

juce::String PluginChain::add(const juce::File& file, double rate)
{
    if (entries.size() >= 8) return "A track supports up to eight effects in this preview.";
    juce::OwnedArray<juce::PluginDescription> found;
    for (auto* format : formats().getFormats())
        if (format->getName() == "VST3") format->findAllTypesForFile(found, file.getFullPathName());
    if (found.isEmpty()) return "No compatible 64-bit VST3 effect found in this file.";
    return instantiate(*found[0], {}, false, rate);
}

juce::var PluginChain::save() const
{
    juce::Array<juce::var> list;
    for (const auto& entry : entries)
    {
        const juce::ScopedLock lock(entry.processor->getCallbackLock());
        auto* value = new juce::DynamicObject();
        juce::MemoryBlock state;
        entry.processor->getStateInformation(state);
        value->setProperty("description", entry.description.createXml()->toString());
        value->setProperty("state", state.toBase64Encoding());
        value->setProperty("bypass", entry.bypass);
        list.add(juce::var(value));
    }
    return juce::var(list);
}

juce::String PluginChain::restore(const juce::var& data, double rate)
{
    if (data.isVoid()) return {};
    if (!data.isArray() || data.size() > 8) return "Invalid plugin rack in project.";
    for (int i = 0; i < data.size(); ++i)
    {
        auto xml = juce::parseXML(data[i]["description"].toString());
        juce::PluginDescription description;
        juce::MemoryBlock state;
        if (!xml || !description.loadFromXml(*xml)
            || !state.fromBase64Encoding(data[i]["state"].toString())
            || state.getSize() > 16 * 1024 * 1024)
            return "Invalid plugin description or state.";
        auto error = instantiate(description, state, static_cast<bool>(data[i]["bypass"]), rate);
        if (error.isNotEmpty()) return description.name + ": " + error;
    }
    return {};
}

std::shared_ptr<PluginChain> PluginChain::clone(double rate) const
{
    auto result = std::make_shared<PluginChain>();
    auto error = result->restore(save(), rate);
    if (error.isNotEmpty()) throw std::runtime_error(error.toStdString());
    return result;
}

void PluginChain::prepare(double rate)
{
    for (auto& entry : entries)
    {
        if (currentRate != rate)
        {
            entry.processor->releaseResources();
            entry.processor->setRateAndBufferSizeDetails(rate, 128);
            entry.processor->prepareToPlay(rate, 128);
        }
        entry.processor->reset();
    }
    currentRate = rate;
}

int PluginChain::latency() const
{
    int total = 0;
    for (const auto& entry : entries)
        if (!entry.bypass) total += std::max(0, entry.processor->getLatencySamples());
    return total;
}

bool PluginChain::process(juce::AudioBuffer<float>& buffer, double seconds)
{
    juce::ignoreUnused(seconds);
    juce::MidiBuffer midi;
    for (auto& entry : entries)
        if (!entry.bypass)
        {
            const juce::ScopedLock lock(entry.processor->getCallbackLock());
            entry.processor->processBlock(buffer, midi);
            // Third-party effects must not send NaN/Inf to hardware or disk.
            for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
                for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
                    if (!std::isfinite(buffer.getSample(channel, sample)))
                    { buffer.clear(); return false; }
            midi.clear();
        }
    return true;
}
}
