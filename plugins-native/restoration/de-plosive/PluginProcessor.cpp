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

VADePlosiveProcessor::VADePlosiveProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VADePlosiveProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR xoverRange(60.0f, 300.0f); xoverRange.setSkewForCentre(120.0f);
    NR relRange(20.0f, 500.0f);   relRange.setSkewForCentre(100.0f);
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"sensitivity", 1},"Sensitivity", 0.0f, 1.0f,   0.5f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"crossover",   1},"Crossover",   xoverRange,   120.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"attenuation", 1},"Attenuation", 0.0f, 1.0f,   0.7f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"release",     1},"Release",     relRange,     80.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",         1},"Mix",         0.0f, 1.0f,   1.0f));
    return layout;
}

void VADePlosiveProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mLpStateL = mLpStateR = 0.0f;
    mLpEnvL = mLpEnvR = mHpEnvL = mHpEnvR = 0.0f;
    mGainZL = mGainZR = 1.0f;
    mLastCrossover = -1.0f;
}

void VADePlosiveProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float sensitivity = Virgo::clamp01(*apvts.getRawParameterValue("sensitivity"));
    const float crossover   = *apvts.getRawParameterValue("crossover");
    const float attenuation = Virgo::clamp01(*apvts.getRawParameterValue("attenuation"));
    const float releaseMs   = *apvts.getRawParameterValue("release");
    const float mix         = Virgo::clamp01(*apvts.getRawParameterValue("mix"));

    // First-order LP coefficient
    const float w  = 2.0f * Virgo::kPi * crossover / sr;
    const float lpC = 1.0f - std::exp(-w);

    const float atkC  = Virgo::envCoef(3.0f, sr);
    const float relC  = Virgo::envCoef(releaseMs, sr);
    const float gainC = Virgo::envCoef(releaseMs * 0.6f, sr);

    // Ratio LP:HP that constitutes a plosive
    const float plosiveThresh = 2.0f + (1.0f - sensitivity) * 8.0f;

    const float minGain = 1.0f - attenuation;

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];

        // First-order IIR LP/HP split
        mLpStateL += lpC * (l - mLpStateL);
        mLpStateR += lpC * (r - mLpStateR);
        const float lpL = mLpStateL, hpL = l - lpL;
        const float lpR = mLpStateR, hpR = r - lpR;

        // Envelope followers
        mLpEnvL = (std::abs(lpL) > mLpEnvL) ? atkC * mLpEnvL + (1.0f - atkC) * std::abs(lpL)
                                             : relC * mLpEnvL + (1.0f - relC) * std::abs(lpL);
        mHpEnvL = (std::abs(hpL) > mHpEnvL) ? atkC * mHpEnvL + (1.0f - atkC) * std::abs(hpL)
                                             : relC * mHpEnvL + (1.0f - relC) * std::abs(hpL);
        mLpEnvR = (std::abs(lpR) > mLpEnvR) ? atkC * mLpEnvR + (1.0f - atkC) * std::abs(lpR)
                                             : relC * mLpEnvR + (1.0f - relC) * std::abs(lpR);
        mHpEnvR = (std::abs(hpR) > mHpEnvR) ? atkC * mHpEnvR + (1.0f - atkC) * std::abs(hpR)
                                             : relC * mHpEnvR + (1.0f - relC) * std::abs(hpR);

        // Plosive detection: LP energy >> HP energy
        const float ratioL = (mHpEnvL > 1e-6f) ? mLpEnvL / mHpEnvL : 1.0f;
        const float ratioR = (mHpEnvR > 1e-6f) ? mLpEnvR / mHpEnvR : 1.0f;
        const bool plosL = ratioL > plosiveThresh && mLpEnvL > 5e-4f;
        const bool plosR = ratioR > plosiveThresh && mLpEnvR > 5e-4f;

        const float tgtL = plosL ? minGain : 1.0f;
        const float tgtR = plosR ? minGain : 1.0f;
        mGainZL = (tgtL < mGainZL) ? atkC  * mGainZL + (1.0f - atkC)  * tgtL
                                    : gainC * mGainZL + (1.0f - gainC) * tgtL;
        mGainZR = (tgtR < mGainZR) ? atkC  * mGainZR + (1.0f - atkC)  * tgtR
                                    : gainC * mGainZR + (1.0f - gainC) * tgtR;

        outL[i] = l * (1.0f - mix) + l * mGainZL * mix;
        outR[i] = r * (1.0f - mix) + r * mGainZR * mix;
    }
}

juce::AudioProcessorEditor* VADePlosiveProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA De-plosive"); }

void VADePlosiveProcessor::initPresets()
{
    mPresets = {
        {"Vocal Plosive",    {{"sensitivity",0.55f},{"crossover",120},{"attenuation",0.75f},{"release",80},{"mix",1}}},
        {"Heavy P/B Fix",    {{"sensitivity",0.75f},{"crossover",150},{"attenuation",0.9f}, {"release",60},{"mix",1}}},
        {"Broadcast Safe",   {{"sensitivity",0.6f}, {"crossover",100},{"attenuation",0.65f},{"release",100},{"mix",1}}},
        {"Subtle Control",   {{"sensitivity",0.35f},{"crossover",120},{"attenuation",0.45f},{"release",120},{"mix",0.8f}}},
        {"Dialogue Clean",   {{"sensitivity",0.65f},{"crossover",130},{"attenuation",0.7f}, {"release",70},{"mix",1}}},
        {"Max Restore",      {{"sensitivity",0.85f},{"crossover",160},{"attenuation",1.0f}, {"release",50},{"mix",1}}},
    };
}
void VADePlosiveProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VADePlosiveProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VADePlosiveProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VADePlosiveProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VADePlosiveProcessor(); }
