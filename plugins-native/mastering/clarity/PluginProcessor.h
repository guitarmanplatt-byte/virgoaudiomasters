#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "VirgoHelpers.h"

class VAClarityProcessor : public juce::AudioProcessor
{
public:
    VAClarityProcessor();
    ~VAClarityProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "VA Clarity"; }
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

    Virgo::StereoBiquad mHpDet;    // detection highpass
    Virgo::StereoBiquad mShelf;    // applied high shelf
    float mLastFreq     = -1.0f;
    float mLastShelfDb  = 1e9f;
    float mFullEnv      = 0.0f;
    float mHighEnv      = 0.0f;
    float mLift         = 0.0f;    // smoothed applied shelf lift in dB

    struct Preset { juce::String name; std::map<juce::String, float> params; };
    std::vector<Preset> mPresets;
    void initPresets();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VAClarityProcessor)
};
