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

VAClarityProcessor::VAClarityProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VAClarityProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR freqRange(2000.0f, 12000.0f); freqRange.setSkewForCentre(4500.0f);
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"amount",1},"Amount",    0.0f, 1.0f, 0.4f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"speed", 1},"Speed",     0.0f, 1.0f, 0.5f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"freq",  1},"Frequency", freqRange,  4500.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",   1},"Mix",       0.0f, 1.0f, 1.0f));
    return layout;
}

void VAClarityProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mHpDet.reset(); mShelf.reset();
    mLastFreq = -1.0f; mLastShelfDb = 1e9f;
    mFullEnv = mHighEnv = mLift = 0.0f;
}

void VAClarityProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float freq   = *apvts.getRawParameterValue("freq");
    const float amount = Virgo::clamp01(*apvts.getRawParameterValue("amount"));
    const float speed  = Virgo::clamp01(*apvts.getRawParameterValue("speed"));
    const float mix    = Virgo::clamp01(*apvts.getRawParameterValue("mix"));
    const float maxLift = amount * 9.0f;

    if (freq != mLastFreq) {
        mHpDet.c = Virgo::calcBiquad(Virgo::FType::HighPass, freq, 0.0f, 0.707f, sr);
        mLastFreq = freq;
        mLastShelfDb = 1e9f;
    }

    const float envMs = 800.0f - speed * 740.0f;
    const float eC    = Virgo::envCoef(envMs, sr);
    const float liftC = Virgo::envCoef(envMs * 0.5f, sr);

    for (int i = 0; i < N; ++i)
    {
        const float l    = inL[i], r = inR[i];
        const float mono = (l + r) * 0.5f;
        const float high = mHpDet.tickL(mono);

        mFullEnv = eC * mFullEnv + (1.0f - eC) * std::abs(mono);
        mHighEnv = eC * mHighEnv + (1.0f - eC) * std::abs(high);

        const float ratio    = (mFullEnv > 1e-6f) ? mHighEnv / mFullEnv : 1.0f;
        const float dullness = Virgo::clamp01((0.4f - ratio) / 0.38f);
        const float target   = (mFullEnv > 1e-5f) ? dullness * maxLift : 0.0f;
        mLift = liftC * mLift + (1.0f - liftC) * target;

        if (std::abs(mLift - mLastShelfDb) > 0.25f) {
            mShelf.c = Virgo::calcBiquad(Virgo::FType::HighShelf, freq, mLift, 0.707f, sr);
            mLastShelfDb = mLift;
        }

        outL[i] = l * (1.0f - mix) + mShelf.tickL(l) * mix;
        outR[i] = r * (1.0f - mix) + mShelf.tickR(r) * mix;
    }
}

juce::AudioProcessorEditor* VAClarityProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA Clarity"); }

void VAClarityProcessor::initPresets()
{
    mPresets = {
        {"Gentle Open",          {{"amount",0.3f},{"speed",0.4f},{"freq",5000},{"mix",1}}},
        {"Vocal Presence",       {{"amount",0.5f},{"speed",0.6f},{"freq",3500},{"mix",1}}},
        {"Dull Mix Rescue",      {{"amount",0.8f},{"speed",0.5f},{"freq",4000},{"mix",1}}},
        {"Air Band Lift",        {{"amount",0.55f},{"speed",0.35f},{"freq",9000},{"mix",1}}},
        {"Broadcast Sheen",      {{"amount",0.6f},{"speed",0.7f},{"freq",6000},{"mix",0.9f}}},
        {"Subtle Master Polish", {{"amount",0.25f},{"speed",0.3f},{"freq",7000},{"mix",0.8f}}},
        {"Podcast Crisp",        {{"amount",0.65f},{"speed",0.75f},{"freq",4500},{"mix",1}}},
    };
}
void VAClarityProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VAClarityProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VAClarityProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VAClarityProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VAClarityProcessor(); }
