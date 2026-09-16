#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "VirgoHelpers.h"

#include <atomic>
#include <map>
#include <vector>

/**
 * VA Silver Opto
 *
 * An original opto/tube compressor inspired by classic 1960s leveling
 * amplifiers. It deliberately uses Virgo branding and artwork rather than
 * copying any third-party product name or trade dress.
 *
 * The detector combines a fast optical response with a slow memory path:
 * roughly 10 ms attack, a 60 ms first release, and a program-dependent
 * long release tail. A restrained nonlinear output stage adds the soft,
 * slightly asymmetric character expected from a tube/transformer path.
 */
class VASilverOptoProcessor : public juce::AudioProcessor
{
public:
    VASilverOptoProcessor();
    ~VASilverOptoProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "VA Silver Opto"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return static_cast<int>(mPresets.size()); }
    int getCurrentProgram() override { return mCurrentProgram; }
    void setCurrentProgram(int index) override;
    const juce::String getProgramName(int index) override;
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState apvts;
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    float getGainReductionDb() const noexcept { return mGainReductionDb.load(); }
    float getInputMeterDb() const noexcept { return mInputMeterDb.load(); }
    float getOutputMeterDb() const noexcept { return mOutputMeterDb.load(); }

private:
    double mSampleRate = 44100.0;
    int mCurrentProgram = 0;

    Virgo::StereoBiquad mDetectorFilter;
    float mFastEnvelope = 0.0f;
    float mSlowEnvelope = 0.0f;
    float mGainReduction = 0.0f;
    float mInputMeter = -80.0f;
    float mOutputMeter = -80.0f;

    std::atomic<float> mGainReductionDb { 0.0f };
    std::atomic<float> mInputMeterDb { -80.0f };
    std::atomic<float> mOutputMeterDb { -80.0f };

    struct Preset
    {
        juce::String name;
        std::map<juce::String, float> params;
    };
    std::vector<Preset> mPresets;
    void initPresets();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VASilverOptoProcessor)
};