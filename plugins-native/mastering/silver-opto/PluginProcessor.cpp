#include "PluginProcessor.h"

#include <juce_audio_utils/juce_audio_utils.h>

#include <cmath>
#include <memory>

namespace
{
    void applyPreset(juce::AudioProcessorValueTreeState& apvts,
                     const std::map<juce::String, float>& params)
    {
        for (const auto& [id, value] : params)
            if (auto* parameter = apvts.getParameter(id))
                parameter->setValueNotifyingHost(parameter->convertTo0to1(value));
    }

    void saveState(juce::AudioProcessorValueTreeState& apvts, juce::MemoryBlock& dest)
    {
        auto state = apvts.copyState();
        if (auto xml = state.createXml())
            juce::AudioProcessor::copyXmlToBinary(*xml, dest);
    }

    void loadState(juce::AudioProcessorValueTreeState& apvts,
                   const void* data,
                   int size)
    {
        if (auto xml = juce::AudioProcessor::getXmlFromBinary(data, size))
            if (xml->hasTagName(apvts.state.getType()))
                apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }

    float tubeStage(float sample) noexcept
    {
        // Unity slope at zero, with a restrained soft asymmetry-free tube curve.
        constexpr float drive = 1.2f;
        return 0.90f * sample + 0.10f * std::tanh(drive * sample) / drive;
    }

    class SilverOptoLookAndFeel : public juce::LookAndFeel_V4
    {
    public:
        SilverOptoLookAndFeel()
        {
            setColour(juce::Slider::textBoxTextColourId, juce::Colour(0xff191919));
            setColour(juce::Slider::textBoxBackgroundColourId, juce::Colour(0xffd8d8d2));
            setColour(juce::Slider::textBoxOutlineColourId, juce::Colour(0xff666662));
            setColour(juce::ComboBox::backgroundColourId, juce::Colour(0xffd8d8d2));
            setColour(juce::ComboBox::outlineColourId, juce::Colour(0xff555550));
            setColour(juce::ComboBox::textColourId, juce::Colour(0xff171717));
            setColour(juce::ComboBox::arrowColourId, juce::Colour(0xff222222));
            setColour(juce::Label::textColourId, juce::Colour(0xff191919));
        }

        void drawRotarySlider(juce::Graphics& g,
                              int x, int y, int width, int height,
                              float sliderPos,
                              float startAngle, float endAngle,
                              juce::Slider&) override
        {
            const auto bounds = juce::Rectangle<float>((float) x, (float) y,
                                                        (float) width, (float) height)
                                    .reduced(10.0f);
            const float radius = juce::jmin(bounds.getWidth(), bounds.getHeight()) * 0.5f;
            const float cx = bounds.getCentreX();
            const float cy = bounds.getCentreY();
            const float angle = startAngle + sliderPos * (endAngle - startAngle);

            g.setColour(juce::Colour(0x22000000));
            g.fillEllipse(bounds.translated(2.0f, 3.0f));

            juce::ColourGradient face(juce::Colour(0xff3d3d3b), cx, bounds.getY(),
                                      juce::Colour(0xff111111), cx, bounds.getBottom(), false);
            g.setGradientFill(face);
            g.fillEllipse(bounds);

            g.setColour(juce::Colour(0xff888881));
            g.drawEllipse(bounds, 1.5f);
            g.setColour(juce::Colour(0xffc8c8c0));
            g.drawEllipse(bounds.reduced(4.0f), 1.0f);

            const float indicatorLength = radius * 0.60f;
            const juce::Point<float> centre(cx, cy);
            const juce::Point<float> tip(cx + std::cos(angle - juce::MathConstants<float>::halfPi) * indicatorLength,
                                         cy + std::sin(angle - juce::MathConstants<float>::halfPi) * indicatorLength);
            g.setColour(juce::Colour(0xffddddcf));
            g.drawLine(centre.x, centre.y, tip.x, tip.y, 3.0f);
            g.fillEllipse(cx - 3.0f, cy - 3.0f, 6.0f, 6.0f);
        }

        void drawComboBox(juce::Graphics& g, int width, int height,
                          bool, int, int, int, int, juce::ComboBox&) override
        {
            g.setColour(juce::Colour(0xffd8d8d2));
            g.fillRoundedRectangle(0.0f, 0.0f, (float) width, (float) height, 2.0f);
            g.setColour(juce::Colour(0xff555550));
            g.drawRoundedRectangle(0.5f, 0.5f, (float) width - 1.0f,
                                   (float) height - 1.0f, 2.0f, 1.0f);

            juce::Path arrow;
            const float ax = (float) width - 15.0f;
            const float ay = (float) height * 0.5f;
            arrow.addTriangle(ax - 4.0f, ay - 2.0f, ax + 4.0f, ay - 2.0f, ax, ay + 3.0f);
            g.setColour(juce::Colour(0xff222222));
            g.fillPath(arrow);
        }

        juce::Font getComboBoxFont(juce::ComboBox&) override
        {
            return juce::Font(juce::Font::getDefaultSansSerifFontName(), 11.0f, juce::Font::bold);
        }
    };

    class VASilverOptoEditor final : public juce::AudioProcessorEditor,
                                      private juce::Timer,
                                      private juce::ComboBox::Listener
    {
    public:
        explicit VASilverOptoEditor(VASilverOptoProcessor& processor)
            : juce::AudioProcessorEditor(processor),
              mProcessor(processor),
              mGainAttachment(processor.apvts, "gain", mGain),
              mPeakReductionAttachment(processor.apvts, "peakReduction", mPeakReduction)
        {
            setLookAndFeel(&mLookAndFeel);
            setOpaque(true);
            setSize(760, 460);

            configureKnob(mGain, " %");
            configureKnob(mPeakReduction, " %");

            mModeBox.addItem("COMPRESS", 1);
            mModeBox.addItem("LIMIT", 2);
            mModeBox.setJustificationType(juce::Justification::centred);
            mMeterBox.addItem("GAIN REDUCTION", 1);
            mMeterBox.addItem("OUTPUT LEVEL", 2);
            mMeterBox.setJustificationType(juce::Justification::centred);
            mModeAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
                processor.apvts, "mode", mModeBox);
            mMeterAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
                processor.apvts, "meter", mMeterBox);

            mPresetBox.addItem("-- FACTORY PRESETS --", 1);
            for (int i = 0; i < processor.getNumPrograms(); ++i)
                mPresetBox.addItem(processor.getProgramName(i), i + 2);
            mPresetBox.setSelectedId(processor.getCurrentProgram() + 2, juce::dontSendNotification);
            mPresetBox.addListener(this);

            addAndMakeVisible(mGain);
            addAndMakeVisible(mPeakReduction);
            addAndMakeVisible(mModeBox);
            addAndMakeVisible(mMeterBox);
            addAndMakeVisible(mPresetBox);
            startTimerHz(30);
        }

        ~VASilverOptoEditor() override
        {
            stopTimer();
            mPresetBox.removeListener(this);
            setLookAndFeel(nullptr);
        }

        void paint(juce::Graphics& g) override
        {
            const auto panel = getLocalBounds().toFloat();
            juce::ColourGradient background(juce::Colour(0xffb7b7b2), 0.0f, 0.0f,
                                            juce::Colour(0xffeeeeea), 0.0f, (float) getHeight(), false);
            g.setGradientFill(background);
            g.fillAll();

            g.setColour(juce::Colour(0x28000000));
            g.fillRoundedRectangle(panel.reduced(8.0f).translated(0.0f, 2.0f), 5.0f);
            g.setColour(juce::Colour(0xffd7d7d1));
            g.fillRoundedRectangle(panel.reduced(8.0f), 5.0f);
            g.setColour(juce::Colour(0xff383835));
            g.drawRoundedRectangle(panel.reduced(8.0f), 5.0f, 1.0f);

            g.setColour(juce::Colour(0xff20201f));
            g.fillRoundedRectangle(20.0f, 18.0f, 720.0f, 58.0f, 3.0f);
            g.setColour(juce::Colour(0xffdeded5));
            g.setFont(juce::Font(juce::Font::getDefaultSansSerifFontName(), 22.0f, juce::Font::bold));
            g.drawText("VA SILVER OPTO", 38, 21, 300, 28, juce::Justification::centredLeft);
            g.setColour(juce::Colour(0xffa9a99f));
            g.setFont(juce::Font(juce::Font::getDefaultSansSerifFontName(), 9.0f, juce::Font::plain));
            g.drawText("OPTICAL LEVELING AMPLIFIER  /  TUBE CHARACTER", 40, 49, 360, 18,
                       juce::Justification::centredLeft);
            g.setColour(juce::Colour(0xffc4a35a));
            g.drawText("VIRGO AUDIO MASTERS", 558, 34, 150, 18, juce::Justification::centredRight);

            for (const auto point : { juce::Point<float>(31.0f, 29.0f), juce::Point<float>(729.0f, 29.0f),
                                      juce::Point<float>(31.0f, 65.0f), juce::Point<float>(729.0f, 65.0f) })
            {
                g.setColour(juce::Colour(0xff777770));
                g.fillEllipse(point.x - 2.5f, point.y - 2.5f, 5.0f, 5.0f);
                g.setColour(juce::Colour(0xffeeeeea));
                g.fillEllipse(point.x - 1.0f, point.y - 1.0f, 2.0f, 2.0f);
            }

            g.setColour(juce::Colour(0xff252524));
            g.fillRoundedRectangle(500.0f, 96.0f, 220.0f, 225.0f, 3.0f);
            g.setColour(juce::Colour(0xff8c8c85));
            g.drawRoundedRectangle(500.0f, 96.0f, 220.0f, 225.0f, 3.0f, 1.0f);

            g.setColour(juce::Colour(0xffc4a35a));
            g.setFont(juce::Font(juce::Font::getDefaultSansSerifFontName(), 10.0f, juce::Font::bold));
            g.drawText("VU / GAIN REDUCTION", 515, 100, 190, 18, juce::Justification::centred);

            const float meterDb = mMeterBox.getSelectedId() == 2
                                      ? mProcessor.getOutputMeterDb()
                                      : mProcessor.getGainReductionDb();
            const bool gainReduction = mMeterBox.getSelectedId() != 2;
            const auto meter = juce::Rectangle<float>(565.0f, 135.0f, 90.0f, 145.0f);
            g.setColour(juce::Colour(0xff101010));
            g.fillRoundedRectangle(meter, 2.0f);
            g.setColour(juce::Colour(0xff686861));
            g.drawRoundedRectangle(meter, 2.0f, 1.0f);

            const float normalized = gainReduction
                ? juce::jlimit(0.0f, 1.0f, -meterDb / 40.0f)
                : juce::jlimit(0.0f, 1.0f, juce::jmap(meterDb, -60.0f, 6.0f, 0.0f, 1.0f));
            const float fillHeight = normalized * (meter.getHeight() - 20.0f);
            juce::ColourGradient meterGradient(juce::Colour(0xffd9d7c7), meter.getX(), meter.getBottom(),
                                                juce::Colour(0xffba5142), meter.getRight(), meter.getY(), false);
            g.setGradientFill(meterGradient);
            g.fillRect(meter.getX() + 14.0f, meter.getBottom() - 12.0f - fillHeight,
                       meter.getWidth() - 28.0f, fillHeight);

            g.setColour(juce::Colour(0xffa7a79f));
            g.setFont(juce::Font(juce::Font::getDefaultSansSerifFontName(), 9.0f, juce::Font::plain));
            const auto scale = gainReduction ? juce::String("-") : juce::String("dB");
            g.drawText(scale + "0", 668, 138, 40, 16, juce::Justification::centredLeft);
            g.drawText(scale + "10", 668, 202, 40, 16, juce::Justification::centredLeft);
            g.drawText(scale + "20", 668, 266, 40, 16, juce::Justification::centredLeft);

            g.setColour(juce::Colour(0xffdeded5));
            g.setFont(juce::Font(juce::Font::getDefaultSansSerifFontName(), 12.0f, juce::Font::bold));
            const auto reading = gainReduction ? juce::String(-meterDb, 1) + " dB"
                                               : juce::String(meterDb, 1) + " dB";
            g.drawText(reading, 515, 286, 190, 22, juce::Justification::centred);
        }

        void resized() override
        {
            mGain.setBounds(75, 130, 190, 150);
            mPeakReduction.setBounds(285, 130, 190, 150);
            mModeBox.setBounds(515, 335, 95, 28);
            mMeterBox.setBounds(620, 335, 95, 28);
            mPresetBox.setBounds(28, 390, 704, 30);
        }

    private:
        void configureKnob(juce::Slider& slider, const juce::String& suffix)
        {
            slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
            slider.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 78, 22);
            slider.setTextValueSuffix(suffix);
            slider.setNumDecimalPlacesToDisplay(1);
            slider.setPopupDisplayEnabled(true, false, this);
        }

        void timerCallback() override { repaint(); }

        void comboBoxChanged(juce::ComboBox* box) override
        {
            if (box == &mPresetBox && mPresetBox.getSelectedId() >= 2)
                mProcessor.setCurrentProgram(mPresetBox.getSelectedId() - 2);
        }

        VASilverOptoProcessor& mProcessor;
        SilverOptoLookAndFeel mLookAndFeel;
        juce::Slider mGain;
        juce::Slider mPeakReduction;
        juce::ComboBox mModeBox;
        juce::ComboBox mMeterBox;
        juce::ComboBox mPresetBox;
        juce::AudioProcessorValueTreeState::SliderAttachment mGainAttachment;
        juce::AudioProcessorValueTreeState::SliderAttachment mPeakReductionAttachment;
        std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> mModeAttachment;
        std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> mMeterAttachment;
    };
}

VASilverOptoProcessor::VASilverOptoProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Params", createParameterLayout())
{
    initPresets();
}

juce::AudioProcessorValueTreeState::ParameterLayout
VASilverOptoProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"gain", 1}, "Gain", 0.0f, 100.0f, 50.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"peakReduction", 1}, "Peak Reduction", 0.0f, 100.0f, 0.0f));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"mode", 1}, "Mode", juce::StringArray{"Compress", "Limit"}, 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"meter", 1}, "Meter", juce::StringArray{"Gain Reduction", "Output Level"}, 0));
    return layout;
}

void VASilverOptoProcessor::prepareToPlay(double sampleRate, int)
{
    mSampleRate = sampleRate;
    mDetectorFilter.c = Virgo::calcBiquad(Virgo::FType::HighPass, 18.0f, 0.0f, 0.707f,
                                           static_cast<float>(sampleRate));
    mDetectorFilter.reset();
    mFastEnvelope = 0.0f;
    mSlowEnvelope = 0.0f;
    mGainReduction = 0.0f;
    mInputMeter = -80.0f;
    mOutputMeter = -80.0f;
    mGainReductionDb.store(0.0f);
    mInputMeterDb.store(-80.0f);
    mOutputMeterDb.store(-80.0f);
}

void VASilverOptoProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const int numSamples = buffer.getNumSamples();
    if (numSamples <= 0 || buffer.getNumChannels() == 0)
        return;

    auto* inL = buffer.getReadPointer(0);
    auto* inR = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    auto* outL = buffer.getWritePointer(0);
    auto* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;

    const float gain = *apvts.getRawParameterValue("gain");
    const float peakReduction = *apvts.getRawParameterValue("peakReduction");
    const bool limiting = *apvts.getRawParameterValue("mode") > 0.5f;

    // The large front-panel controls are intentionally broad, like a hardware
    // gain stage: 50% is unity output, with useful headroom either direction.
    const float outputGain = Virgo::dbToLin(-18.0f + gain * 0.36f);
    const float thresholdDb = -peakReduction * 0.45f;
    const float ratio = limiting ? 10.0f : 3.0f;
    const float attack = Virgo::envCoef(10.0f, static_cast<float>(mSampleRate));
    const float fastRelease = Virgo::envCoef(60.0f, static_cast<float>(mSampleRate));
    const float slowRelease = Virgo::envCoef(1000.0f, static_cast<float>(mSampleRate));
    const float gainRelease = Virgo::envCoef(120.0f, static_cast<float>(mSampleRate));
    const float meterDecayPerSample = 24.0f / static_cast<float>(mSampleRate);

    for (int i = 0; i < numSamples; ++i)
    {
        const float dryL = inL[i];
        const float dryR = inR[i];
        const float detectorL = mDetectorFilter.tickL(dryL);
        const float detectorR = mDetectorFilter.tickR(dryR);
        const float detector = 0.5f * (std::abs(detectorL) + std::abs(detectorR));

        if (detector > mFastEnvelope)
        {
            mFastEnvelope = attack * mFastEnvelope + (1.0f - attack) * detector;
            mSlowEnvelope = attack * mSlowEnvelope + (1.0f - attack) * detector;
        }
        else
        {
            mFastEnvelope = fastRelease * mFastEnvelope + (1.0f - fastRelease) * detector;
            mSlowEnvelope = slowRelease * mSlowEnvelope + (1.0f - slowRelease) * detector;
        }

        // The slow path contributes the long optical tail after the first
        // release, while the fast path keeps transients and pumping controlled.
        const float opticalLevel = std::max(mFastEnvelope, mSlowEnvelope * 0.50f);
        const float levelDb = Virgo::linToDb(opticalLevel);
        const float targetReduction = -Virgo::clampf(
            std::max(0.0f, levelDb - thresholdDb) * (1.0f - 1.0f / ratio),
            0.0f, 40.0f);
        const float reductionCoefficient = targetReduction < mGainReduction
            ? attack : gainRelease;
        mGainReduction = reductionCoefficient * mGainReduction
                       + (1.0f - reductionCoefficient) * targetReduction;

        const float compressedGain = outputGain * Virgo::dbToLin(mGainReduction);
        const float outSampleL = tubeStage(dryL * compressedGain);
        const float outSampleR = tubeStage(dryR * compressedGain);
        outL[i] = outSampleL;
        if (buffer.getNumChannels() > 1)
            outR[i] = outSampleR;

        mInputMeter = std::max(-80.0f,
            std::max(Virgo::linToDb(std::max(std::abs(dryL), std::abs(dryR))),
                     mInputMeter - meterDecayPerSample));
        mOutputMeter = std::max(-80.0f,
            std::max(Virgo::linToDb(std::max(std::abs(outSampleL), std::abs(outSampleR))),
                     mOutputMeter - meterDecayPerSample));
    }

    mInputMeterDb.store(mInputMeter);
    mOutputMeterDb.store(mOutputMeter);
    mGainReductionDb.store(mGainReduction);
}

juce::AudioProcessorEditor* VASilverOptoProcessor::createEditor()
{
    return new VASilverOptoEditor(*this);
}

void VASilverOptoProcessor::initPresets()
{
    mPresets = {
        { "Vocal Leveler", {{"gain", 50.0f}, {"peakReduction", 35.0f}, {"mode", 0.0f}, {"meter", 0.0f}} },
        { "Bass Glue",     {{"gain", 52.0f}, {"peakReduction", 45.0f}, {"mode", 0.0f}, {"meter", 0.0f}} },
        { "Drum Room",     {{"gain", 50.0f}, {"peakReduction", 60.0f}, {"mode", 1.0f}, {"meter", 0.0f}} },
        { "Mix Bus",       {{"gain", 54.0f}, {"peakReduction", 22.0f}, {"mode", 0.0f}, {"meter", 0.0f}} },
        { "Warm Level",    {{"gain", 58.0f}, {"peakReduction", 70.0f}, {"mode", 0.0f}, {"meter", 1.0f}} },
        { "Limit & Lift",   {{"gain", 55.0f}, {"peakReduction", 78.0f}, {"mode", 1.0f}, {"meter", 0.0f}} },
    };
}

void VASilverOptoProcessor::setCurrentProgram(int index)
{
    if (index >= 0 && index < static_cast<int>(mPresets.size()))
    {
        mCurrentProgram = index;
        applyPreset(apvts, mPresets[index].params);
    }
}

const juce::String VASilverOptoProcessor::getProgramName(int index)
{
    return index >= 0 && index < static_cast<int>(mPresets.size())
        ? mPresets[index].name : juce::String();
}

void VASilverOptoProcessor::getStateInformation(juce::MemoryBlock& dest)
{
    saveState(apvts, dest);
}

void VASilverOptoProcessor::setStateInformation(const void* data, int size)
{
    loadState(apvts, data, size);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new VASilverOptoProcessor();
}