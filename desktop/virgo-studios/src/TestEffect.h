#pragma once
#include "PluginChain.h"
#include <limits>

namespace studio
{
// Deterministic processor used only by --self-test, without external binaries.
class TestDelayEffect final : public juce::AudioPluginInstance
{
public:
    explicit TestDelayEffect(bool invalid = false, int delaySamples = 3)
        : emitInvalid(invalid), history(static_cast<size_t>(std::max(1, delaySamples)))
    {
        setPlayConfigDetails(2, 2, 48000, 128);
        setLatencySamples(static_cast<int>(history.size()));
        prepareToPlay(48000, 128);
    }
    const juce::String getName() const override { return "Timing fixture"; }
    void fillInPluginDescription(juce::PluginDescription& value) const override { value.name = getName(); }
    void prepareToPlay(double, int) override { reset(); }
    void releaseResources() override {}
    void reset() override { for (auto& sample : history) sample = {0, 0}; cursor = 0; }
    void processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer&) override
    {
        for (int i = 0; i < audio.getNumSamples(); ++i)
        {
            auto& previous = history[static_cast<size_t>(cursor)];
            const auto input = std::array<float, 2> {audio.getSample(0, i), audio.getSample(1, i)};
            audio.setSample(0, i, emitInvalid ? std::numeric_limits<float>::quiet_NaN() : previous[0]);
            audio.setSample(1, i, previous[1]);
            previous = input; cursor = (cursor + 1) % static_cast<int>(history.size());
        }
    }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0; }
    bool hasEditor() const override { return false; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override {}
    void setStateInformation(const void*, int) override {}
private:
    bool emitInvalid = false;
    int cursor = 0;
    std::vector<std::array<float, 2>> history;
};
}
