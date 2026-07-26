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

VAExciterProcessor::VAExciterProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VAExciterProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR xLowRange(60.0f, 800.0f);   xLowRange.setSkewForCentre(200.0f);
    NR xHighRange(1000.0f, 12000.0f); xHighRange.setSkewForCentre(3000.0f);
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mode",   1},"Mode",    0.0f, 3.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"xLow",   1},"Low X-Over",  xLowRange,  200.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"xHigh",  1},"High X-Over", xHighRange, 3000.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"amtLow", 1},"Low Amount",  0.0f, 1.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mixLow", 1},"Low Mix",     0.0f, 1.0f, 1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"amtMid", 1},"Mid Amount",  0.0f, 1.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mixMid", 1},"Mid Mix",     0.0f, 1.0f, 1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"amtHigh",1},"High Amount", 0.0f, 1.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mixHigh",1},"High Mix",    0.0f, 1.0f, 1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"trim",   1},"Trim",       -12.0f, 12.0f, 0.0f));
    return layout;
}

void VAExciterProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mLpA.reset(); mLpB.reset(); mHpA.reset(); mHpB.reset();
    mLastXLow = mLastXHigh = -1.0f;
}

void VAExciterProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const int   mode     = std::min(3, (int)*apvts.getRawParameterValue("mode"));
    const float xLow     = *apvts.getRawParameterValue("xLow");
    const float xHigh    = *apvts.getRawParameterValue("xHigh");
    const float amtLow   = *apvts.getRawParameterValue("amtLow");
    const float mixLow   = *apvts.getRawParameterValue("mixLow");
    const float amtMid   = *apvts.getRawParameterValue("amtMid");
    const float mixMid   = *apvts.getRawParameterValue("mixMid");
    const float amtHigh  = *apvts.getRawParameterValue("amtHigh");
    const float mixHigh  = *apvts.getRawParameterValue("mixHigh");
    const float outTrim  = Virgo::dbToLin(*apvts.getRawParameterValue("trim"));

    if (xLow != mLastXLow || xHigh != mLastXHigh) {
        const auto cl = Virgo::calcBiquad(Virgo::FType::LowPass,  xLow,  0.0f, 0.707f, sr);
        const auto ch = Virgo::calcBiquad(Virgo::FType::HighPass, xHigh, 0.0f, 0.707f, sr);
        mLpA.c = mLpB.c = cl;
        mHpA.c = mHpB.c = ch;
        mLastXLow = xLow; mLastXHigh = xHigh;
    }

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];

        // 2nd-order cascaded LP (Butterworth-ish)
        const float lowL  = mLpB.tickL(mLpA.tickL(l));
        const float lowR  = mLpB.tickR(mLpA.tickR(r));
        const float highL = mHpB.tickL(mHpA.tickL(l));
        const float highR = mHpB.tickR(mHpA.tickR(r));
        const float midL  = l - lowL - highL;
        const float midR  = r - lowR - highR;

        auto bandOut = [&](float s, float amt, float mx) -> float {
            if (amt < 0.001f) return s;
            return s + (Virgo::shapeMode(s, mode, amt) - s) * mx;
        };

        outL[i] = (bandOut(lowL, amtLow, mixLow) + bandOut(midL, amtMid, mixMid) + bandOut(highL, amtHigh, mixHigh)) * outTrim;
        outR[i] = (bandOut(lowR, amtLow, mixLow) + bandOut(midR, amtMid, mixMid) + bandOut(highR, amtHigh, mixHigh)) * outTrim;
    }
}

juce::AudioProcessorEditor* VAExciterProcessor::createEditor()
{
    return new VirgoGenericEditor(*this, apvts, "VA Exciter");
}

void VAExciterProcessor::initPresets()
{
    mPresets = {
        {"Warm Tape",      {{"mode",1},{"xLow",180},{"xHigh",3200},{"amtLow",0.25f},{"mixLow",0.8f},{"amtMid",0.2f},{"mixMid",0.7f},{"amtHigh",0.15f},{"mixHigh",0.6f},{"trim",-0.5f}}},
        {"Tube Sheen",     {{"mode",2},{"xLow",200},{"xHigh",4000},{"amtLow",0.1f},{"mixLow",0.5f},{"amtMid",0.25f},{"mixMid",0.6f},{"amtHigh",0.35f},{"mixHigh",0.7f},{"trim",-1.0f}}},
        {"Vocal Presence", {{"mode",2},{"xLow",250},{"xHigh",2500},{"amtLow",0},{"mixLow",1},{"amtMid",0.3f},{"mixMid",0.55f},{"amtHigh",0.2f},{"mixHigh",0.5f},{"trim",0}}},
        {"Bass Growl",     {{"mode",0},{"xLow",300},{"xHigh",3000},{"amtLow",0.5f},{"mixLow",0.7f},{"amtMid",0.1f},{"mixMid",0.5f},{"amtHigh",0},{"mixHigh",1},{"trim",-1}}},
        {"Air Sparkle",    {{"mode",0},{"xLow",200},{"xHigh",6000},{"amtLow",0},{"mixLow",1},{"amtMid",0.05f},{"mixMid",0.5f},{"amtHigh",0.45f},{"mixHigh",0.65f},{"trim",0}}},
        {"EDM Loud",       {{"mode",3},{"xLow",150},{"xHigh",4500},{"amtLow",0.3f},{"mixLow",0.6f},{"amtMid",0.35f},{"mixMid",0.6f},{"amtHigh",0.4f},{"mixHigh",0.6f},{"trim",-2}}},
        {"Lo-Fi Retro",    {{"mode",3},{"xLow",400},{"xHigh",2500},{"amtLow",0.45f},{"mixLow",0.9f},{"amtMid",0.5f},{"mixMid",0.9f},{"amtHigh",0.3f},{"mixHigh",0.8f},{"trim",-3}}},
        {"Subtle Glue",    {{"mode",1},{"xLow",200},{"xHigh",3000},{"amtLow",0.1f},{"mixLow",0.5f},{"amtMid",0.1f},{"mixMid",0.5f},{"amtHigh",0.1f},{"mixHigh",0.5f},{"trim",0}}},
    };
}
void VAExciterProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VAExciterProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VAExciterProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VAExciterProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VAExciterProcessor(); }
