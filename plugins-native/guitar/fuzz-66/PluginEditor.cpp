#include "PluginEditor.h"

namespace
{
const juce::Colour gold(0xffd1ae62), ink(0xff171714);
}
void VAFuzz66Editor::KnobStyle::drawRotarySlider(juce::Graphics& g, int x, int y, int w, int h,
    float position, float start, float end, juce::Slider&)
{
    auto bounds = juce::Rectangle<float>(static_cast<float>(x), static_cast<float>(y),
        static_cast<float>(w), static_cast<float>(h)).reduced(11);
    const auto centre = bounds.getCentre();
    const auto radius = std::min(bounds.getWidth(), bounds.getHeight()) / 2;
    juce::ColourGradient metal(juce::Colour(0xff777369), centre.x, bounds.getY(),
        juce::Colour(0xff171715), centre.x, bounds.getBottom(), false);
    g.setColour(juce::Colours::black.withAlpha(0.5f)); g.fillEllipse(bounds.translated(3, 6));
    g.setGradientFill(metal); g.fillEllipse(bounds);
    g.setColour(juce::Colour(0xffb4aa92)); g.drawEllipse(bounds, 1);
    for (int i = 0; i < 50; ++i)
    {
        const auto angle = i * juce::MathConstants<float>::twoPi / 50;
        g.setColour(i % 2 ? juce::Colour(0xff0c0c0b) : juce::Colour(0xff8a8375));
        const auto a = centre + juce::Point<float>(std::sin(angle), -std::cos(angle)) * (radius - 1);
        const auto b = centre + juce::Point<float>(std::sin(angle), -std::cos(angle)) * (radius - 7);
        g.drawLine({a, b}, 1);
    }
    auto cap = bounds.reduced(8);
    g.setColour(juce::Colour(0xff242421)); g.fillEllipse(cap);
    g.setColour(juce::Colour(0xff45443b)); g.drawEllipse(cap, 1);
    const auto angle = start + position * (end - start);
    g.setColour(gold);
    g.drawLine({centre + juce::Point<float>(std::sin(angle), -std::cos(angle)) * (radius * 0.40f),
        centre + juce::Point<float>(std::sin(angle), -std::cos(angle)) * (radius * 0.78f)}, 3);
}
VAFuzz66Editor::VAFuzz66Editor(VAFuzz66Processor& p)
    : AudioProcessorEditor(p), processor(p),
      toneAttachment(p.apvts, "tone", tone), volumeAttachment(p.apvts, "volume", volume)
{
    setOpaque(true); setSize(900, 740); setLookAndFeel(&style);
    for (auto* knob : {&volume, &tone})
    {
        addAndMakeVisible(knob);
        knob->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        knob->setTextBoxStyle(juce::Slider::TextBoxBelow, false, 74, 20);
        knob->setColour(juce::Slider::textBoxTextColourId, gold);
        knob->setColour(juce::Slider::textBoxBackgroundColourId, juce::Colours::transparentBlack);
        knob->setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
        knob->setTextValueSuffix(" %");
        knob->setDoubleClickReturnValue(true, knob == &tone ? 75 : 70);
    }
    tone.setName("Tone"); volume.setName("Volume");
    tone.setTooltip("Blends the opposing transistor stages, like the original Depth control. Double-click: 75%.");
    volume.setTooltip("Pedal output volume. Double-click: 70%.");
    addAndMakeVisible(footswitch);
    footswitch.setName("Toggle fuzz bypass");
    footswitch.setTooltip("Click the footswitch to enable or bypass the fuzz.");
    footswitch.setAlpha(0.0f);
    footswitch.onClick = [this]
    {
        auto* parameter = processor.apvts.getParameter("bypass");
        parameter->beginChangeGesture();
        parameter->setValueNotifyingHost(parameter->getValue() > 0.5f ? 0 : 1);
        parameter->endChangeGesture();
        repaint();
    };
    startTimerHz(15);
}
VAFuzz66Editor::~VAFuzz66Editor() { stopTimer(); setLookAndFeel(nullptr); }
void VAFuzz66Editor::resized()
{
    volume.setBounds(285, 116, 114, 120);
    tone.setBounds(501, 116, 114, 120);
    footswitch.setBounds(411, 471, 78, 78);
}
void VAFuzz66Editor::label(juce::Graphics& g, juce::String text, juce::Rectangle<int> bounds,
    float size, juce::Colour colour, int flags)
{
    g.setColour(colour); g.setFont(juce::Font(size, flags));
    g.drawText(text, bounds, juce::Justification::centred);
}
void VAFuzz66Editor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff0c0d0e));
    juce::ColourGradient glow(juce::Colour(0xff54421e), 450, 250, juce::Colour(0xff101112), 900, 650, true);
    g.setGradientFill(glow); g.fillRect(getLocalBounds());
    g.setColour(gold.withAlpha(0.3f)); g.drawRect(getLocalBounds().reduced(18), 1);
    g.drawHorizontalLine(90, 40, 860); g.drawHorizontalLine(678, 40, 860);
    label(g, "VIRGO AUDIO MASTERS", {40, 30, 820, 27}, 19, gold);
    label(g, "F U Z Z   6 6", {40, 60, 820, 19}, 13, juce::Colour(0xffe4d8ba));

    juce::Path shadow; shadow.addRoundedRectangle(265, 192, 380, 453, 9);
    juce::DropShadow(juce::Colours::black.withAlpha(0.7f), 22, {10, 15}).drawForPath(g, shadow);
    // Sloped folded-metal enclosure, like the compact 1960s pedal housing.
    juce::Path body; body.startNewSubPath(259, 210); body.lineTo(641, 210);
    body.lineTo(617, 641); body.lineTo(283, 641); body.closeSubPath();
    juce::ColourGradient aluminium(juce::Colour(0xffb6b4a4), 260, 200,
        juce::Colour(0xffdedbc9), 615, 590, false);
    aluminium.addColour(0.32, juce::Colour(0xffe0ddce));
    aluminium.addColour(0.7, juce::Colour(0xffa5a394));
    g.setGradientFill(aluminium); g.fillPath(body);
    g.setColour(juce::Colour(0xff5c5b50)); g.strokePath(body, juce::PathStrokeType(2));
    {
        juce::Graphics::ScopedSaveState state(g);
        g.reduceClipRegion(body);
        for (int i = 260; i < 642; ++i)
        {
            const float alpha = static_cast<float>((i * 37) % 11) / 300;
            g.setColour(i % 2 ? juce::Colours::black.withAlpha(alpha) : juce::Colours::white.withAlpha(alpha * 2));
            g.drawVerticalLine(i, 210, 642);
        }
    }
    label(g, "VOLUME", {281, 240, 130, 27}, 22, ink);
    label(g, "TONE", {490, 240, 130, 27}, 22, ink);
    label(g, "AMP.", {283, 294, 104, 24}, 19, ink);
    label(g, "INST.", {516, 294, 104, 24}, 19, ink);
    label(g, "FUZZ 66", {280, 344, 340, 58}, 49, ink);
    label(g, "BY", {300, 404, 300, 18}, 14, ink);
    label(g, "Virgo", {301, 426, 298, 40}, 34, ink, juce::Font::italic | juce::Font::bold);
    label(g, "AUDIO MASTERS", {300, 460, 300, 17}, 11, ink);

    const auto active = processor.apvts.getRawParameterValue("bypass")->load() < 0.5f;
    g.setColour(juce::Colour(0xff5d5d53)); g.fillEllipse(418, 480, 64, 64);
    g.setColour(juce::Colour(0xffdedbcd)); g.fillEllipse(425, 487, 50, 50);
    g.setColour(juce::Colour(0xff292a26)); g.fillEllipse(431, 493, 38, 38);
    g.setColour(juce::Colour(0xffaaa99a)); g.drawEllipse(431, 493, 38, 38, 2);
    label(g, active ? "ON" : "OFF", {309, 558, 90, 25}, 23, ink);
    label(g, "SILICON / 1968", {309, 591, 280, 20}, 13, ink);
    g.setColour(active ? gold : juce::Colour(0xff393a34)); g.fillEllipse(515, 566, 9, 9);
    label(g, "TWO TRANSISTORS. RAW SIXTIES FUZZ.", {40, 692, 820, 18}, 11, gold);
    label(g, "Independent vintage-inspired model  /  Not affiliated with Mosrite", {40, 714, 820, 14},
        10, juce::Colour(0xffb5ad99), juce::Font::plain);
}
