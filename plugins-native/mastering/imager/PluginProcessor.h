#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "VirgoHelpers.h"
#include <vector>

class VAImagerProcessor : public juce::AudioProcessor
{
public:
    VAImagerProcessor();
    ~VAImagerProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "VA Imager"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.009; } // Haas delay
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

    Virgo::StereoBiquad mLpA, mLpB, mHpA, mHpB;
    float mLastXLow = -1.0f, mLastXHigh = -1.0f;

    // Haas delay for stereoize (~9 ms)
    std::vector<float> mHaasDelay;
    int mHaasWrite = 0;

    struct Preset { juce::String name; std::map<juce::String, float> params; };
    std::vector<Preset> mPresets;
    void initPresets();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VAImagerProcessor)
};
