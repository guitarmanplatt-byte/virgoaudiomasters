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

VAMaximizerProcessor::VAMaximizerProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VAMaximizerProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"threshold",1},"Threshold", -24.0f, 0.0f,   -6.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"ceiling",  1},"Ceiling",   -3.0f,  0.0f,   -0.3f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"character",1},"Character",  0.0f,  1.0f,    0.5f));
    return layout;
}

void VAMaximizerProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    const int laSamples = std::max(1, (int)std::round(0.002 * sampleRate));
    mDelayL.assign(laSamples, 0.0f);
    mDelayR.assign(laSamples, 0.0f);
    mPeakHold.assign(laSamples, 0.0f);
    mDelayWrite = mPeakWrite = 0;
    mGain = 1.0f;
}

void VAMaximizerProcessor::releaseResources()
{
    mDelayL.clear(); mDelayR.clear(); mPeakHold.clear();
}

void VAMaximizerProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    // threshold = input drive (boost by -threshold dB)
    const float boost    = Virgo::dbToLin(-(*apvts.getRawParameterValue("threshold")));
    const float ceiling  = Virgo::dbToLin(*apvts.getRawParameterValue("ceiling"));
    const float character= Virgo::clamp01(*apvts.getRawParameterValue("character"));

    // character 0 = transparent (400ms release), 1 = aggressive (30ms)
    const float relMs   = 400.0f - character * 370.0f;
    const float relC    = Virgo::envCoef(relMs, sr);
    const float atkC    = Virgo::envCoef(0.4f, sr);  // ~lookahead attack

    const int laLen = (int)mDelayL.size();
    if (laLen == 0) return;

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i] * boost;
        const float r = inR[i] * boost;

        // Lookahead delay: read delayed sample, write current
        const float dl = mDelayL[mDelayWrite];
        const float dr = mDelayR[mDelayWrite];
        mDelayL[mDelayWrite] = l;
        mDelayR[mDelayWrite] = r;
        mDelayWrite = (mDelayWrite + 1) % laLen;

        // Peak hold over lookahead window
        const float det = std::max(std::abs(l), std::abs(r));
        mPeakHold[mPeakWrite] = det;
        mPeakWrite = (mPeakWrite + 1) % laLen;
        float maxPeak = 0.0f;
        for (float ph : mPeakHold) if (ph > maxPeak) maxPeak = ph;

        const float target = (maxPeak > ceiling) ? ceiling / maxPeak : 1.0f;
        const float coef   = (target < mGain) ? atkC : relC;
        mGain = coef * mGain + (1.0f - coef) * target;

        const float g = std::min(mGain, 1.0f);
        float ol = dl * g;
        float orv= dr * g;
        // Hard ceiling guard
        ol  = Virgo::clampf(ol,  -ceiling, ceiling);
        orv = Virgo::clampf(orv, -ceiling, ceiling);
        outL[i] = ol;
        outR[i] = orv;
    }
}

juce::AudioProcessorEditor* VAMaximizerProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA Maximizer"); }

void VAMaximizerProcessor::initPresets()
{
    mPresets = {
        {"Streaming -14 LUFS",   {{"threshold",-5},  {"ceiling",-1},   {"character",0.35f}}},
        {"EDM Loud",             {{"threshold",-12}, {"ceiling",-0.3f},{"character",0.8f}}},
        {"Transparent Master",   {{"threshold",-3},  {"ceiling",-0.5f},{"character",0.15f}}},
        {"CD Master",            {{"threshold",-8},  {"ceiling",-0.2f},{"character",0.5f}}},
        {"Club Slam",            {{"threshold",-15}, {"ceiling",-0.1f},{"character",0.95f}}},
        {"Podcast Safe",         {{"threshold",-6},  {"ceiling",-1.5f},{"character",0.4f}}},
        {"Vinyl Pre-Master",     {{"threshold",-4},  {"ceiling",-2},   {"character",0.2f}}},
    };
}
void VAMaximizerProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VAMaximizerProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VAMaximizerProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VAMaximizerProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VAMaximizerProcessor(); }
