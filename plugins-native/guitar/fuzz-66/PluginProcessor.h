#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include "FuzzCircuit.h"

class VAFuzz66Processor final : public juce::AudioProcessor
{
public:
    VAFuzz66Processor();
    void prepareToPlay(double, int) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void processBlockBypassed(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorParameter* getBypassParameter() const override { return apvts.getParameter("bypass"); }
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "VA Fuzz 66"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.05; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Silicon '68"; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;
    juce::AudioProcessorValueTreeState apvts;
private:
    void process(juce::AudioBuffer<float>&, bool bypassed);
    std::unique_ptr<juce::dsp::Oversampling<float>> oversampling;
    std::array<VirgoFuzz::Circuit, 2> circuits;
    juce::AudioBuffer<float> dry;
    std::array<std::vector<float>, 2> delay;
    size_t cursor = 0;
    int chunkSize = 512, latency = 0;
    juce::SmoothedValue<float> tone, volume, wetMix;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VAFuzz66Processor)
};
