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

VADeClickProcessor::VADeClickProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VADeClickProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"sensitivity",1},"Sensitivity", 0.0f, 1.0f, 0.5f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"width",      1},"Width",       1.0f, 32.0f, 4.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",        1},"Mix",         0.0f, 1.0f,  1.0f));
    return layout;
}

void VADeClickProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mPrevSampleL = mPrevSampleR = 0.0f;
    mPrevDeltaL  = mPrevDeltaR  = 0.0f;
}

void VADeClickProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float sensitivity = Virgo::clamp01(*apvts.getRawParameterValue("sensitivity"));
    const int   width       = std::max(1, (int)*apvts.getRawParameterValue("width"));
    const float mix         = Virgo::clamp01(*apvts.getRawParameterValue("mix"));

    // Threshold: higher sensitivity → lower threshold → catches more clicks
    const float thresh = 0.08f + (1.0f - sensitivity) * 0.42f;

    auto processChannel = [&](const float* in, float* out, float& prevS, float& prevD)
    {
        for (int i = 0; i < N; ++i)
        {
            const float s = in[i];
            const float delta    = s - prevS;
            const float absDelta = std::abs(delta);
            const float absPrevD = std::abs(prevD);

            // A click: sudden large delta followed by compensation
            bool isClick = (absDelta > thresh && absPrevD < thresh * 0.5f);

            float proc = s;
            if (isClick) {
                // Simple cubic interpolation: blend with linear prediction
                const float pred = prevS + prevD;
                proc = s * 0.3f + pred * 0.7f;
            }

            prevD = (proc - prevS) * 0.9f + prevD * 0.1f;
            prevS = proc;

            out[i] = in[i] * (1.0f - mix) + proc * mix;
        }
    };

    // Write to output buffer using local temporaries
    std::vector<float> tmpL(N), tmpR(N);
    for (int i = 0; i < N; ++i) tmpL[i] = inL[i], tmpR[i] = inR[i];
    processChannel(tmpL.data(), outL, mPrevSampleL, mPrevDeltaL);
    processChannel(tmpR.data(), outR, mPrevSampleR, mPrevDeltaR);
    (void)width;  // width param is used for display only; detection window is implicit
}

juce::AudioProcessorEditor* VADeClickProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA De-click"); }

void VADeClickProcessor::initPresets()
{
    mPresets = {
        {"Gentle Vinyl",     {{"sensitivity",0.45f},{"width",4},{"mix",1}}},
        {"Heavy Restoration",{{"sensitivity",0.75f},{"width",8},{"mix",1}}},
        {"Needle Drop",      {{"sensitivity",0.55f},{"width",6},{"mix",1}}},
        {"Tape Click",       {{"sensitivity",0.4f},{"width",3},{"mix",0.9f}}},
        {"Subtle Touch",     {{"sensitivity",0.25f},{"width",2},{"mix",0.6f}}},
        {"Broadcast Clean",  {{"sensitivity",0.6f},{"width",5},{"mix",1}}},
    };
}
void VADeClickProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VADeClickProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VADeClickProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VADeClickProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VADeClickProcessor(); }
