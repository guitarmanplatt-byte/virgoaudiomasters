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

VAImagerProcessor::VAImagerProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VAImagerProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR xLowRange(60.0f, 800.0f);     xLowRange.setSkewForCentre(250.0f);
    NR xHighRange(1000.0f, 12000.0f); xHighRange.setSkewForCentre(4000.0f);
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"widthLow", 1},"Low Width",    0.0f, 2.0f, 1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"widthMid", 1},"Mid Width",    0.0f, 2.0f, 1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"widthHigh",1},"High Width",   0.0f, 2.0f, 1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"stereoize",1},"Stereoize",    0.0f, 1.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"xLow",     1},"Low X-Over",  xLowRange,  250.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"xHigh",    1},"High X-Over", xHighRange, 4000.0f));
    return layout;
}

void VAImagerProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mLpA.reset(); mLpB.reset(); mHpA.reset(); mHpB.reset();
    mLastXLow = mLastXHigh = -1.0f;
    const int hSamples = std::max(1, (int)std::round(0.009 * sampleRate));
    mHaasDelay.assign(hSamples, 0.0f);
    mHaasWrite = 0;
}

void VAImagerProcessor::releaseResources() { mHaasDelay.clear(); }

void VAImagerProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float xLow      = *apvts.getRawParameterValue("xLow");
    const float xHigh     = *apvts.getRawParameterValue("xHigh");
    const float wLow      = *apvts.getRawParameterValue("widthLow");
    const float wMid      = *apvts.getRawParameterValue("widthMid");
    const float wHigh     = *apvts.getRawParameterValue("widthHigh");
    const float stereoize = *apvts.getRawParameterValue("stereoize");

    if (xLow != mLastXLow || xHigh != mLastXHigh) {
        const auto cl = Virgo::calcBiquad(Virgo::FType::LowPass,  xLow,  0.0f, 0.707f, sr);
        const auto ch = Virgo::calcBiquad(Virgo::FType::HighPass, xHigh, 0.0f, 0.707f, sr);
        mLpA.c = mLpB.c = cl; mHpA.c = mHpB.c = ch;
        mLastXLow = xLow; mLastXHigh = xHigh;
    }

    const int haasLen = (int)mHaasDelay.size();

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];
        const float lowL  = mLpB.tickL(mLpA.tickL(l));
        const float lowR  = mLpB.tickR(mLpA.tickR(r));
        const float highL = mHpB.tickL(mHpA.tickL(l));
        const float highR = mHpB.tickR(mHpA.tickR(r));
        const float midL  = l - lowL - highL;
        const float midR  = r - lowR - highR;

        // Per-band M/S width
        auto msWidth = [](float s0L, float s0R, float w, float& oL, float& oR) {
            const float m = (s0L + s0R) * 0.5f;
            const float s = (s0L - s0R) * 0.5f * w;
            oL = m + s; oR = m - s;
        };
        float lowOL, lowOR, midOL, midOR, highOL, highOR;
        msWidth(lowL,  lowR,  wLow,  lowOL,  lowOR);
        msWidth(midL,  midR,  wMid,  midOL,  midOR);
        msWidth(highL, highR, wHigh, highOL, highOR);

        float om = (lowOL + lowOR + midOL + midOR + highOL + highOR) * 0.5f;
        // approximate side from combined output
        float osL = lowOL + midOL + highOL;
        float osR = lowOR + midOR + highOR;

        // Haas stereoize
        if (stereoize > 0.001f && haasLen > 0) {
            const float mono = om;
            const float delayed = mHaasDelay[mHaasWrite];
            mHaasDelay[mHaasWrite] = mono;
            mHaasWrite = (mHaasWrite + 1) % haasLen;
            osL += delayed * stereoize * 0.5f;
            osR -= delayed * stereoize * 0.5f;
        }

        outL[i] = osL;
        outR[i] = osR;
    }
}

juce::AudioProcessorEditor* VAImagerProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA Imager"); }

void VAImagerProcessor::initPresets()
{
    mPresets = {
        {"Mono Bass Wide Top",    {{"widthLow",0.2f},{"widthMid",1.1f},{"widthHigh",1.4f},{"stereoize",0},{"xLow",150},{"xHigh",4000}}},
        {"EDM Wide",              {{"widthLow",0.4f},{"widthMid",1.3f},{"widthHigh",1.7f},{"stereoize",0.15f},{"xLow",120},{"xHigh",3500}}},
        {"Gentle Widen",          {{"widthLow",0.9f},{"widthMid",1.1f},{"widthHigh",1.2f},{"stereoize",0},{"xLow",250},{"xHigh",4000}}},
        {"Mono Maker",            {{"widthLow",0},{"widthMid",0},{"widthHigh",0},{"stereoize",0},{"xLow",250},{"xHigh",4000}}},
        {"Vinyl Safe",            {{"widthLow",0.1f},{"widthMid",1},{"widthHigh",1},{"stereoize",0},{"xLow",300},{"xHigh",4000}}},
        {"Stereoize Mono Mix",    {{"widthLow",0.5f},{"widthMid",1},{"widthHigh",1.2f},{"stereoize",0.55f},{"xLow",200},{"xHigh",3000}}},
        {"Focus Center Vocal",    {{"widthLow",1},{"widthMid",0.7f},{"widthHigh",1.2f},{"stereoize",0},{"xLow",250},{"xHigh",5000}}},
        {"Super Wide Air",        {{"widthLow",0.8f},{"widthMid",1.2f},{"widthHigh",1.9f},{"stereoize",0.25f},{"xLow",200},{"xHigh",6000}}},
    };
}
void VAImagerProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VAImagerProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VAImagerProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VAImagerProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VAImagerProcessor(); }
