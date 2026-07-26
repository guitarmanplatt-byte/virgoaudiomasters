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

VADeClipProcessor::VADeClipProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VADeClipProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"threshold",1},"Threshold", 0.3f, 1.0f,  0.9f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"recovery",  1},"Recovery",  0.0f, 1.0f,  0.7f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"ceiling",   1},"Ceiling",  -3.0f, 0.0f, -0.1f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",       1},"Mix",       0.0f, 1.0f,  1.0f));
    return layout;
}

void VADeClipProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mHistL.fill(0.0f); mHistR.fill(0.0f);
    mHistPos = 0; mClipRunL = mClipRunR = 0;
    mClipSignL = mClipSignR = 1.0f;
}

void VADeClipProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float thresh   = Virgo::clampf(*apvts.getRawParameterValue("threshold"), 0.3f, 1.0f);
    const float recovery = Virgo::clamp01(*apvts.getRawParameterValue("recovery"));
    const float ceiling  = Virgo::dbToLin(*apvts.getRawParameterValue("ceiling"));
    const float mix      = Virgo::clamp01(*apvts.getRawParameterValue("mix"));

    // Max run length before we give up on Hermite (samples)
    const int maxRun = 128;
    const float blend = recovery;  // how strongly to trust Hermite reconstruction

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];

        // L channel
        float procL = l;
        if (std::abs(l) >= thresh) {
            if (mClipRunL == 0) mClipSignL = (l > 0.0f) ? 1.0f : -1.0f;
            if (mClipRunL < maxRun) {
                // Hermite extrapolation from history
                const int h = kHistory;
                const float p0 = mHistL[(mHistPos + h - 1) % h];
                const float p1 = mHistL[(mHistPos + h - 2) % h];
                const float p2 = mHistL[(mHistPos + h - 3) % h];
                const float p3 = mHistL[(mHistPos + h - 4) % h];
                // Catmull-Rom extrapolation at t=1 beyond p0
                const float ext = Virgo::hermite(p3, p2, p1, p0, 1.0f);
                procL = l * (1.0f - blend) + ext * blend;
            }
            mClipRunL++;
        } else {
            mClipRunL = 0;
        }

        // R channel
        float procR = r;
        if (std::abs(r) >= thresh) {
            if (mClipRunR == 0) mClipSignR = (r > 0.0f) ? 1.0f : -1.0f;
            if (mClipRunR < maxRun) {
                const int h = kHistory;
                const float p0 = mHistR[(mHistPos + h - 1) % h];
                const float p1 = mHistR[(mHistPos + h - 2) % h];
                const float p2 = mHistR[(mHistPos + h - 3) % h];
                const float p3 = mHistR[(mHistPos + h - 4) % h];
                const float ext = Virgo::hermite(p3, p2, p1, p0, 1.0f);
                procR = r * (1.0f - blend) + ext * blend;
            }
            mClipRunR++;
        } else {
            mClipRunR = 0;
        }

        // Write cleaned sample into history ring
        mHistL[mHistPos] = procL;
        mHistR[mHistPos] = procR;
        mHistPos = (mHistPos + 1) % kHistory;

        // Hard ceiling
        procL = Virgo::clampf(procL, -ceiling, ceiling);
        procR = Virgo::clampf(procR, -ceiling, ceiling);

        outL[i] = l * (1.0f - mix) + procL * mix;
        outR[i] = r * (1.0f - mix) + procR * mix;
    }
}

juce::AudioProcessorEditor* VADeClipProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA De-clip"); }

void VADeClipProcessor::initPresets()
{
    mPresets = {
        {"Gentle Restore",   {{"threshold",0.92f},{"recovery",0.5f},{"ceiling",-0.1f},{"mix",1}}},
        {"Heavy Clip Fix",   {{"threshold",0.72f},{"recovery",0.85f},{"ceiling",-0.2f},{"mix",1}}},
        {"Broadcast Safe",   {{"threshold",0.85f},{"recovery",0.7f},{"ceiling",-0.5f},{"mix",1}}},
        {"Max Recovery",     {{"threshold",0.5f},{"recovery",1.0f},{"ceiling",-0.1f},{"mix",1}}},
        {"Subtle Touch",     {{"threshold",0.97f},{"recovery",0.3f},{"ceiling",-0.1f},{"mix",0.7f}}},
    };
}
void VADeClipProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VADeClipProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VADeClipProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VADeClipProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VADeClipProcessor(); }
