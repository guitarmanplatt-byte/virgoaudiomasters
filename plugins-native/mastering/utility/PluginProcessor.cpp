#include "PluginProcessor.h"
#include "VirgoGenericEditor.h"

// ─── Boilerplate helpers shared across all processor cpps ────────────────────
namespace {
    void applyPreset(juce::AudioProcessorValueTreeState& apvts,
                     const std::map<juce::String, float>& params)
    {
        for (auto& [id, val] : params)
            if (auto* p = apvts.getParameter(id))
                p->setValueNotifyingHost(p->convertTo0to1(val));
    }
    void saveState(juce::AudioProcessorValueTreeState& apvts, juce::MemoryBlock& dest)
    {
        auto state = apvts.copyState();
        if (auto xml = state.createXml()) juce::AudioProcessor::copyXmlToBinary(*xml, dest);
    }
    void loadState(juce::AudioProcessorValueTreeState& apvts, const void* data, int size)
    {
        if (auto xml = juce::AudioProcessor::getXmlFromBinary(data, size))
            if (xml->hasTagName(apvts.state.getType()))
                apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }
} // namespace

// ─── Constructor ──────────────────────────────────────────────────────────────
VAUtilityProcessor::VAUtilityProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout
VAUtilityProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"gain",  1}, "Gain",  -24.0f, 24.0f,   0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"pan",   1}, "Pan",    -1.0f,  1.0f,   0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"width", 1}, "Width",   0.0f,  2.0f,   1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"drive", 1}, "Drive",   0.0f,  1.0f,   0.0f));
    return layout;
}

void VAUtilityProcessor::prepareToPlay(double sampleRate, int /*blockSize*/)
{
    mSampleRate = sampleRate;
    mGainZ = 1.0f;
}

void VAUtilityProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                      juce::MidiBuffer& /*midi*/)
{
    juce::ScopedNoDenormals noDenormals;
    const int N   = buffer.getNumSamples();
    auto* inL  = buffer.getReadPointer(0);
    auto* inR  = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float gainLin = Virgo::dbToLin(*apvts.getRawParameterValue("gain"));
    const float width   = *apvts.getRawParameterValue("width");
    const float pan     = Virgo::clampf(*apvts.getRawParameterValue("pan"), -1.0f, 1.0f);
    const float drive   = *apvts.getRawParameterValue("drive");

    const float panL = std::cos((pan + 1.0f) * Virgo::kPi / 4.0f);
    const float panR = std::sin((pan + 1.0f) * Virgo::kPi / 4.0f);
    const float k    = drive * 40.0f;

    for (int i = 0; i < N; ++i)
    {
        mGainZ += (gainLin - mGainZ) * 0.002f;
        float l = inL[i] * mGainZ;
        float r = inR[i] * mGainZ;

        // M/S width
        const float mid  = (l + r) * 0.5f;
        const float side = (l - r) * 0.5f * width;
        l = mid + side;
        r = mid - side;

        // Soft drive (Retro-style)
        if (k > 0.5f) {
            l = ((Virgo::kPi + k) * l) / (Virgo::kPi + k * std::abs(l));
            r = ((Virgo::kPi + k) * r) / (Virgo::kPi + k * std::abs(r));
        }

        outL[i] = l * panL * 1.4142f;
        outR[i] = r * panR * 1.4142f;
    }
}

juce::AudioProcessorEditor* VAUtilityProcessor::createEditor()
{
    return new VirgoGenericEditor(*this, apvts, "VA Utility");
}

void VAUtilityProcessor::initPresets()
{
    mPresets = {
        { "Default",       { {"gain",0},{"pan",0},{"width",1},{"drive",0} } },
        { "Wide & Warm",   { {"gain",0},{"pan",0},{"width",1.4f},{"drive",0.25f} } },
        { "Mono Check",    { {"gain",0},{"pan",0},{"width",0},{"drive",0} } },
        { "Hot Drive",     { {"gain",3},{"pan",0},{"width",1.1f},{"drive",0.6f} } },
    };
}

void VAUtilityProcessor::setCurrentProgram(int index)
{
    if (index >= 0 && index < (int)mPresets.size()) {
        mCurrentProgram = index;
        applyPreset(apvts, mPresets[index].params);
    }
}
const juce::String VAUtilityProcessor::getProgramName(int i)
{
    return (i >= 0 && i < (int)mPresets.size()) ? mPresets[i].name : "";
}
void VAUtilityProcessor::getStateInformation(juce::MemoryBlock& d) { saveState(apvts, d); }
void VAUtilityProcessor::setStateInformation(const void* d, int s) { loadState(apvts, d, s); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VAUtilityProcessor(); }
