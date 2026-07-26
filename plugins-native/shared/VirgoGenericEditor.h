#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include "VirgoLookAndFeel.h"

/**
 * VirgoGenericEditor
 *
 * APVTS-driven plugin editor used by every VA plugin.
 * Enumerates all parameters and lays out rotary sliders (knobs) in a grid,
 * each with a value label below and a parameter-name label above.
 *
 * Layout:
 *   - Title bar (48 px): plugin name (gold) + bypass button
 *   - Knob area: grid of knobs, 5 per row, each 90×90 px
 *   - Preset bar (36 px): ComboBox listing factory program names
 */
class VirgoGenericEditor : public juce::AudioProcessorEditor,
                           private juce::ComboBox::Listener
{
public:
    VirgoGenericEditor(juce::AudioProcessor& proc,
                       juce::AudioProcessorValueTreeState& apvts,
                       const juce::String& pluginName);
    ~VirgoGenericEditor() override;

    void paint(juce::Graphics& g) override;
    void resized() override;

private:
    void comboBoxChanged(juce::ComboBox* box) override;

    juce::AudioProcessor&                  mProcessor;
    juce::AudioProcessorValueTreeState&    mApvts;
    juce::String                           mPluginName;

    VirgoLookAndFeel mLnf;

    struct KnobGroup
    {
        std::unique_ptr<juce::Slider> slider;
        std::unique_ptr<juce::Label>  nameLabel;
        std::unique_ptr<juce::Label>  valueLabel;
        std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> attach;
    };

    std::vector<KnobGroup> mKnobs;
    std::unique_ptr<juce::ComboBox> mPresetBox;

    static constexpr int kTitleH  = 48;
    static constexpr int kPresetH = 36;
    static constexpr int kKnobW   = 90;
    static constexpr int kKnobH   = 90;
    static constexpr int kCols    = 5;
    static constexpr int kPad     = 12;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VirgoGenericEditor)
};
