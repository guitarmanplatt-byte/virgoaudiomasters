#include "PluginProcessor.h"
#include "VirgoGenericEditor.h"
#include <algorithm>

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

    float medianN(const float* ring, int len)
    {
        float tmp[9];
        for (int i = 0; i < len; ++i) tmp[i] = ring[i];
        std::sort(tmp, tmp + len);
        return tmp[len / 2];
    }
}

VADeCrackleProcessor::VADeCrackleProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VADeCrackleProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"threshold",1},"Threshold", 0.0f,  1.0f, 0.3f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"repair",   1},"Repair",    0.0f,  1.0f, 0.7f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"window",   1},"Window",    3.0f,  9.0f, 5.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",      1},"Mix",       0.0f,  1.0f, 1.0f));
    return layout;
}

void VADeCrackleProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mRingL.fill(0.0f); mRingR.fill(0.0f);
    mWriteL = mWriteR = 0;
}

void VADeCrackleProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float thresh = Virgo::clamp01(*apvts.getRawParameterValue("threshold"));
    const float repair = Virgo::clamp01(*apvts.getRawParameterValue("repair"));
    const float mix    = Virgo::clamp01(*apvts.getRawParameterValue("mix"));
    // Window must be an odd integer between 3 and 9
    int win = (int)*apvts.getRawParameterValue("window");
    win = std::max(3, std::min(kMaxWin, win | 1)); // force odd

    const float devThresh = 0.005f + thresh * 0.095f;

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];

        // Write into ring
        mRingL[mWriteL] = l;
        mRingR[mWriteR] = r;

        // Compute median for each channel
        const float medL = medianN(mRingL.data(), win);
        const float medR = medianN(mRingR.data(), win);

        float procL = l, procR = r;
        if (std::abs(l - medL) > devThresh)
            procL = l + (medL - l) * repair;
        if (std::abs(r - medR) > devThresh)
            procR = r + (medR - r) * repair;

        // Advance write cursors (must happen after processing current sample)
        mWriteL = (mWriteL + 1) % win;
        mWriteR = (mWriteR + 1) % win;

        outL[i] = l * (1.0f - mix) + procL * mix;
        outR[i] = r * (1.0f - mix) + procR * mix;
    }
}

juce::AudioProcessorEditor* VADeCrackleProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA De-crackle"); }

void VADeCrackleProcessor::initPresets()
{
    mPresets = {
        {"Vinyl Light",      {{"threshold",0.2f},{"repair",0.6f},{"window",5},{"mix",1}}},
        {"Heavy Crackle",    {{"threshold",0.4f},{"repair",0.85f},{"window",7},{"mix",1}}},
        {"78 RPM Restore",   {{"threshold",0.35f},{"repair",0.8f},{"window",7},{"mix",1}}},
        {"Subtle Touch",     {{"threshold",0.1f},{"repair",0.4f},{"window",3},{"mix",0.7f}}},
        {"Max Smooth",       {{"threshold",0.5f},{"repair",1.0f},{"window",9},{"mix",1}}},
        {"Broadcast Safe",   {{"threshold",0.25f},{"repair",0.65f},{"window",5},{"mix",0.9f}}},
    };
}
void VADeCrackleProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VADeCrackleProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VADeCrackleProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VADeCrackleProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VADeCrackleProcessor(); }
