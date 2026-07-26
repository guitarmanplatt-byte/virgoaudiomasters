#pragma once
#include <juce_gui_basics/juce_gui_basics.h>

/**
 * VirgoLookAndFeel
 *
 * Implements the VirgoAudioMasters black & gold visual theme:
 *   Background  #0F0F0F  (obsidian)
 *   Gold        #E8A030
 *   Surface     #161616
 *   Border      #2A2A2A
 *   Text        #E0E0E0
 */
class VirgoLookAndFeel : public juce::LookAndFeel_V4
{
public:
    // ── Brand palette ─────────────────────────────────────────────────────────
    static constexpr uint32_t kBackground = 0xFF0F0F0F;
    static constexpr uint32_t kSurface    = 0xFF161616;
    static constexpr uint32_t kBorder     = 0xFF2A2A2A;
    static constexpr uint32_t kGold       = 0xFFE8A030;
    static constexpr uint32_t kGoldDim    = 0xFF7A4A10;
    static constexpr uint32_t kText       = 0xFFE0E0E0;
    static constexpr uint32_t kMuted      = 0xFF606060;
    static constexpr uint32_t kTrack      = 0xFF2A2A2A;
    static constexpr uint32_t kRed        = 0xFFE04040;

    static juce::Colour bg()     { return juce::Colour(kBackground); }
    static juce::Colour gold()   { return juce::Colour(kGold); }
    static juce::Colour goldDim(){ return juce::Colour(kGoldDim); }
    static juce::Colour surface(){ return juce::Colour(kSurface); }
    static juce::Colour border() { return juce::Colour(kBorder); }
    static juce::Colour text()   { return juce::Colour(kText); }
    static juce::Colour muted()  { return juce::Colour(kMuted); }
    static juce::Colour red()    { return juce::Colour(kRed); }

    VirgoLookAndFeel();

    // ── Overrides ─────────────────────────────────────────────────────────────
    void drawRotarySlider(juce::Graphics& g,
                          int x, int y, int width, int height,
                          float sliderPosProportional,
                          float rotaryStartAngle,
                          float rotaryEndAngle,
                          juce::Slider& slider) override;

    void drawLinearSlider(juce::Graphics& g,
                          int x, int y, int width, int height,
                          float sliderPos, float minSliderPos, float maxSliderPos,
                          juce::Slider::SliderStyle style,
                          juce::Slider& slider) override;

    juce::Font getLabelFont(juce::Label& label) override;

    void drawLabel(juce::Graphics& g, juce::Label& label) override;

    void drawButtonBackground(juce::Graphics& g,
                              juce::Button& button,
                              const juce::Colour& backgroundColour,
                              bool shouldDrawButtonAsHighlighted,
                              bool shouldDrawButtonAsDown) override;

    void drawComboBox(juce::Graphics& g, int width, int height,
                      bool isButtonDown, int buttonX, int buttonY,
                      int buttonW, int buttonH,
                      juce::ComboBox& box) override;

    juce::Font getComboBoxFont(juce::ComboBox&) override;
    juce::Font getPopupMenuFont() override;

private:
    juce::Font mFont;
};
