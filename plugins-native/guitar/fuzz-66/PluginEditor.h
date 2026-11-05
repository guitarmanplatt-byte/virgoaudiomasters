#pragma once
#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

class VAFuzz66Editor final : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit VAFuzz66Editor(VAFuzz66Processor&);
    ~VAFuzz66Editor() override;
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    void timerCallback() override { repaint(); }
    class KnobStyle final : public juce::LookAndFeel_V4
    {
        void drawRotarySlider(juce::Graphics&, int, int, int, int, float, float, float, juce::Slider&) override;
    } style;
    VAFuzz66Processor& processor;
    juce::Slider tone, volume;
    juce::TextButton footswitch;
    juce::AudioProcessorValueTreeState::SliderAttachment toneAttachment, volumeAttachment;
    void label(juce::Graphics&, juce::String, juce::Rectangle<int>, float,
        juce::Colour, int flags = juce::Font::bold);
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VAFuzz66Editor)
};
