#include "VirgoGenericEditor.h"

VirgoGenericEditor::VirgoGenericEditor(
    juce::AudioProcessor& proc,
    juce::AudioProcessorValueTreeState& apvts,
    const juce::String& pluginName)
    : juce::AudioProcessorEditor(proc),
      mProcessor(proc),
      mApvts(apvts),
      mPluginName(pluginName)
{
    setLookAndFeel(&mLnf);

    // Build one knob per APVTS parameter
    auto& paramList = apvts.processor.getParameters();
    for (auto* rawParam : paramList)
    {
        if (auto* param = dynamic_cast<juce::RangedAudioParameter*>(rawParam))
        {
            KnobGroup g;

            g.slider = std::make_unique<juce::Slider>(juce::Slider::RotaryVerticalDrag,
                                                      juce::Slider::TextBoxBelow);
            g.slider->setTextBoxStyle(juce::Slider::TextBoxBelow, false, kKnobW - 4, 18);
            g.slider->setPopupDisplayEnabled(true, false, this);

            g.nameLabel = std::make_unique<juce::Label>();
            g.nameLabel->setText(param->getName(32), juce::dontSendNotification);
            g.nameLabel->setFont(juce::Font(10.0f));
            g.nameLabel->setColour(juce::Label::textColourId, VirgoLookAndFeel::muted());
            g.nameLabel->setJustificationType(juce::Justification::centred);

            g.valueLabel = std::make_unique<juce::Label>();
            g.valueLabel->setFont(juce::Font(10.0f));
            g.valueLabel->setColour(juce::Label::textColourId, VirgoLookAndFeel::text());
            g.valueLabel->setJustificationType(juce::Justification::centred);

            g.attach = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
                apvts, param->getParameterID(), *g.slider);

            addAndMakeVisible(*g.slider);
            addAndMakeVisible(*g.nameLabel);
            addAndMakeVisible(*g.valueLabel);

            mKnobs.push_back(std::move(g));
        }
    }

    // Preset combo
    mPresetBox = std::make_unique<juce::ComboBox>("Presets");
    mPresetBox->addItem("-- Factory Presets --", 1);
    for (int i = 0; i < proc.getNumPrograms(); ++i)
        mPresetBox->addItem(proc.getProgramName(i), i + 2);
    mPresetBox->setSelectedId(proc.getCurrentProgram() + 2, juce::dontSendNotification);
    mPresetBox->addListener(this);
    addAndMakeVisible(*mPresetBox);

    // Calculate editor size
    const int numKnobs = (int)mKnobs.size();
    const int rows = (numKnobs + kCols - 1) / kCols;
    const int editorW = kPad * 2 + kCols * kKnobW + (kCols - 1) * kPad;
    const int editorH = kTitleH + kPad + rows * kKnobH + (rows - 1) * kPad + kPad + kPresetH + kPad;
    setSize(std::max(400, editorW), editorH);
}

VirgoGenericEditor::~VirgoGenericEditor()
{
    setLookAndFeel(nullptr);
}

void VirgoGenericEditor::paint(juce::Graphics& g)
{
    // Background
    g.fillAll(VirgoLookAndFeel::bg());

    // Title bar
    g.setColour(juce::Colour(0xFF111111));
    g.fillRect(0, 0, getWidth(), kTitleH);
    g.setColour(juce::Colour(VirgoLookAndFeel::kBorder));
    g.drawLine(0.0f, (float)kTitleH, (float)getWidth(), (float)kTitleH, 1.0f);

    // Plugin name
    g.setFont(juce::Font(juce::Font::getDefaultSansSerifFontName(), 18.0f, juce::Font::bold));
    // "Virgo" in white, rest in gold — simple approach: split on "VA "
    const auto name = mPluginName;
    const int idx = name.indexOfIgnoreCase("VA ");
    if (idx >= 0)
    {
        const juce::String prefix = name.substring(0, idx + 2);
        const juce::String rest   = name.substring(idx + 3);
        g.setColour(VirgoLookAndFeel::text());
        g.drawText(prefix + " ", 16, 0, 200, kTitleH, juce::Justification::centredLeft);
        const float pw = g.getCurrentFont().getStringWidthFloat(prefix + " ");
        g.setColour(VirgoLookAndFeel::gold());
        g.drawText(rest, 16 + (int)pw, 0, 200, kTitleH, juce::Justification::centredLeft);
    }
    else
    {
        g.setColour(VirgoLookAndFeel::gold());
        g.drawText(name, 16, 0, getWidth() - 32, kTitleH, juce::Justification::centredLeft);
    }
}

void VirgoGenericEditor::resized()
{
    const int W = getWidth();
    int y = kTitleH + kPad;
    int col = 0;
    int x = kPad;

    const int numCols = std::min(kCols, std::max(1, (W - kPad) / (kKnobW + kPad)));

    for (auto& kg : mKnobs)
    {
        kg.nameLabel->setBounds(x, y, kKnobW, 14);
        kg.slider->setBounds(x, y + 14, kKnobW, kKnobW - 14);

        ++col;
        if (col >= numCols)
        {
            col = 0;
            x = kPad;
            y += kKnobH + kPad;
        }
        else
        {
            x += kKnobW + kPad;
        }
    }

    if (col > 0) y += kKnobH + kPad;

    // Preset bar
    const int presetY = y + kPad;
    if (mPresetBox != nullptr)
        mPresetBox->setBounds(kPad, presetY, W - kPad * 2, 26);
}

void VirgoGenericEditor::comboBoxChanged(juce::ComboBox* box)
{
    if (box == mPresetBox.get())
    {
        const int id = box->getSelectedId();
        if (id >= 2)
            mProcessor.setCurrentProgram(id - 2);
    }
}
