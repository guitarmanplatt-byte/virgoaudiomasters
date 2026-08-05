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
    juce::String pId(const char* name, int band) { return juce::String("b") + juce::String(band) + name; }
    static const float kDefaultFreqs[VADynamicEQProcessor::kNumBands] = {60,150,400,1000,2500,6000,10000,15000};
    // Filter type enum: 0=peaking, 1=lowshelf, 2=highshelf, 3=highpass, 4=lowpass
    static const Virgo::FType kFTypes[] = {
        Virgo::FType::Peaking, Virgo::FType::LowShelf, Virgo::FType::HighShelf,
        Virgo::FType::HighPass, Virgo::FType::LowPass
    };
}

VADynamicEQProcessor::VADynamicEQProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VADynamicEQProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    NR freqRange(20.0f, 20000.0f); freqRange.setSkewForCentre(1000.0f);
    NR qRange(0.1f, 12.0f);        qRange.setSkewForCentre(1.0f);
    NR atkRange(0.5f, 200.0f);     atkRange.setSkewForCentre(10.0f);
    NR relRange(20.0f, 2000.0f);   relRange.setSkewForCentre(150.0f);

    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    for (int b = 0; b < kNumBands; ++b) {
        const bool defaultOn = (b < 4);
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("on",b),1},    pId("on",b),    0.0f, 1.0f,   defaultOn ? 1.0f : 0.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("type",b),1},  pId("type",b),  0.0f, 4.0f,   0.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("freq",b),1},  pId("freq",b),  freqRange, kDefaultFreqs[b]));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("gain",b),1},  pId("gain",b),  -18.0f, 18.0f, 0.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("q",b),1},     pId("q",b),     qRange, 1.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("dyn",b),1},   pId("dyn",b),   0.0f, 1.0f,   0.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("range",b),1}, pId("range",b), -12.0f, 12.0f, -3.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("thresh",b),1},pId("thresh",b),-60.0f, 0.0f, -30.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("atk",b),1},   pId("atk",b),   atkRange, 10.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{pId("rel",b),1},   pId("rel",b),   relRange, 150.0f));
    }
    return layout;
}

void VADynamicEQProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    for (auto& b : mBands) { b.filt.reset(); b.det.reset(); b.env = b.dynDb = 0.0f; b.lastAppliedGain = 1e9f; b.lastFilterKey = b.lastDetKey = ""; }
}

void VADynamicEQProcessor::releaseResources() {}

void VADynamicEQProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    const float sr = (float)mSampleRate;
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    // Pre-pass: update coefficients per block
    for (int b = 0; b < kNumBands; ++b) {
        auto& bs = mBands[b];
        const bool on = *apvts.getRawParameterValue(pId("on",b)) > 0.5f;
        if (!on) { bs.env = 0.0f; bs.dynDb = 0.0f; continue; }

        const int   typeIdx = std::min(4, (int)*apvts.getRawParameterValue(pId("type",b)));
        const float freq    = *apvts.getRawParameterValue(pId("freq",b));
        const float gain    = *apvts.getRawParameterValue(pId("gain",b));
        const float q       = std::max(0.1f, (float)*apvts.getRawParameterValue(pId("q",b)));
        const bool  dynOn   = *apvts.getRawParameterValue(pId("dyn",b)) > 0.5f;

        // Detection bandpass
        const juce::String detKey = juce::String(freq) + "/" + juce::String(q);
        if (detKey != bs.lastDetKey) {
            bs.det.c = Virgo::calcBiquad(Virgo::FType::BandPass, freq, 0.0f, std::max(0.3f, q), sr);
            bs.lastDetKey = detKey;
        }

        const float applied = gain + (dynOn ? bs.dynDb : 0.0f);
        const juce::String fkey = juce::String(typeIdx) + "/" + juce::String(freq) + "/" + juce::String(q);
        if (fkey != bs.lastFilterKey || std::abs(applied - bs.lastAppliedGain) > 0.1f) {
            bs.filt.c = Virgo::calcBiquad(kFTypes[typeIdx], freq, applied, q, sr);
            bs.lastFilterKey = fkey;
            bs.lastAppliedGain = applied;
        }
    }

    // Sample loop
    for (int i = 0; i < N; ++i)
    {
        float l = inL[i], r = inR[i];
        for (int b = 0; b < kNumBands; ++b) {
            auto& bs = mBands[b];
            const bool on   = *apvts.getRawParameterValue(pId("on",b)) > 0.5f;
            if (!on) continue;
            const bool dynOn = *apvts.getRawParameterValue(pId("dyn",b)) > 0.5f;
            if (dynOn) {
                const float d   = bs.det.tickL((l + r) * 0.5f);
                const float mag = std::abs(d);
                const float atk = Virgo::envCoef(*apvts.getRawParameterValue(pId("atk",b)), sr);
                const float rel = Virgo::envCoef(*apvts.getRawParameterValue(pId("rel",b)), sr);
                const float coef = (mag > bs.env) ? atk : rel;
                bs.env = coef * bs.env + (1.0f - coef) * mag;
                const float thresh = *apvts.getRawParameterValue(pId("thresh",b));
                const float over   = Virgo::linToDb(bs.env) - thresh;
                const float amt    = (over > 0.0f) ? std::min(1.0f, over / 12.0f) : 0.0f;
                bs.dynDb = *apvts.getRawParameterValue(pId("range",b)) * amt;
            } else {
                bs.dynDb = 0.0f;
            }
            l = bs.filt.tickL(l);
            r = bs.filt.tickR(r);
        }
        outL[i] = l;
        outR[i] = r;
    }
}

juce::AudioProcessorEditor* VADynamicEQProcessor::createEditor() { return new VirgoGenericEditor(*this, apvts, "VA Dynamic EQ"); }

void VADynamicEQProcessor::initPresets()
{
    // Default preset: 4 bands on, flat
    std::map<juce::String, float> def;
    for (int b = 0; b < kNumBands; ++b) {
        def[pId("on",b)]     = b < 4 ? 1.0f : 0.0f;
        def[pId("type",b)]   = 0; def[pId("freq",b)]  = kDefaultFreqs[b];
        def[pId("gain",b)]   = 0; def[pId("q",b)]     = 1;
        def[pId("dyn",b)]    = 0; def[pId("range",b)] = -3;
        def[pId("thresh",b)] = -30; def[pId("atk",b)] = 10; def[pId("rel",b)] = 150;
    }
    mPresets.push_back({"Default", def});

    // Gentle Master Tilt
    auto tilt = def;
    for (int b = 0; b < kNumBands; ++b) tilt[pId("on",b)] = b < 4 ? 1.0f : 0.0f;
    tilt[pId("type",0)]=1; tilt[pId("freq",0)]=90;  tilt[pId("gain",0)]=1.2f; tilt[pId("q",0)]=0.8f;
    tilt[pId("freq",1)]=350; tilt[pId("gain",1)]=-0.8f; tilt[pId("q",1)]=1.2f;
    tilt[pId("freq",2)]=2800;tilt[pId("gain",2)]=0.8f;  tilt[pId("q",2)]=1.0f;
    tilt[pId("type",3)]=2; tilt[pId("freq",3)]=11000;tilt[pId("gain",3)]=1.5f; tilt[pId("q",3)]=0.8f;
    mPresets.push_back({"Gentle Master Tilt", tilt});
}

void VADynamicEQProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VADynamicEQProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VADynamicEQProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VADynamicEQProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VADynamicEQProcessor(); }
