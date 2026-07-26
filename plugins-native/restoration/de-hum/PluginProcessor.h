#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "VirgoHelpers.h"
#include <array>

class VADeHumProcessor : public juce::AudioProcessor
{
public:
    static constexpr int kMaxHarmonics = 5;

    VADeHumProcessor();
    ~VADeHumProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "VA De-hum"; }
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

    // One stereo biquad notch per harmonic, updated when params change
    std::array<Virgo::StereoBiquad, kMaxHarmonics> mNotches;
    float mCachedF0 = -1.0f, mCachedQ = -1.0f;
    int   mCachedHarmonics = -1;
    int   mActiveNotches = 0;

    struct Preset { juce::String name; std::map<juce::String, float> params; };
    std::vector<Preset> mPresets;
    void initPresets();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VADeHumProcessor)
};
