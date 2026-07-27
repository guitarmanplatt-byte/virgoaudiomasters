#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "VirgoHelpers.h"
#include <vector>

/**
 * VA Vintage Tape — classic open-reel tape emulation.
 *
 * DSP mirrors the web AudioWorklet kernel:
 *   • Soft tape saturation (algebraic sigmoid)
 *   • Head-bump low-shelf biquad
 *   • HF rolloff lowpass biquad
 *   • Wow & flutter via interpolated circular delay buffer
 *   • Dry/wet mix + output trim
 */
class VAVintageTapeProcessor : public juce::AudioProcessor
{
public:
    VAVintageTapeProcessor();
    ~VAVintageTapeProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "VA Vintage Tape"; }
    bool acceptsMidi()  const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.006; } // 6ms max delay

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
    int    mCurrentProgram = 0;

    // Head-bump (low shelf) and HF rolloff (lowpass) — one per channel
    Virgo::StereoBiquad mBump, mRolloff;
    float mLastBumpFreq  = -1.0f;
    float mLastBumpGain  = -9999.0f;
    float mLastRolloff   = -1.0f;

    // Wow/flutter: circular delay buffer
    static constexpr float kMaxDelayMs = 6.0f;
    std::vector<float> mBufL, mBufR;
    int mWritePos = 0;

    // LFO phases
    float mWowPhase      = 0.0f;
    float mFlutterPhase  = 0.0f;
    float mFlutterPhase2 = 1.7f;

    struct Preset { juce::String name; std::map<juce::String, float> params; };
    std::vector<Preset> mPresets;
    void initPresets();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VAVintageTapeProcessor)
};
