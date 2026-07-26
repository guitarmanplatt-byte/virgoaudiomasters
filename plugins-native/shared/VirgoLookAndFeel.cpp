#include "VirgoLookAndFeel.h"

VirgoLookAndFeel::VirgoLookAndFeel()
{
    // Use Inter-style system font (sans-serif fallback)
    mFont = juce::Font(juce::Font::getDefaultSansSerifFontName(), 12.0f, juce::Font::plain);

    // Base colour scheme
    setColour(juce::ResizableWindow::backgroundColourId, bg());
    setColour(juce::DocumentWindow::backgroundColourId,  bg());

    setColour(juce::Slider::backgroundColourId,          juce::Colour(kTrack));
    setColour(juce::Slider::thumbColourId,               gold());
    setColour(juce::Slider::trackColourId,               gold());
    setColour(juce::Slider::rotarySliderOutlineColourId, juce::Colour(kTrack));
    setColour(juce::Slider::rotarySliderFillColourId,    gold());
    setColour(juce::Slider::textBoxTextColourId,         text());
    setColour(juce::Slider::textBoxBackgroundColourId,   surface());
    setColour(juce::Slider::textBoxOutlineColourId,      border());
    setColour(juce::Slider::textBoxHighlightColourId,    gold().withAlpha(0.4f));

    setColour(juce::Label::textColourId,                 text());
    setColour(juce::Label::backgroundColourId,           juce::Colours::transparentBlack);

    setColour(juce::TextButton::buttonColourId,          surface());
    setColour(juce::TextButton::buttonOnColourId,        gold().withAlpha(0.25f));
    setColour(juce::TextButton::textColourOffId,         muted());
    setColour(juce::TextButton::textColourOnId,          gold());

    setColour(juce::ComboBox::backgroundColourId,        surface());
    setColour(juce::ComboBox::outlineColourId,           border());
    setColour(juce::ComboBox::textColourId,              text());
    setColour(juce::ComboBox::arrowColourId,             gold());
    setColour(juce::PopupMenu::backgroundColourId,       juce::Colour(0xFF1A1A1A));
    setColour(juce::PopupMenu::textColourId,             text());
    setColour(juce::PopupMenu::highlightedBackgroundColourId, gold().withAlpha(0.25f));
    setColour(juce::PopupMenu::highlightedTextColourId,  gold());
}

void VirgoLookAndFeel::drawRotarySlider(
    juce::Graphics& g,
    int x, int y, int width, int height,
    float sliderPos,
    float startAngle, float endAngle,
    juce::Slider& /*slider*/)
{
    const float cx = x + width  * 0.5f;
    const float cy = y + height * 0.5f;
    const float radius   = std::min(width, height) * 0.5f - 4.0f;
    const float trackW   = radius * 0.18f;
    const float thumbR   = radius * 0.22f;
    const float angle    = startAngle + sliderPos * (endAngle - startAngle);

    // Track arc
    {
        juce::Path track;
        track.addCentredArc(cx, cy, radius - trackW * 0.5f, radius - trackW * 0.5f,
                            0.0f, startAngle, endAngle, true);
        g.setColour(juce::Colour(kTrack));
        g.strokePath(track, juce::PathStrokeType(trackW, juce::PathStrokeType::curved,
                                                          juce::PathStrokeType::rounded));
    }

    // Value arc (gold)
    {
        juce::Path arc;
        arc.addCentredArc(cx, cy, radius - trackW * 0.5f, radius - trackW * 0.5f,
                          0.0f, startAngle, angle, true);
        g.setColour(gold());
        g.strokePath(arc, juce::PathStrokeType(trackW, juce::PathStrokeType::curved,
                                                        juce::PathStrokeType::rounded));
    }

    // Thumb dot
    const float tx = cx + std::cos(angle - juce::MathConstants<float>::halfPi) * (radius - trackW);
    const float ty = cy + std::sin(angle - juce::MathConstants<float>::halfPi) * (radius - trackW);
    g.setColour(bg());
    g.fillEllipse(tx - thumbR, ty - thumbR, thumbR * 2.0f, thumbR * 2.0f);
    g.setColour(gold());
    g.drawEllipse(tx - thumbR, ty - thumbR, thumbR * 2.0f, thumbR * 2.0f, 1.5f);
}

void VirgoLookAndFeel::drawLinearSlider(
    juce::Graphics& g,
    int x, int y, int width, int height,
    float sliderPos, float /*minSliderPos*/, float /*maxSliderPos*/,
    juce::Slider::SliderStyle style, juce::Slider& slider)
{
    if (style == juce::Slider::LinearVertical)
    {
        const float cx = x + width * 0.5f;
        const float trackH = (float)height;
        const float trackW = 4.0f;
        // track
        g.setColour(juce::Colour(kTrack));
        g.fillRoundedRectangle(cx - trackW * 0.5f, (float)y, trackW, trackH, 2.0f);
        // filled portion
        g.setColour(gold());
        g.fillRoundedRectangle(cx - trackW * 0.5f, sliderPos, trackW,
                               (float)y + trackH - sliderPos, 2.0f);
        // thumb
        g.setColour(gold());
        g.fillEllipse(cx - 7.0f, sliderPos - 7.0f, 14.0f, 14.0f);
    }
    else
    {
        LookAndFeel_V4::drawLinearSlider(g, x, y, width, height,
                                         sliderPos, 0, 0, style, slider);
    }
}

juce::Font VirgoLookAndFeel::getLabelFont(juce::Label&) { return mFont; }

void VirgoLookAndFeel::drawLabel(juce::Graphics& g, juce::Label& label)
{
    g.setColour(label.findColour(juce::Label::backgroundColourId));
    g.fillRect(label.getLocalBounds());
    g.setColour(label.findColour(juce::Label::textColourId).withAlpha(
        label.isEnabled() ? 1.0f : 0.4f));
    g.setFont(getLabelFont(label));
    g.drawFittedText(label.getText(), label.getLocalBounds().reduced(2),
                     label.getJustificationType(), 1, 1.0f);
}

void VirgoLookAndFeel::drawButtonBackground(
    juce::Graphics& g, juce::Button& button,
    const juce::Colour& /*bg*/, bool isHighlighted, bool isDown)
{
    auto bounds = button.getLocalBounds().toFloat().reduced(0.5f);
    const bool isOn = button.getToggleState();
    juce::Colour fill = isOn ? gold().withAlpha(0.2f) : surface();
    if (isHighlighted) fill = fill.brighter(0.1f);
    if (isDown)        fill = fill.brighter(0.2f);
    g.setColour(fill);
    g.fillRoundedRectangle(bounds, 3.0f);
    g.setColour(isOn ? gold() : border());
    g.drawRoundedRectangle(bounds, 3.0f, 1.0f);
}

void VirgoLookAndFeel::drawComboBox(
    juce::Graphics& g, int width, int height,
    bool /*isButtonDown*/, int /*buttonX*/, int /*buttonY*/,
    int /*buttonW*/, int /*buttonH*/, juce::ComboBox& /*box*/)
{
    g.setColour(surface());
    g.fillRoundedRectangle(0.0f, 0.0f, (float)width, (float)height, 3.0f);
    g.setColour(border());
    g.drawRoundedRectangle(0.5f, 0.5f, width-1.0f, height-1.0f, 3.0f, 1.0f);
    // Arrow
    juce::Path arrow;
    const float ax = width - 14.0f, ay = height * 0.5f;
    arrow.addTriangle(ax - 3.5f, ay - 2.0f,
                      ax + 3.5f, ay - 2.0f,
                      ax,        ay + 3.0f);
    g.setColour(gold());
    g.fillPath(arrow);
}

juce::Font VirgoLookAndFeel::getComboBoxFont(juce::ComboBox&) { return mFont.withHeight(11.0f); }
juce::Font VirgoLookAndFeel::getPopupMenuFont() { return mFont.withHeight(12.0f); }
