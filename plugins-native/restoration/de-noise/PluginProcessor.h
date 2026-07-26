#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "VirgoHelpers.h"
#include <array>

class VADeNoiseProcessor : public juce::AudioProcessor
{
public:
    static constexpr int kBands = 4;

    VADeNoiseProcessor();
    ~VADeNoiseProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "VA De-noise"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return (int)mPresets.size(); }
    int getCurrentProgram() override { return mCurrentProgram; }
    void setCurrentProgram(int index) override;
    const juce::String getProgramName(int index) override;
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState apvts;
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

private:
    double mSampleRate = 44100.0;
    int mCurrentProgram = 0;

    // 3 crossover LP filters (first-order cascaded × 2)
    // Per-channel state: [ch][xover] -> lp1, lp2
    float mLpState[2][3][2] = {};   // [ch][xover][pole]

    // Per-channel, per-band envelope + noise floor
    float mBandEnv[2][kBands]        = {};
    float mNoiseFloor[2][kBands]     = {};

    // Crossover frequencies (Hz) — fixed to match browser plugin
    static constexpr float kCross[3] = { 250.0f, 1000.0f, 4000.0f };
    float mLpCoef[3] = {};  // first-order LP coefficient per crossover

    struct Preset { juce::String name; std::map<juce::String, float> params; };
    std::vector<Preset> mPresets;
    void initPresets();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VADeNoiseProcessor)
};
