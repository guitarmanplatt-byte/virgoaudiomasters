#include "PluginEditor.h"

namespace
{
const juce::Colour gold {0xffd4af55}, pale {0xffeee5ce}, muted {0xffaaa28e}, dark {0xff101112}, panel {0xff1c1c1b};
void text(juce::Graphics& g, juce::String value, juce::Rectangle<int> area,
          float size, juce::Colour colour, int alignment = juce::Justification::centredLeft, bool bold = false)
{
    g.setColour(colour); g.setFont(juce::Font(size, bold ? juce::Font::bold : juce::Font::plain));
    g.drawText(value, area, alignment, true);
}
}
VirgoPitchLook::VirgoPitchLook()
{
    setColour(juce::ComboBox::backgroundColourId, juce::Colour(0xff252522));
    setColour(juce::ComboBox::textColourId, pale);
    setColour(juce::ComboBox::outlineColourId, gold.withAlpha(0.4f));
    setColour(juce::PopupMenu::backgroundColourId, panel);
    setColour(juce::PopupMenu::textColourId, pale);
    setColour(juce::PopupMenu::highlightedBackgroundColourId, gold);
    setColour(juce::PopupMenu::highlightedTextColourId, dark);
    setColour(juce::Slider::thumbColourId, gold);
    setColour(juce::Slider::trackColourId, gold);
    setColour(juce::Slider::backgroundColourId, juce::Colour(0xff39372f));
    setColour(juce::Slider::textBoxTextColourId, pale);
    setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
    setColour(juce::ToggleButton::textColourId, pale);
    setColour(juce::ToggleButton::tickColourId, gold);
    setColour(juce::TextButton::buttonColourId, panel);
    setColour(juce::TextButton::buttonOnColourId, gold);
    setColour(juce::TextButton::textColourOffId, gold);
    setColour(juce::TextButton::textColourOnId, dark);
}
void VirgoPitchLook::drawRotarySlider(juce::Graphics& g, int x, int y, int width, int height,
    float position, float start, float end, juce::Slider&)
{
    auto area = juce::Rectangle<float>(static_cast<float>(x), static_cast<float>(y),
        static_cast<float>(width), static_cast<float>(height)).reduced(12);
    const float radius = std::min(area.getWidth(), area.getHeight()) * 0.5f - 5;
    const auto centre = area.getCentre();
    juce::Path track, active;
    track.addCentredArc(centre.x, centre.y, radius + 4, radius + 4, 0, start, end, true);
    active.addCentredArc(centre.x, centre.y, radius + 4, radius + 4, 0, start, start + (end - start) * position, true);
    g.setColour(juce::Colour(0xff38362e)); g.strokePath(track, juce::PathStrokeType(3));
    g.setColour(gold); g.strokePath(active, juce::PathStrokeType(3));
    const juce::Rectangle<float> knob(centre.x - radius, centre.y - radius, radius * 2, radius * 2);
    g.setGradientFill(juce::ColourGradient(juce::Colour(0xff4a4943), knob.getTopLeft(), dark, knob.getBottomRight(), false));
    g.fillEllipse(knob);
    g.setColour(gold.withAlpha(0.35f)); g.drawEllipse(knob, 1);
    const float angle = start + (end - start) * position;
    g.setColour(gold);
    g.drawLine(centre.x + std::sin(angle) * radius * 0.56f, centre.y - std::cos(angle) * radius * 0.56f,
               centre.x + std::sin(angle) * radius * 0.85f, centre.y - std::cos(angle) * radius * 0.85f, 3);
}
VirgoPitchEditor::VirgoPitchEditor(VirgoPitchProcessor& p) : AudioProcessorEditor(p), processor(p)
{
    setLookAndFeel(&look);
    setSize(1040, 740);
    root.addItemList({"C", "C# / Db", "D", "D# / Eb", "E", "F", "F# / Gb", "G", "G# / Ab", "A", "A# / Bb", "B"}, 1);
    scale.addItemList({"Major", "Natural minor", "Harmonic minor", "Melodic minor (ascending)", "Chromatic"}, 1);
    root.setName("Key root"); scale.setName("Scale");
    addAndMakeVisible(root); addAndMakeVisible(scale);
    combos.push_back(std::make_unique<ComboAttachment>(p.apvts, "root", root));
    combos.push_back(std::make_unique<ComboAttachment>(p.apvts, "scale", scale));
    const std::array<const char*, 4> ids {"amount", "speed", "tolerance", "maximum"};
    const std::array<const char*, 4> names {"CORRECTION", "RESPONSE", "NATURAL TOLERANCE", "MAXIMUM SHIFT"};
    const std::array<const char*, 4> suffix {" %", " ms", " ct", " ct"};
    const std::array<double, 4> defaults {85, 120, 12, 100};
    const std::array<const char*, 4> tips {
        "How strongly stable detected notes are moved toward the selected scale. Set to zero to disable correction.",
        "Slower response preserves more pitch movement. Fast settings can sound deliberate or synthetic.",
        "Notes already this close to the target are left alone, retaining small natural variations.",
        "Notes farther than this from a scale target are not corrected. Lower values protect intentional notes."};
    for (size_t i = 0; i < knobs.size(); ++i)
    {
        auto& knob = knobs[i];
        knob.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        knob.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 150, 25);
        knob.setTextValueSuffix(suffix[i]); knob.setNumDecimalPlacesToDisplay(0);
        knob.setDoubleClickReturnValue(true, defaults[i]); knob.setName(names[i]); knob.setTooltip(tips[i]);
        addAndMakeVisible(knob);
        sliders.push_back(std::make_unique<SliderAttachment>(p.apvts, ids[i], knob));
        auto& label = knobLabels[i];
        label.setText(names[i], juce::dontSendNotification);
        label.setFont(juce::Font(11.5f, juce::Font::bold)); label.setJustificationType(juce::Justification::centred);
        label.setColour(juce::Label::textColourId, muted); addAndMakeVisible(label);
    }
    for (int i = 0; i < 2; ++i)
    {
        const auto prefix = "voice" + juce::String(i + 1);
        voiceOn[static_cast<size_t>(i)].setButtonText("HARMONY " + juce::String(i + 1));
        voiceInterval[static_cast<size_t>(i)].addItemList(VirgoPitchProcessor::intervalNames(), 1);
        voiceInterval[static_cast<size_t>(i)].setName("Harmony " + juce::String(i + 1) + " interval");
        voiceInterval[static_cast<size_t>(i)].setTooltip("Fixed semitone interval from the corrected audio. Dissonant intervals are intentional and are not forced into the scale.");
        auto& level = voiceLevel[static_cast<size_t>(i)];
        level.setSliderStyle(juce::Slider::LinearHorizontal); level.setTextBoxStyle(juce::Slider::TextBoxRight, false, 75, 25);
        level.setTextValueSuffix(" dB"); level.setNumDecimalPlacesToDisplay(1);
        level.setName("Harmony " + juce::String(i + 1) + " level");
        addAndMakeVisible(voiceOn[static_cast<size_t>(i)]); addAndMakeVisible(voiceInterval[static_cast<size_t>(i)]); addAndMakeVisible(level);
        buttons.push_back(std::make_unique<ButtonAttachment>(p.apvts, prefix + "on", voiceOn[static_cast<size_t>(i)]));
        combos.push_back(std::make_unique<ComboAttachment>(p.apvts, prefix + "interval", voiceInterval[static_cast<size_t>(i)]));
        sliders.push_back(std::make_unique<SliderAttachment>(p.apvts, prefix + "level", level));
    }
    addAndMakeVisible(transients); addAndMakeVisible(formants); addAndMakeVisible(bypass);
    transients.setTooltip("Avoid correction during detected attacks. This reduces smearing but does not isolate drums from a full mix.");
    formants.setTooltip("Approximate spectral-envelope preservation. This is not vocal source separation or perfect formant reconstruction.");
    bypass.setClickingTogglesState(true);
    buttons.push_back(std::make_unique<ButtonAttachment>(p.apvts, "transients", transients));
    buttons.push_back(std::make_unique<ButtonAttachment>(p.apvts, "formants", formants));
    buttons.push_back(std::make_unique<ButtonAttachment>(p.apvts, "bypass", bypass));
    for (auto* slider : {&mix, &output})
    {
        slider->setSliderStyle(juce::Slider::LinearHorizontal);
        slider->setTextBoxStyle(juce::Slider::TextBoxRight, false, 75, 25);
        slider->setNumDecimalPlacesToDisplay(1); addAndMakeVisible(*slider);
    }
    mix.setName("Wet mix"); mix.setTextValueSuffix(" %");
    output.setName("Output level"); output.setTextValueSuffix(" dB");
    mixLabel.setText("MIX", juce::dontSendNotification); outputLabel.setText("OUTPUT", juce::dontSendNotification);
    for (auto* label : {&mixLabel, &outputLabel})
    { label->setColour(juce::Label::textColourId, muted); label->setFont(juce::Font(11, juce::Font::bold)); addAndMakeVisible(*label); }
    sliders.push_back(std::make_unique<SliderAttachment>(p.apvts, "mix", mix));
    sliders.push_back(std::make_unique<SliderAttachment>(p.apvts, "output", output));
    startTimerHz(20);
}
VirgoPitchEditor::~VirgoPitchEditor() { stopTimer(); setLookAndFeel(nullptr); }
void VirgoPitchEditor::resized()
{
    root.setBounds(45, 161, 155, 38); scale.setBounds(215, 161, 285, 38);
    transients.setBounds(550, 163, 200, 34); formants.setBounds(785, 163, 210, 34);
    for (int i = 0; i < 4; ++i)
    {
        const int x = 35 + i * 190;
        knobLabels[static_cast<size_t>(i)].setBounds(x, 238, 180, 24);
        knobs[static_cast<size_t>(i)].setBounds(x + 15, 270, 150, 155);
    }
    for (int i = 0; i < 2; ++i)
    {
        const int x = 45 + i * 500;
        voiceOn[static_cast<size_t>(i)].setBounds(x, 467, 180, 28);
        voiceInterval[static_cast<size_t>(i)].setBounds(x, 508, 445, 35);
        voiceLevel[static_cast<size_t>(i)].setBounds(x, 558, 445, 28);
    }
    mixLabel.setBounds(45, 628, 45, 28); mix.setBounds(90, 626, 285, 32);
    outputLabel.setBounds(405, 628, 65, 28); output.setBounds(470, 626, 285, 32);
    bypass.setBounds(810, 624, 180, 38);
}
void VirgoPitchEditor::paint(juce::Graphics& g)
{
    g.fillAll(dark);
    g.setGradientFill(juce::ColourGradient(juce::Colour(0xff3b321b), 520, -200, dark, 520, 490, true));
    g.fillRect(getLocalBounds());
    g.setColour(gold.withAlpha(0.3f)); g.drawRect(getLocalBounds().reduced(12), 1);
    text(g, "VIRGO AUDIO MASTERS", {40, 29, 650, 22}, 13, gold, juce::Justification::centredLeft, true);
    text(g, "VIRGO PITCH", {38, 55, 650, 53}, 38, pale, juce::Justification::centredLeft, true);
    text(g, "POLYPHONIC CORRECTION  /  OCTAVES  /  DISSONANT HARMONIES", {42, 110, 730, 20}, 11, muted);
    g.setColour(gold.withAlpha(0.2f)); g.drawHorizontalLine(142, 35, 1005);
    text(g, "PREVIEW", {842, 38, 150, 22}, 12, gold, juce::Justification::centredRight, true);
    const auto milliseconds = 1000.0 * processor.getLatencySamples() / std::max(1.0, processor.getSampleRate());
    text(g, juce::String(milliseconds, 1) + " ms compensated latency", {755, 77, 240, 24}, 12, muted, juce::Justification::centredRight);
    g.setColour(panel); g.fillRoundedRectangle(35, 224, 970, 208, 8);
    g.setColour(gold.withAlpha(0.1f)); g.drawRoundedRectangle(35, 224, 970, 208, 8, 1);
    text(g, "DETECTED TONAL ENERGY", {818, 244, 170, 22}, 10, muted);
    text(g, "CORRECTION ACTIVITY", {818, 310, 170, 22}, 10, muted);
    for (int i = 0; i < 2; ++i)
    {
        const float value = i == 0 ? processor.confidence.load() : processor.activity.load();
        g.setColour(juce::Colour(0xff34332c)); g.fillRoundedRectangle(820, static_cast<float>(278 + 66 * i), 155, 9, 4);
        g.setColour(gold); g.fillRoundedRectangle(820, static_cast<float>(278 + 66 * i), std::max(0.1f, 155 * juce::jlimit(0.0f, 1.0f, value)), 9, 4);
    }
    text(g, "IN " + juce::String(juce::Decibels::gainToDecibels(processor.inputMeter.load(), -90.0f), 1) + " dB",
         {818, 373, 165, 20}, 11, muted);
    text(g, "OUT " + juce::String(juce::Decibels::gainToDecibels(processor.outputMeter.load(), -90.0f), 1) + " dB",
         {818, 394, 165, 20}, 11, processor.outputMeter.load() > 1 ? juce::Colour(0xfff08068) : muted);
    for (int i = 0; i < 2; ++i)
    {
        g.setColour(panel); g.fillRoundedRectangle(static_cast<float>(35 + i * 500), 451, 470, 153, 8);
        g.setColour(gold.withAlpha(0.15f)); g.drawRoundedRectangle(static_cast<float>(35 + i * 500), 451, 470, 153, 8, 1);
        text(g, "FIXED INTERVAL", {310 + i * 500, 470, 180, 20}, 10, muted, juce::Justification::centredRight);
    }
    g.setColour(gold.withAlpha(0.2f)); g.drawHorizontalLine(685, 35, 1005);
    text(g, "Full-mix preview: overlapping notes may be ambiguous. Use gentle settings; isolated stems give better results.",
         {40, 693, 960, 25}, 11, muted, juce::Justification::centred);
}
