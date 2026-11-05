#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include "PitchEngine.h"

class VirgoPitchProcessor final : public juce::AudioProcessor
{
public:
    VirgoPitchProcessor();
    void prepareToPlay(double, int) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void processBlockBypassed(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorParameter* getBypassParameter() const override { return apvts.getParameter("bypass"); }
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "Virgo Pitch"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.75; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Natural Polyphonic"; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;
    juce::AudioProcessorValueTreeState apvts;
    std::atomic<float> inputMeter {0}, outputMeter {0}, confidence {0}, activity {0};
    static juce::StringArray intervalNames();
    static constexpr std::array<int, 19> intervals {-24, -19, -13, -12, -11, -7, -6, -2, -1, 0, 1, 2, 6, 7, 11, 12, 13, 19, 24};
private:
    void process(juce::AudioBuffer<float>&, bool hostBypass);
    VirgoPitch::Engine engine;
    std::array<std::vector<float>, 2> dryDelay;
    size_t dryPosition = 0;
    bool prepared = false;
    juce::SmoothedValue<float> mix, outputGain, bypassMix;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VirgoPitchProcessor)
};
