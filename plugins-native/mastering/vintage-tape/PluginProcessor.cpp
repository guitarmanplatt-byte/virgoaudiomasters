#include "PluginProcessor.h"
#include "VirgoGenericEditor.h"

namespace {
    void applyPreset(juce::AudioProcessorValueTreeState& apvts, const std::map<juce::String, float>& p) {
        for (auto& [id, val] : p)
            if (auto* pr = apvts.getParameter(id)) pr->setValueNotifyingHost(pr->convertTo0to1(val));
    }
    void saveState(juce::AudioProcessorValueTreeState& apvts, juce::MemoryBlock& dest) {
        auto state = apvts.copyState();
        if (auto xml = state.createXml()) juce::AudioProcessor::copyXmlToBinary(*xml, dest);
    }
    void loadState(juce::AudioProcessorValueTreeState& apvts, const void* data, int size) {
        if (auto xml = juce::AudioProcessor::getXmlFromBinary(data, size))
            if (xml->hasTagName(apvts.state.getType()))
                apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }
}

VAVintageTapeProcessor::VAVintageTapeProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout VAVintageTapeProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"saturation",  1}, "Saturation",   0.0f,   1.0f,    0.30f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"bumpFreq",    1}, "Bump Freq",   40.0f, 200.0f,   80.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"bumpGain",    1}, "Bump Gain",    0.0f,   8.0f,    2.5f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"rolloffFreq", 1}, "HF Rolloff", 4000.0f,20000.0f,14000.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"wow",         1}, "Wow",          0.0f,   1.0f,    0.20f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"flutter",     1}, "Flutter",      0.0f,   1.0f,    0.15f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",         1}, "Mix",          0.0f,   1.0f,    1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"trim",        1}, "Trim",       -12.0f,   6.0f,    0.0f));
    return layout;
}

void VAVintageTapeProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;

    // Reset filter state
    mBump.reset();
    mRolloff.reset();
    mLastBumpFreq  = -1.0f;
    mLastBumpGain  = -9999.0f;
    mLastRolloff   = -1.0f;

    // Allocate delay buffer (6 ms max + 4 samples for interpolation safety)
    const int bufSize = (int)std::ceil(sampleRate * kMaxDelayMs / 1000.0f) + 4;
    mBufL.assign(bufSize, 0.0f);
    mBufR.assign(bufSize, 0.0f);
    mWritePos = 0;

    // Reset LFO phases
    mWowPhase      = 0.0f;
    mFlutterPhase  = 0.0f;
    mFlutterPhase2 = 1.7f;
}

void VAVintageTapeProcessor::releaseResources()
{
    mBufL.clear();
    mBufR.clear();
}

void VAVintageTapeProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N  = buffer.getNumSamples();
    const float sr = (float)mSampleRate;

    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1)  : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float saturation  = Virgo::clamp01(*apvts.getRawParameterValue("saturation"));
    const float bumpFreq    = *apvts.getRawParameterValue("bumpFreq");
    const float bumpGain    = *apvts.getRawParameterValue("bumpGain");
    const float rolloffFreq = *apvts.getRawParameterValue("rolloffFreq");
    const float wow         = Virgo::clamp01(*apvts.getRawParameterValue("wow"));
    const float flutter     = Virgo::clamp01(*apvts.getRawParameterValue("flutter"));
    const float mix         = Virgo::clamp01(*apvts.getRawParameterValue("mix"));
    const float trim        = *apvts.getRawParameterValue("trim");
    const float trimLin     = Virgo::dbToLin(trim);

    // Recompute biquads only when parameters change
    if (bumpFreq != mLastBumpFreq || bumpGain != mLastBumpGain)
    {
        mBump.c = Virgo::calcBiquad(Virgo::FType::LowShelf, bumpFreq, bumpGain, 0.71f, sr);
        mLastBumpFreq = bumpFreq;
        mLastBumpGain = bumpGain;
    }
    if (rolloffFreq != mLastRolloff)
    {
        mRolloff.c = Virgo::calcBiquad(Virgo::FType::LowPass, rolloffFreq, 0.0f, 0.71f, sr);
        mLastRolloff = rolloffFreq;
    }

    const bool hasWow     = wow     > 0.001f;
    const bool hasFlutter = flutter > 0.001f;
    const bool hasMod     = hasWow || hasFlutter;

    // LFO increments per sample
    const float twoPi      = Virgo::kTwoPi;
    const float wowInc      = twoPi * 0.5f   / sr;  // 0.5 Hz
    const float flutterInc  = twoPi * 6.0f   / sr;  // 6 Hz
    const float flutterInc2 = twoPi * 11.3f  / sr;  // 11.3 Hz second partial

    // Base delay so modulation can swing both directions (3 ms)
    const float baseDelaySamples = hasMod ? (sr * 0.003f) : 0.0f;
    const int   bufSize = (int)mBufL.size();

    for (int i = 0; i < N; ++i)
    {
        float l = inL[i];
        float r = inR[i];

        // 1. Head-bump low shelf
        l = mBump.tickL(l);
        r = mBump.tickR(r);

        // 2. Soft tape saturation — algebraic sigmoid (mirrors JS kernel)
        if (saturation > 0.001f)
        {
            const float k   = saturation * 5.0f;
            const float kp1 = 1.0f + k;
            l = (kp1 * l) / (1.0f + k * std::abs(l));
            r = (kp1 * r) / (1.0f + k * std::abs(r));
        }

        // 3. HF rolloff lowpass
        l = mRolloff.tickL(l);
        r = mRolloff.tickR(r);

        // Write into delay buffer
        mBufL[mWritePos] = l;
        mBufR[mWritePos] = r;

        float outSampleL, outSampleR;

        if (hasMod)
        {
            // Wow LFO (two-partial pseudo-random)
            const float wowAmt = hasWow
                ? (std::sin(mWowPhase) * 0.6f + std::sin(mWowPhase * 1.71f + 0.9f) * 0.4f) * wow * 2.0f
                : 0.0f;

            // Flutter LFO (two partials)
            const float flutterAmt = hasFlutter
                ? (std::sin(mFlutterPhase) * 0.55f + std::sin(mFlutterPhase2 + 0.4f) * 0.45f) * flutter * 0.4f
                : 0.0f;

            float delaySamples = baseDelaySamples + (wowAmt + flutterAmt) * sr * 0.001f;
            delaySamples = Virgo::clampf(delaySamples, 0.0f, (float)(bufSize - 2));

            // Linear interpolation read
            float readF = (float)mWritePos - delaySamples;
            while (readF < 0.0f) readF += (float)bufSize;
            const int   ri0  = ((int)readF) % bufSize;
            const int   ri1  = (ri0 + 1) % bufSize;
            const float frac = readF - std::floor(readF);
            outSampleL = mBufL[ri0] * (1.0f - frac) + mBufL[ri1] * frac;
            outSampleR = mBufR[ri0] * (1.0f - frac) + mBufR[ri1] * frac;

            // Advance LFOs
            mWowPhase += wowInc;
            if (mWowPhase > twoPi) mWowPhase -= twoPi;
            mFlutterPhase += flutterInc;
            if (mFlutterPhase > twoPi) mFlutterPhase -= twoPi;
            mFlutterPhase2 += flutterInc2;
            if (mFlutterPhase2 > twoPi) mFlutterPhase2 -= twoPi;
        }
        else
        {
            outSampleL = mBufL[mWritePos];
            outSampleR = mBufR[mWritePos];
        }

        mWritePos = (mWritePos + 1) % bufSize;

        // Dry/wet mix and trim
        outL[i] = (inL[i] * (1.0f - mix) + outSampleL * mix) * trimLin;
        outR[i] = (inR[i] * (1.0f - mix) + outSampleR * mix) * trimLin;
    }
}

juce::AudioProcessorEditor* VAVintageTapeProcessor::createEditor()
{
    return new VirgoGenericEditor(*this, apvts, "VA Vintage Tape");
}

void VAVintageTapeProcessor::initPresets()
{
    mPresets = {
        {"Studio 15 IPS",    {{"saturation",0.25f},{"bumpFreq",80},  {"bumpGain",2.5f},{"rolloffFreq",14000},{"wow",0.15f},{"flutter",0.10f},{"mix",1},{"trim",-0.5f}}},
        {"Modern 30 IPS",    {{"saturation",0.15f},{"bumpFreq",60},  {"bumpGain",1.5f},{"rolloffFreq",18000},{"wow",0.05f},{"flutter",0.05f},{"mix",1},{"trim",0}}},
        {"Lo-Fi Cassette",   {{"saturation",0.55f},{"bumpFreq",100}, {"bumpGain",3.5f},{"rolloffFreq", 8000},{"wow",0.45f},{"flutter",0.35f},{"mix",1},{"trim",-1}}},
        {"Rock Slam",        {{"saturation",0.65f},{"bumpFreq",90},  {"bumpGain",3.0f},{"rolloffFreq",12000},{"wow",0.20f},{"flutter",0.15f},{"mix",1},{"trim",-1.5f}}},
        {"Digital Warmth",   {{"saturation",0.10f},{"bumpFreq",70},  {"bumpGain",1.2f},{"rolloffFreq",16000},{"wow",0},    {"flutter",0},    {"mix",0.6f},{"trim",0}}},
        {"Vintage Soul",     {{"saturation",0.45f},{"bumpFreq",110}, {"bumpGain",3.8f},{"rolloffFreq", 9000},{"wow",0.30f},{"flutter",0.20f},{"mix",1},{"trim",-1}}},
        {"Degraded Tape",    {{"saturation",0.70f},{"bumpFreq",100}, {"bumpGain",3.0f},{"rolloffFreq", 7000},{"wow",0.85f},{"flutter",0.70f},{"mix",1},{"trim",-2}}},
        {"Mastering Insert", {{"saturation",0.20f},{"bumpFreq",75},  {"bumpGain",2.0f},{"rolloffFreq",15000},{"wow",0},    {"flutter",0},    {"mix",1},{"trim",0}}},
    };
}

void VAVintageTapeProcessor::setCurrentProgram(int index)
{
    if (index >= 0 && index < (int)mPresets.size())
    {
        mCurrentProgram = index;
        applyPreset(apvts, mPresets[index].params);
    }
}

const juce::String VAVintageTapeProcessor::getProgramName(int i)
{
    return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : "";
}

void VAVintageTapeProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VAVintageTapeProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VAVintageTapeProcessor(); }
