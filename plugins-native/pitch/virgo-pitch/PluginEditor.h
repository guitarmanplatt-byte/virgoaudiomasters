#pragma once
#include "PluginProcessor.h"
#include <juce_gui_basics/juce_gui_basics.h>

class VirgoPitchLook final : public juce::LookAndFeel_V4
{
public:
    VirgoPitchLook();
    void drawRotarySlider(juce::Graphics&, int, int, int, int, float, float, float, juce::Slider&) override;
};
class VirgoPitchEditor final : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit VirgoPitchEditor(VirgoPitchProcessor&);
    ~VirgoPitchEditor() override;
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    void timerCallback() override { repaint(); }
    using SliderAttachment = juce::AudioProcessorValueTreeState::SliderAttachment;
    using ComboAttachment = juce::AudioProcessorValueTreeState::ComboBoxAttachment;
    using ButtonAttachment = juce::AudioProcessorValueTreeState::ButtonAttachment;
    VirgoPitchProcessor& processor;
    VirgoPitchLook look;
    juce::ComboBox root, scale;
    std::array<juce::Slider, 4> knobs;
    std::array<juce::Label, 4> knobLabels;
    std::array<juce::ToggleButton, 2> voiceOn;
    std::array<juce::ComboBox, 2> voiceInterval;
    std::array<juce::Slider, 2> voiceLevel;
    juce::ToggleButton transients {"Protect transients"}, formants {"Preserve formants"};
    juce::TextButton bypass {"BYPASS"};
    juce::Slider mix, output;
    juce::Label mixLabel, outputLabel;
    std::vector<std::unique_ptr<SliderAttachment>> sliders;
    std::vector<std::unique_ptr<ComboAttachment>> combos;
    std::vector<std::unique_ptr<ButtonAttachment>> buttons;
    juce::TooltipWindow tooltips {this, 600};
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VirgoPitchEditor)
};
