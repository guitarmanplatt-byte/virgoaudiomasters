#include "PluginProcessor.h"
#include "VirgoGenericEditor.h"

namespace {
    void applyPreset(juce::AudioProcessorValueTreeState& apvts, const std::map<juce::String, float>& p) {
        for (auto& [id, val] : p) if (auto* pr = apvts.getParameter(id)) pr->setValueNotifyingHost(pr->convertTo0to1(val));
    }
    void saveState(juce::AudioProcessorValueTreeState& apvts, juce::MemoryBlock& dest) {
        auto state = apvts.copyState(); if (auto xml = state.createXml()) juce::AudioProcessor::copyXmlToBinary(*xml, dest);
    }
    void loadState(juce::AudioProcessorValueTreeState& apvts, const void* data, int size) {
        if (auto xml = juce::AudioProcessor::getXmlFromBinary(data, size))
            if (xml->hasTagName(apvts.state.getType())) apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }
}

VADeNoiseProcessor::VADeNoiseProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VADeNoiseProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR relRange(50.0f, 2000.0f); relRange.setSkewForCentre(200.0f);
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"threshold",1},"Threshold",  0.0f, 1.0f,  0.5f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"reduction", 1},"Reduction",  0.0f, 1.0f,  0.8f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"release",   1},"Release",    relRange,    200.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"learn",     1},"Learn",      0.0f, 1.0f,  0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",       1},"Mix",        0.0f, 1.0f,  1.0f));
    return layout;
}

void VADeNoiseProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    std::memset(mLpState,    0, sizeof(mLpState));
    std::memset(mBandEnv,    0, sizeof(mBandEnv));
    std::memset(mNoiseFloor, 0, sizeof(mNoiseFloor));

    // Pre-compute first-order LP coefficients per crossover
    for (int x = 0; x < 3; ++x) {
        const float w  = 2.0f * Virgo::kPi * kCross[x] / (float)sampleRate;
        mLpCoef[x] = 1.0f - std::exp(-w);
    }
}

void VADeNoiseProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float thresh    = Virgo::clamp01(*apvts.getRawParameterValue("threshold"));
    const float reduction = Virgo::clamp01(*apvts.getRawParameterValue("reduction"));
    const float releaseMs = *apvts.getRawParameterValue("release");
    const float learn     = *apvts.getRawParameterValue("learn") > 0.5f ? 1.0f : 0.0f;
    const float mix       = Virgo::clamp01(*apvts.getRawParameterValue("mix"));

    const float relC  = Virgo::envCoef(releaseMs, sr);
    const float atkC  = Virgo::envCoef(5.0f, sr);
    const float learnC= Virgo::envCoef(800.0f, sr);   // slow floor update
    const float gateFloor = 1.0f - reduction;

    // Band gain factor: above thresh → 1.0, below → gateFloor
    // Gain follows band envelope vs per-band adaptive noise floor
    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];

        // LP crossover bank (per channel)
        // Band 0 = [0, 250], 1 = [250, 1k], 2 = [1k, 4k], 3 = [4k+]
        float bandsL[kBands], bandsR[kBands];

        // LP 0: 250 Hz
        float lp0L = mLpState[0][0][0] + mLpCoef[0] * (l - mLpState[0][0][0]);
        float lp0R = mLpState[1][0][0] + mLpCoef[0] * (r - mLpState[1][0][0]);
        float hp0L = l - lp0L, hp0R = r - lp0R;
        mLpState[0][0][0] = lp0L; mLpState[1][0][0] = lp0R;
        // second pole for steeper rolloff
        lp0L = mLpState[0][0][1] + mLpCoef[0] * (lp0L - mLpState[0][0][1]);
        lp0R = mLpState[1][0][1] + mLpCoef[0] * (lp0R - mLpState[1][0][1]);
        mLpState[0][0][1] = lp0L; mLpState[1][0][1] = lp0R;
        bandsL[0] = lp0L; bandsR[0] = lp0R;

        // LP 1: 1kHz
        float lp1L = mLpState[0][1][0] + mLpCoef[1] * (hp0L - mLpState[0][1][0]);
        float lp1R = mLpState[1][1][0] + mLpCoef[1] * (hp0R - mLpState[1][1][0]);
        float hp1L = hp0L - lp1L, hp1R = hp0R - lp1R;
        mLpState[0][1][0] = lp1L; mLpState[1][1][0] = lp1R;
        lp1L = mLpState[0][1][1] + mLpCoef[1] * (lp1L - mLpState[0][1][1]);
        lp1R = mLpState[1][1][1] + mLpCoef[1] * (lp1R - mLpState[1][1][1]);
        mLpState[0][1][1] = lp1L; mLpState[1][1][1] = lp1R;
        bandsL[1] = lp1L; bandsR[1] = lp1R;

        // LP 2: 4kHz
        float lp2L = mLpState[0][2][0] + mLpCoef[2] * (hp1L - mLpState[0][2][0]);
        float lp2R = mLpState[1][2][0] + mLpCoef[2] * (hp1R - mLpState[1][2][0]);
        mLpState[0][2][0] = lp2L; mLpState[1][2][0] = lp2R;
        lp2L = mLpState[0][2][1] + mLpCoef[2] * (lp2L - mLpState[0][2][1]);
        lp2R = mLpState[1][2][1] + mLpCoef[2] * (lp2R - mLpState[1][2][1]);
        mLpState[0][2][1] = lp2L; mLpState[1][2][1] = lp2R;
        bandsL[2] = lp2L; bandsR[2] = lp2R;
        bandsL[3] = hp1L - lp2L; bandsR[3] = hp1R - lp2R;

        // Per-band gate
        float outL_s = 0.0f, outR_s = 0.0f;
        for (int b = 0; b < kBands; ++b) {
            const float bl = bandsL[b], br = bandsR[b];
            const float mag = (std::abs(bl) + std::abs(br)) * 0.5f;
            const float coef = (mag > mBandEnv[0][b]) ? atkC : relC;
            mBandEnv[0][b] = coef * mBandEnv[0][b] + (1.0f - coef) * mag;
            mBandEnv[1][b] = mBandEnv[0][b];

            // Adaptive noise floor
            if (learn > 0.5f || mag < mNoiseFloor[0][b] * 1.5f) {
                mNoiseFloor[0][b] = learnC * mNoiseFloor[0][b] + (1.0f - learnC) * mag;
                mNoiseFloor[1][b] = mNoiseFloor[0][b];
            }

            const float floor = mNoiseFloor[0][b] * (1.0f + thresh * 4.0f);
            const float above = (mBandEnv[0][b] > 1e-6f) ? mBandEnv[0][b] / std::max(1e-6f, floor) : 1.0f;
            const float gateG = std::min(1.0f, above * above);
            const float g     = gateFloor + (1.0f - gateFloor) * gateG;
            outL_s += bl * g;
            outR_s += br * g;
        }

        outL[i] = l * (1.0f - mix) + outL_s * mix;
        outR[i] = r * (1.0f - mix) + outR_s * mix;
    }
}

juce::AudioProcessorEditor* VADeNoiseProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA De-noise"); }

void VADeNoiseProcessor::initPresets()
{
    mPresets = {
        {"Light NR",          {{"threshold",0.35f},{"reduction",0.5f},{"release",150},{"learn",0},{"mix",1}}},
        {"Moderate NR",       {{"threshold",0.5f}, {"reduction",0.75f},{"release",200},{"learn",0},{"mix",1}}},
        {"Heavy NR",          {{"threshold",0.7f}, {"reduction",0.95f},{"release",300},{"learn",0},{"mix",1}}},
        {"Vinyl Hiss",        {{"threshold",0.55f},{"reduction",0.8f}, {"release",180},{"learn",0},{"mix",1}}},
        {"Tape Hiss",         {{"threshold",0.45f},{"reduction",0.65f},{"release",220},{"learn",0},{"mix",0.9f}}},
        {"Broadcast Safe",    {{"threshold",0.4f}, {"reduction",0.6f}, {"release",120},{"learn",0},{"mix",0.8f}}},
        {"Learn + Apply",     {{"threshold",0.5f}, {"reduction",0.8f}, {"release",200},{"learn",1},{"mix",1}}},
    };
}
void VADeNoiseProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VADeNoiseProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VADeNoiseProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VADeNoiseProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VADeNoiseProcessor(); }
