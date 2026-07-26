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

VADeHumProcessor::VADeHumProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VADeHumProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR qRange(5.0f, 60.0f); qRange.setSkewForCentre(20.0f);
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    // 0 = 50 Hz, 1 = 60 Hz  (stored as float, rounded on use)
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"frequency",1},"Frequency", 0.0f, 1.0f,  0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"harmonics",1},"Harmonics", 1.0f, 5.0f,  3.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"q",        1},"Q",         qRange,      25.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"depth",    1},"Depth",     0.0f, 1.0f,  1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",      1},"Mix",       0.0f, 1.0f,  1.0f));
    return layout;
}

void VADeHumProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    for (auto& n : mNotches) n.reset();
    mCachedF0 = mCachedQ = -1.0f;
    mCachedHarmonics = -1;
    mActiveNotches = 0;
}

void VADeHumProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float f0Raw    = *apvts.getRawParameterValue("frequency") > 0.5f ? 60.0f : 50.0f;
    const int   harmNum  = std::max(1, std::min(kMaxHarmonics, (int)*apvts.getRawParameterValue("harmonics")));
    const float q        = std::max(1.0f, (float)*apvts.getRawParameterValue("q"));
    const float depth    = Virgo::clamp01(*apvts.getRawParameterValue("depth"));
    const float mix      = Virgo::clamp01(*apvts.getRawParameterValue("mix"));

    // Rebuild notch bank when parameters change
    if (f0Raw != mCachedF0 || q != mCachedQ || harmNum != mCachedHarmonics) {
        for (int h = 0; h < harmNum; ++h) {
            const float freq = f0Raw * (float)(h + 1);
            if (freq >= sr * 0.49f) { mActiveNotches = h; break; }
            // Notch: use BandPass polarity inversion (peaking with negative gain)
            // Use a deep peaking filter as notch: gain = -depth * 40 dB
            const float notchDb = -30.0f * depth;
            mNotches[h].c = Virgo::calcBiquad(Virgo::FType::Peaking, freq, notchDb, q, sr);
            mActiveNotches = h + 1;
        }
        mCachedF0 = f0Raw; mCachedQ = q; mCachedHarmonics = harmNum;
    }

    for (int i = 0; i < N; ++i)
    {
        float l = inL[i], r = inR[i];
        const float dryL = l, dryR = r;
        for (int h = 0; h < mActiveNotches; ++h) {
            l = mNotches[h].tickL(l);
            r = mNotches[h].tickR(r);
        }
        outL[i] = dryL * (1.0f - mix) + l * mix;
        outR[i] = dryR * (1.0f - mix) + r * mix;
    }
}

juce::AudioProcessorEditor* VADeHumProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA De-hum"); }

void VADeHumProcessor::initPresets()
{
    mPresets = {
        {"50Hz Europe 3H",   {{"frequency",0},{"harmonics",3},{"q",30},{"depth",1},{"mix",1}}},
        {"60Hz USA 3H",      {{"frequency",1},{"harmonics",3},{"q",30},{"depth",1},{"mix",1}}},
        {"50Hz 5 Harmonics", {{"frequency",0},{"harmonics",5},{"q",25},{"depth",1},{"mix",1}}},
        {"60Hz 5 Harmonics", {{"frequency",1},{"harmonics",5},{"q",25},{"depth",1},{"mix",1}}},
        {"Subtle 50Hz",      {{"frequency",0},{"harmonics",2},{"q",20},{"depth",0.6f},{"mix",0.8f}}},
        {"Subtle 60Hz",      {{"frequency",1},{"harmonics",2},{"q",20},{"depth",0.6f},{"mix",0.8f}}},
        {"Deep 50Hz Clean",  {{"frequency",0},{"harmonics",5},{"q",50},{"depth",1},{"mix",1}}},
    };
}
void VADeHumProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VADeHumProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VADeHumProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VADeHumProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VADeHumProcessor(); }
