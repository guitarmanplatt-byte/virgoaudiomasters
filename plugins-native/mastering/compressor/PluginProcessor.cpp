#include "PluginProcessor.h"
#include "VirgoGenericEditor.h"

namespace {
    void applyPreset(juce::AudioProcessorValueTreeState& apvts,
                     const std::map<juce::String, float>& params) {
        for (auto& [id, val] : params)
            if (auto* p = apvts.getParameter(id)) p->setValueNotifyingHost(p->convertTo0to1(val));
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

VACompressorProcessor::VACompressorProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout
VACompressorProcessor::createParameterLayout()
{
    using NR = juce::NormalisableRange<float>;
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    // Log-scale ranges for attack/release/ratio via skew
    NR ratioRange(1.0f, 20.0f);  ratioRange.setSkewForCentre(4.0f);
    NR atkRange(0.1f, 250.0f);   atkRange.setSkewForCentre(10.0f);
    NR relRange(20.0f, 2500.0f); relRange.setSkewForCentre(200.0f);

    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"threshold",1},"Threshold", -60.0f, 0.0f, -18.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"ratio",    1},"Ratio",     ratioRange, 4.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"knee",     1},"Knee",      0.0f, 24.0f, 6.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"attack",   1},"Attack",    atkRange,   10.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"release",  1},"Release",   relRange,   200.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"makeup",   1},"Makeup",    0.0f, 24.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"mix",      1},"Mix",       0.0f, 1.0f,  1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"autoRelease",1},"Auto Release", 0.0f, 1.0f, 1.0f));
    return layout;
}

void VACompressorProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mEnv = mRelEnv = mGrDb = 0.0f;
}

void VACompressorProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals nd;
    const int N = buffer.getNumSamples();
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float thresh    = *apvts.getRawParameterValue("threshold");
    const float ratio     = std::max(1.0f, (float)*apvts.getRawParameterValue("ratio"));
    const float knee      = std::max(0.0f, (float)*apvts.getRawParameterValue("knee"));
    const float atkMs     = *apvts.getRawParameterValue("attack");
    const float relMs     = *apvts.getRawParameterValue("release");
    const bool  autoRel   = *apvts.getRawParameterValue("autoRelease") > 0.5f;
    const float makeup    = Virgo::dbToLin(*apvts.getRawParameterValue("makeup"));
    const float mix       = Virgo::clamp01(*apvts.getRawParameterValue("mix"));

    const float atkC  = Virgo::envCoef(atkMs, (float)mSampleRate);
    const float slowC = Virgo::envCoef(800.0f, (float)mSampleRate);

    for (int i = 0; i < N; ++i)
    {
        const float l = inL[i], r = inR[i];
        const float det = std::max(std::abs(l), std::abs(r));

        // Program-dependent release
        mRelEnv = slowC * mRelEnv + (1.0f - slowC) * det;
        float effRel = relMs;
        if (autoRel) {
            const float crest = (det > 1e-6f && mRelEnv > 1e-6f) ? det / mRelEnv : 1.0f;
            effRel = relMs / std::max(0.5f, std::min(4.0f, crest));
        }
        const float relC = Virgo::envCoef(effRel, (float)mSampleRate);
        const float coef = det > mEnv ? atkC : relC;
        mEnv = coef * mEnv + (1.0f - coef) * det;

        // Gain computer (soft knee)
        const float lvlDb = Virgo::linToDb(mEnv);
        const float over  = lvlDb - thresh;
        float gr = 0.0f;
        if (knee > 0.0f && over > -knee * 0.5f && over < knee * 0.5f) {
            const float x = over + knee * 0.5f;
            gr = ((1.0f / ratio - 1.0f) * x * x) / (2.0f * knee);
        } else if (over >= knee * 0.5f) {
            gr = (1.0f / ratio - 1.0f) * over;
        }
        mGrDb = 0.9995f * mGrDb + 0.0005f * gr;
        const float g = Virgo::dbToLin(gr) * makeup;

        outL[i] = l * (1.0f - mix) + l * g * mix;
        outR[i] = r * (1.0f - mix) + r * g * mix;
    }
}

juce::AudioProcessorEditor* VACompressorProcessor::createEditor()
{
    return new VirgoGenericEditor(*this, apvts, "VA Compressor");
}

void VACompressorProcessor::initPresets()
{
    mPresets = {
        { "Glue Master",       {{"threshold",-20},{"ratio",2},{"knee",12},{"attack",30},{"release",300},{"makeup",1.5f},{"mix",1},{"autoRelease",1}} },
        { "Vocal Master",      {{"threshold",-24},{"ratio",3},{"knee",8}, {"attack",8}, {"release",180},{"makeup",3},   {"mix",1},{"autoRelease",1}} },
        { "EDM Loud",          {{"threshold",-18},{"ratio",6},{"knee",4}, {"attack",2}, {"release",90}, {"makeup",5},   {"mix",1},{"autoRelease",0}} },
        { "Punch Keeper",      {{"threshold",-16},{"ratio",4},{"knee",6}, {"attack",40},{"release",150},{"makeup",2},   {"mix",1},{"autoRelease",1}} },
        { "Parallel Thickener",{{"threshold",-35},{"ratio",8},{"knee",6}, {"attack",1}, {"release",120},{"makeup",8},   {"mix",0.35f},{"autoRelease",1}} },
        { "Gentle Leveler",    {{"threshold",-26},{"ratio",1.6f},{"knee",18},{"attack",60},{"release",600},{"makeup",1},{"mix",1},{"autoRelease",1}} },
        { "Drum Bus Smash",    {{"threshold",-22},{"ratio",10},{"knee",3},{"attack",5}, {"release",80}, {"makeup",6},   {"mix",0.6f},{"autoRelease",0}} },
        { "Warm Tape Squeeze", {{"threshold",-19},{"ratio",2.5f},{"knee",14},{"attack",15},{"release",400},{"makeup",2},{"mix",0.85f},{"autoRelease",1}} },
    };
}

void VACompressorProcessor::setCurrentProgram(int index) {
    if (index >= 0 && index < (int)mPresets.size()) { mCurrentProgram = index; applyPreset(apvts, mPresets[index].params); }
}
const juce::String VACompressorProcessor::getProgramName(int i) { return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : ""; }
void VACompressorProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VACompressorProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VACompressorProcessor(); }
