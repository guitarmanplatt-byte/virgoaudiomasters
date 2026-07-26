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

VALowEndFocusProcessor::VALowEndFocusProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VALowEndFocusProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR xoverRange(50.0f, 400.0f); xoverRange.setSkewForCentre(120.0f);
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"xover",   1},"Crossover", xoverRange, 120.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"contrast",1},"Contrast",  -1.0f, 1.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"gain",    1},"Low Gain",  -12.0f, 12.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",     1},"Mix",        0.0f, 1.0f, 1.0f));
    return layout;
}

void VALowEndFocusProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mLpA.reset(); mLpB.reset(); mHpA.reset(); mHpB.reset();
    mLastXover = -1.0f;
    mFastEnv = mSlowEnv = 0.0f;
}

void VALowEndFocusProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float xover    = *apvts.getRawParameterValue("xover");
    const float contrast = Virgo::clampf(*apvts.getRawParameterValue("contrast"), -1.0f, 1.0f);
    const float gainLin  = Virgo::dbToLin(*apvts.getRawParameterValue("gain"));
    const float mix      = Virgo::clamp01(*apvts.getRawParameterValue("mix"));

    if (xover != mLastXover) {
        const auto cl = Virgo::calcBiquad(Virgo::FType::LowPass,  xover, 0.0f, 0.707f, sr);
        const auto ch = Virgo::calcBiquad(Virgo::FType::HighPass, xover, 0.0f, 0.707f, sr);
        mLpA.c = mLpB.c = cl;
        mHpA.c = mHpB.c = ch;
        mLastXover = xover;
    }

    const float fastC = Virgo::envCoef(8.0f, sr);
    const float slowC = Virgo::envCoef(160.0f, sr);

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];

        // LR4 complementary crossover (cascaded 2nd-order Butterworth)
        const float lowL  = mLpB.tickL(mLpA.tickL(l));
        const float lowR  = mLpB.tickR(mLpA.tickR(r));
        const float restL = mHpB.tickL(mHpA.tickL(l));
        const float restR = mHpB.tickR(mHpA.tickR(r));

        const float det = std::max(std::abs(lowL), std::abs(lowR));
        mFastEnv = fastC * mFastEnv + (1.0f - fastC) * det;
        mSlowEnv = slowC * mSlowEnv + (1.0f - slowC) * det;

        float g = 1.0f;
        if (contrast > 0.001f) {
            // Punchy: boost when fast env > slow env (transient emphasis)
            const float ratio = (mSlowEnv > 1e-6f) ? mFastEnv / mSlowEnv : 1.0f;
            const float punch = std::max(0.0f, std::min(2.0f, ratio - 1.0f));
            g = 1.0f + punch * contrast * 1.2f;
            if (ratio < 0.9f) g = 1.0f - (0.9f - ratio) * contrast * 0.5f;
        } else if (contrast < -0.001f) {
            // Smooth: soft compression of the low band
            const float lvlDb = Virgo::linToDb(mSlowEnv);
            const float over  = lvlDb - (-24.0f);
            if (over > 0.0f) g = Virgo::dbToLin(over * 0.5f * contrast);
        }

        float pl = lowL * g * gainLin;
        float pr = lowR * g * gainLin;
        // Soft clip the processed low band
        pl = std::tanh(pl * 0.8f) * 1.25f;
        pr = std::tanh(pr * 0.8f) * 1.25f;

        outL[i] = restL + lowL * (1.0f - mix) + pl * mix;
        outR[i] = restR + lowR * (1.0f - mix) + pr * mix;
    }
}

juce::AudioProcessorEditor* VALowEndFocusProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA Low End Focus"); }

void VALowEndFocusProcessor::initPresets()
{
    mPresets = {
        {"Tight & Punchy",  {{"xover",110},{"contrast",0.6f}, {"gain",1},  {"mix",1}}},
        {"Smooth Sub Glue", {{"xover",90}, {"contrast",-0.55f},{"gain",1.5f},{"mix",1}}},
        {"Kick Forward",    {{"xover",150},{"contrast",0.8f}, {"gain",0.5f},{"mix",0.9f}}},
        {"EDM Sub Control", {{"xover",80}, {"contrast",-0.4f},{"gain",2.5f},{"mix",1}}},
        {"Hip-Hop Knock",   {{"xover",130},{"contrast",0.7f}, {"gain",2},  {"mix",1}}},
        {"Warm Vinyl Bass", {{"xover",180},{"contrast",-0.3f},{"gain",1},  {"mix",0.8f}}},
        {"Subtle Tighten",  {{"xover",120},{"contrast",0.3f}, {"gain",0},  {"mix",0.7f}}},
    };
}
void VALowEndFocusProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VALowEndFocusProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VALowEndFocusProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VALowEndFocusProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VALowEndFocusProcessor(); }
