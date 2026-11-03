#include "MainComponent.h"

namespace studio
{
namespace
{
const juce::Colour background(0xff101115), panel(0xff191b21), border(0xff30323a),
                   gold(0xffd7ad58), text(0xffece8dd), muted(0xff92959e), red(0xffdf6e65);
void label(juce::Graphics& g, juce::String value, juce::Rectangle<int> bounds,
           float height = 12, juce::Colour colour = text, bool bold = false)
{
    g.setColour(colour);
    g.setFont(juce::Font(height, bold ? juce::Font::bold : juce::Font::plain));
    g.drawFittedText(value, bounds, juce::Justification::centredLeft, 1);
}
}

void MainComponent::configureSlider(juce::Slider& slider, double low, double high,
                                   double interval, const juce::String& suffix)
{
    slider.setRange(low, high, interval);
    slider.setSliderStyle(juce::Slider::LinearHorizontal);
    slider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 78, 22);
    slider.setTextValueSuffix(suffix);
}

MainComponent::MainComponent()
{
    setSize(1440, 900);
    setWantsKeyboardFocus(true);
    lookAndFeel.setColour(juce::ResizableWindow::backgroundColourId, background);
    lookAndFeel.setColour(juce::TextButton::buttonColourId, panel);
    lookAndFeel.setColour(juce::TextButton::buttonOnColourId, gold);
    lookAndFeel.setColour(juce::TextButton::textColourOffId, text);
    lookAndFeel.setColour(juce::TextButton::textColourOnId, background);
    lookAndFeel.setColour(juce::ToggleButton::textColourId, text);
    lookAndFeel.setColour(juce::ToggleButton::tickColourId, gold);
    lookAndFeel.setColour(juce::Slider::thumbColourId, gold);
    lookAndFeel.setColour(juce::Slider::trackColourId, gold);
    lookAndFeel.setColour(juce::Slider::textBoxTextColourId, text);
    lookAndFeel.setColour(juce::Slider::textBoxBackgroundColourId, panel);
    lookAndFeel.setColour(juce::Slider::textBoxOutlineColourId, border);
    lookAndFeel.setColour(juce::ComboBox::backgroundColourId, panel);
    lookAndFeel.setColour(juce::ComboBox::outlineColourId, border);
    lookAndFeel.setColour(juce::ComboBox::textColourId, text);
    lookAndFeel.setColour(juce::ComboBox::arrowColourId, gold);
    setLookAndFeel(&lookAndFeel);

    for (auto* button : {&importButton, &newButton, &openButton, &saveButton, &exportButton, &setupButton,
                        &playButton, &stopButton, &recordButton, &analyseButton,
                        &aiButton, &masterButton, &deleteButton})
        addAndMakeVisible(button);
    for (auto* button : {&muteButton, &soloButton, &repairButton, &highPassButton,
                        &humButton, &gateButton, &clickButton, &masterEnabled})
        addAndMakeVisible(button);
    for (auto* slider : {&volumeSlider, &panSlider, &offsetSlider, &trimStartSlider,
                        &trimEndSlider, &zoomSlider, &masterGainSlider, &ceilingSlider, &gateSlider})
        addAndMakeVisible(slider);
    for (auto* box : {&humFrequency, &analysisScope, &masterTarget}) addAndMakeVisible(box);
    addAndMakeVisible(statusLabel); addAndMakeVisible(selectedLabel); addAndMakeVisible(positionLabel); addAndMakeVisible(analysisReport);
    statusLabel.setColour(juce::Label::textColourId, muted);
    selectedLabel.setColour(juce::Label::textColourId, gold);
    selectedLabel.setFont(juce::Font(15, juce::Font::bold));
    positionLabel.setColour(juce::Label::textColourId, gold);
    positionLabel.setFont(juce::Font(26));
    positionLabel.setEditable(false, true, false);
    positionLabel.setText("00:00.00", juce::dontSendNotification);
    positionLabel.onTextChange = [this]
    {
        auto value = positionLabel.getText().trim();
        double seconds = value.getDoubleValue();
        if (value.contains(":"))
            seconds = value.upToFirstOccurrenceOf(":", false, false).getDoubleValue() * 60
                + value.fromFirstOccurrenceOf(":", false, false).getDoubleValue();
        if (std::isfinite(seconds)) engine.seek(seconds);
    };
    analysisReport.setMultiLine(true); analysisReport.setReadOnly(true);
    analysisReport.setColour(juce::TextEditor::backgroundColourId, background);
    analysisReport.setColour(juce::TextEditor::textColourId, text);
    analysisReport.setColour(juce::TextEditor::outlineColourId, border);
    analysisReport.setFont(juce::Font(13));
    analysisReport.setText(
        "AUDIO INTELLIGENCE\n\nImport audio, then analyze the mix or selected track.\n\n"
        "Measured: sample peak, RMS level, crest factor, DC offset, clipped samples and transient warnings.\n\n"
        "Mastering uses compression, harmonic coloration and a sample-peak ceiling. RMS targets are not LUFS.\n\n"
        "Repair offers rumble/DC filtering, 50/60 Hz hum removal, a noise gate and conservative click suppression.\n\n"
        "Optional AI: Ollama on this computer with llama3.2 installed. Only measured statistics are sent to localhost; "
        "your audio files stay on your computer.\n\n"
        "This is a first-version workstation, not a complete Cakewalk replacement.");
    configureSlider(volumeSlider, -60, 12, 0.1, " dB");
    configureSlider(panSlider, -1, 1, 0.01, "");
    configureSlider(offsetSlider, 0, 3600, 0.01, " s");
    configureSlider(trimStartSlider, 0, 3600, 0.01, " s");
    configureSlider(trimEndSlider, 0, 3600, 0.01, " s");
    configureSlider(zoomSlider, 10, 600, 1, " s");
    configureSlider(masterGainSlider, -12, 12, 0.1, " dB");
    configureSlider(ceilingSlider, -6, -0.1, 0.1, " dB");
    configureSlider(gateSlider, -80, -25, 1, " dB");
    zoomSlider.setValue(60); ceilingSlider.setValue(-1); gateSlider.setValue(-55);
    humFrequency.addItem("60 Hz", 1); humFrequency.addItem("50 Hz", 2); humFrequency.setSelectedId(1);
    analysisScope.addItem("Full mix", 1); analysisScope.addItem("Selected track", 2); analysisScope.setSelectedId(1);
    masterTarget.addItem("Dynamic  /  -20 dB RMS", 1);
    masterTarget.addItem("Balanced  /  -18 dB RMS", 2);
    masterTarget.addItem("Loud  /  -14 dB RMS", 3); masterTarget.setSelectedId(2);

    importButton.onClick = [this] { importAudio(); };
    newButton.onClick = [this]
    {
        if (!canEdit()) return;
        confirmDiscard([safe = juce::Component::SafePointer<MainComponent>(this)]
        {
            if (!safe) return;
            safe->engine.replaceTracks({}, {});
            safe->selectedId.clear(); safe->projectFile = {}; safe->dirty = false;
            safe->hasMeasurements = false; safe->scrollRow = 0; safe->refreshControls();
            safe->showStatus("New project. Import or record audio to begin.");
        });
    };
    openButton.onClick = [this] { openProject(); };
    saveButton.onClick = [this] { saveProject(); };
    exportButton.onClick = [this] { exportAudio(); };
    setupButton.onClick = [this] { audioSetup(); };
    playButton.onClick = [this]
    {
        if (engine.isRecording()) { record(); return; }
        if (engine.isPlaying()) engine.pause();
        else { if (engine.position() >= engine.duration()) engine.seek(0); engine.play(); }
    };
    stopButton.onClick = [this] { if (engine.isRecording()) record(); else engine.stop(); };
    recordButton.onClick = [this] { record(); };
    analyseButton.onClick = [this] { analyseAudio(); };
    aiButton.onClick = [this] { askAI(); };
    masterButton.onClick = [this]
    {
        if (!canEdit()) return;
        if (!hasMeasurements) { showStatus("Analyze the full mix before applying mastering.", true); return; }
        if (analysisScope.getSelectedId() != 1) { showStatus("Choose Full mix and analyze it before mastering.", true); return; }
        engine.setMaster(recommendMaster(measurements, targetRms)); dirty = true;
        refreshControls(); showStatus("Mastering applied. Toggle Master processing to compare.");
    };
    masterTarget.onChange = [this] { targetRms = masterTarget.getSelectedId() == 1 ? -20.0f : masterTarget.getSelectedId() == 3 ? -14.0f : -18.0f; };
    zoomSlider.onValueChange = [this] { repaint(); };
    analysisScope.onChange = [this] { hasMeasurements = false; };
    auto update = [this]
    {
        if (updatingControls || !canEdit()) return;
        updateSelected([&](Track& track)
        {
            track.volumeDb = static_cast<float>(volumeSlider.getValue());
            track.pan = static_cast<float>(panSlider.getValue());
            track.offset = offsetSlider.getValue();
            const double full = track.audio->getNumSamples() / track.sourceRate;
            track.trimStart = std::clamp(trimStartSlider.getValue(), 0.0, std::max(0.0, full - 0.001));
            track.trimEnd = std::clamp(trimEndSlider.getValue(), track.trimStart + 0.001, full);
            track.mute = muteButton.getToggleState(); track.solo = soloButton.getToggleState();
            track.repair.enabled = repairButton.getToggleState(); track.repair.highPass = highPassButton.getToggleState();
            track.repair.hum = humButton.getToggleState(); track.repair.gate = gateButton.getToggleState();
            track.repair.deClick = clickButton.getToggleState();
            track.repair.humHz = humFrequency.getSelectedId() == 1 ? 60.0f : 50.0f;
            track.repair.gateDb = static_cast<float>(gateSlider.getValue());
        });
    };
    for (auto* slider : {&volumeSlider, &panSlider, &offsetSlider, &trimStartSlider, &trimEndSlider, &gateSlider})
        slider->onValueChange = update;
    for (auto* button : {&muteButton, &soloButton, &repairButton, &highPassButton, &humButton, &gateButton, &clickButton})
        button->onClick = update;
    humFrequency.onChange = update;
    auto masterUpdate = [this]
    {
        if (updatingControls || !canEdit()) return;
        auto value = engine.masterSettings(); value.enabled = masterEnabled.getToggleState();
        value.gainDb = static_cast<float>(masterGainSlider.getValue());
        value.ceilingDb = static_cast<float>(ceilingSlider.getValue());
        engine.setMaster(value); dirty = true;
    };
    masterEnabled.onClick = masterUpdate;
    masterGainSlider.onValueChange = masterUpdate; ceilingSlider.onValueChange = masterUpdate;
    deleteButton.onClick = [this]
    {
        if (!canEdit() || selectedId.isEmpty()) return;
        engine.removeTrack(selectedId); selectedId.clear(); dirty = true; hasMeasurements = false; refreshControls();
    };
    const auto error = engine.initialise();
    showStatus(error.isEmpty() ? "Ready. Import WAV, FLAC, AIFF or MP3 audio, or drop files onto the timeline."
                              : "Audio device unavailable: " + error, error.isNotEmpty());
    refreshControls(); startTimerHz(20);
}

MainComponent::~MainComponent()
{
    stopTimer(); cancelled.store(true);
    worker.removeAllJobs(true, -1);
    setLookAndFeel(nullptr);
}

bool MainComponent::canEdit()
{
    if (busy || engine.isRecording())
    {
        showStatus("Finish the current operation before editing the project.", true); return false;
    }
    return true;
}

void MainComponent::showStatus(const juce::String& message, bool error)
{
    statusLabel.setColour(juce::Label::textColourId, error ? red : muted);
    statusLabel.setText(message, juce::dontSendNotification);
}

double MainComponent::visibleDuration() const { return zoomSlider.getValue(); }
juce::Rectangle<int> MainComponent::timelineBounds() const
{
    return { 242, 142, std::max(100, getWidth() - 600), std::max(100, getHeight() - 482) };
}

void MainComponent::paint(juce::Graphics& g)
{
    g.fillAll(background);
    const int right = getWidth() - 334, bottom = getHeight() - 310;
    g.setColour(panel); g.fillRect(0, 0, getWidth(), 128);
    label(g, "VIRGO", {22, 13, 110, 30}, 27, gold, true);
    label(g, "STUDIOS", {134, 17, 110, 25}, 20, text, true);
    label(g, "WORKSTATION  /  0.1 PREVIEW", {24, 48, 240, 16}, 9, muted);
    const double position = engine.position();
    if (getWidth() > 1280)
        label(g, "48 kHz export  /  24-bit WAV", {590, 88, 220, 18}, 11, muted);
    label(g, "TRACKS", {22, 130, 140, 30}, 11, muted, true);
    g.setColour(border); g.drawLine(0, 128, static_cast<float>(getWidth()), 128);
    const auto area = timelineBounds();
    const auto trackList = engine.tracks();
    const int rows = std::max(1, area.getHeight() / 84);
    const float secondWidth = area.getWidth() / static_cast<float>(visibleDuration());
    const double startTime = std::floor(position / visibleDuration()) * visibleDuration();
    for (int division = 0; division <= 10; ++division)
    {
        const int x = area.getX() + area.getWidth() * division / 10;
        g.setColour(border.withAlpha(0.6f));
        g.drawVerticalLine(x, static_cast<float>(area.getY()), static_cast<float>(area.getBottom()));
        label(g, juce::String(startTime + visibleDuration() * division / 10, 0) + "s",
              {x + 4, 130, 65, 18}, 9, muted);
    }
    for (int row = 0; row < rows; ++row)
    {
        const int index = row + scrollRow;
        if (index >= static_cast<int>(trackList.size())) break;
        const auto& track = trackList[static_cast<size_t>(index)];
        const int y = area.getY() + row * 84 + 16;
        g.setColour(track.id == selectedId ? juce::Colour(0xff2a251c) : panel);
        g.fillRoundedRectangle(16.0f, static_cast<float>(y), 216.0f, 74.0f, 4);
        g.setColour(gold); g.fillRect(16, y, 3, 74);
        label(g, juce::String(index + 1).paddedLeft('0', 2), {26, y + 8, 28, 18}, 10, gold);
        label(g, track.name, {58, y + 7, 164, 22}, 13, text, true);
        label(g, juce::String(track.volumeDb, 1) + " dB    " + (track.mute ? "MUTED" : track.solo ? "SOLO" : "STEREO"),
              {28, y + 36, 190, 20}, 10, muted);
        const float clipStart = area.getX() + static_cast<float>(track.offset - startTime) * secondWidth;
        const float clipEnd = clipStart + static_cast<float>(track.duration()) * secondWidth;
        const float left = std::max(static_cast<float>(area.getX()), clipStart);
        const float edge = std::min(static_cast<float>(area.getRight()), clipEnd);
        if (edge > left)
        {
            g.setColour(track.mute ? juce::Colour(0xff292c31) : juce::Colour(0xff3b3020));
            g.fillRoundedRectangle(left, static_cast<float>(y), edge - left, 74, 3);
            g.setColour(track.id == selectedId ? gold : gold.withAlpha(0.5f));
            g.drawRoundedRectangle(left, static_cast<float>(y), edge - left, 74, 3, 1);
            if (track.waveform && !track.waveform->empty())
            {
                g.setColour(gold.withAlpha(track.mute ? 0.25f : 0.8f));
                for (int x = static_cast<int>(left + 2); x < static_cast<int>(edge - 2); x += 2)
                {
                    const double sampleTime = (x - clipStart) / secondWidth + track.trimStart;
                    const auto bin = static_cast<size_t>(std::max(0.0, sampleTime * track.sourceRate / 512));
                    if (bin >= track.waveform->size()) continue;
                    const auto peak = track.waveform->at(bin);
                    g.drawVerticalLine(x, y + 43.0f - peak[1] * 24, y + 43.0f - peak[0] * 24 + 1);
                }
            }
            label(g, track.name, {static_cast<int>(left + 8), y + 3, static_cast<int>(edge - left - 10), 15}, 9, text);
        }
    }
    if (trackList.empty())
    {
        label(g, "YOUR NEXT RECORD STARTS HERE", {area.getX() + 30, area.getY() + 70, area.getWidth() - 40, 35}, 19, gold, true);
        label(g, "Drop audio files here or choose Import Audio.", {area.getX() + 30, area.getY() + 110, area.getWidth() - 40, 25}, 13, muted);
        label(g, "Space: play/pause   |   Click ruler: seek   |   Shift-drag clip: move", {area.getX() + 30, area.getY() + 155, area.getWidth() - 40, 25}, 11, muted);
    }
    const float playheadX = area.getX() + static_cast<float>(position - startTime) * secondWidth;
    g.setColour(gold); g.drawLine(playheadX, static_cast<float>(area.getY()), playheadX, static_cast<float>(area.getBottom()), 1.5f);
    g.setColour(panel); g.fillRect(0, bottom, right, 276);
    g.setColour(border); g.drawLine(0, static_cast<float>(bottom), static_cast<float>(right), static_cast<float>(bottom));
    label(g, "TRACK INSPECTOR / MIXER", {22, bottom + 8, 280, 24}, 11, muted, true);
    label(g, "Volume", {24, bottom + 70, 70, 22}, 11, muted);
    label(g, "Balance", {24, bottom + 105, 70, 22}, 11, muted);
    label(g, "Position", {24, bottom + 140, 70, 22}, 11, muted);
    label(g, "Trim in", {24, bottom + 175, 70, 22}, 11, muted);
    label(g, "Trim out", {24, bottom + 210, 70, 22}, 11, muted);
    label(g, "NON-DESTRUCTIVE REPAIR", {390, bottom + 10, 260, 24}, 11, gold, true);
    label(g, "Gate floor", {390, bottom + 205, 90, 24}, 11, muted);
    g.setColour(juce::Colour(0xff15171c)); g.fillRect(right, 128, 334, getHeight() - 162);
    g.setColour(border); g.drawVerticalLine(right, 128, static_cast<float>(getHeight() - 34));
    label(g, "AUDIO INTELLIGENCE", {right + 18, 140, 300, 25}, 15, gold, true);
    label(g, "MASTER OUTPUT", {right + 18, bottom + 2, 280, 26}, 12, gold, true);
    label(g, "Gain", {right + 18, bottom + 67, 65, 24}, 11, muted);
    label(g, "Ceiling", {right + 18, bottom + 104, 65, 24}, 11, muted);
    const float peak = engine.peakLevel();
    const auto meter = juce::Rectangle<int>(right + 18, bottom + 150, 294, 12);
    g.setColour(border); g.fillRect(meter);
    g.setColour(peak >= 1 ? red : gold);
    g.fillRect(meter.withWidth(static_cast<int>(meter.getWidth() * std::clamp((db(peak) + 60) / 60, 0.0f, 1.0f))));
    label(g, peak >= 1 ? "CLIPPING — lower levels before export" : juce::String(db(peak), 1) + " dBFS sample peak",
          {right + 18, bottom + 168, 294, 22}, 10, peak >= 1 ? red : muted);
    label(g, dirty ? "UNSAVED CHANGES" : "PROJECT SAVED / READY", {right + 18, bottom + 235, 290, 22}, 10, muted);
}

void MainComponent::resized()
{
    const int right = getWidth() - 334, bottom = getHeight() - 310;
    importButton.setBounds(270, 20, 105, 30); openButton.setBounds(385, 20, 65, 30);
    saveButton.setBounds(460, 20, 65, 30); exportButton.setBounds(535, 20, 105, 30);
    newButton.setBounds(650, 20, 65, 30);
    setupButton.setBounds(getWidth() - 144, 20, 120, 30);
    playButton.setBounds(24, 80, 110, 32); stopButton.setBounds(144, 80, 85, 32);
    recordButton.setBounds(239, 80, 110, 32); zoomSlider.setBounds(right - 210, 83, 195, 26);
    positionLabel.setBounds(400, 77, 165, 34);
    selectedLabel.setBounds(22, bottom + 35, 240, 28);
    muteButton.setBounds(257, bottom + 35, 67, 28); soloButton.setBounds(325, bottom + 35, 65, 28);
    volumeSlider.setBounds(93, bottom + 70, 275, 24);
    panSlider.setBounds(93, bottom + 105, 275, 24);
    offsetSlider.setBounds(93, bottom + 140, 275, 24);
    trimStartSlider.setBounds(93, bottom + 175, 275, 24);
    trimEndSlider.setBounds(93, bottom + 210, 275, 24);
    repairButton.setBounds(390, bottom + 43, 200, 25);
    highPassButton.setBounds(390, bottom + 75, 200, 25);
    humButton.setBounds(390, bottom + 107, 165, 25);
    humFrequency.setBounds(560, bottom + 107, 84, 25);
    gateButton.setBounds(390, bottom + 139, 220, 25);
    clickButton.setBounds(390, bottom + 171, 220, 25);
    gateSlider.setBounds(475, bottom + 205, std::max(165, right - 495), 24);
    deleteButton.setBounds(24, bottom + 245, 150, 24);
    analysisScope.setBounds(right + 18, 178, 144, 27);
    analyseButton.setBounds(right + 170, 178, 144, 27);
    masterTarget.setBounds(right + 18, 216, 296, 28);
    masterButton.setBounds(right + 18, 255, 144, 30);
    aiButton.setBounds(right + 170, 255, 144, 30);
    analysisReport.setBounds(right + 18, 300, 296, std::max(120, bottom - 318));
    masterEnabled.setBounds(right + 18, bottom + 34, 280, 25);
    masterGainSlider.setBounds(right + 76, bottom + 67, 238, 26);
    ceilingSlider.setBounds(right + 76, bottom + 104, 238, 26);
    statusLabel.setBounds(16, getHeight() - 32, getWidth() - 32, 28);
}

void MainComponent::timerCallback()
{
    if (engine.isRecording() && engine.hasRecordingOverrun())
    {
        const auto file = engine.stopRecording();
        showStatus("Recording stopped: disk writer could not keep up. Partial take preserved at " + file.getFullPathName(), true);
    }
    analysisScope.setEnabled(!busy && !engine.isRecording());
    if (!positionLabel.isBeingEdited())
    {
        const double position = engine.position();
        positionLabel.setText(juce::String(static_cast<int>(position) / 60).paddedLeft('0', 2) + ":"
            + juce::String(std::fmod(position, 60.0), 2).paddedLeft('0', 5), juce::dontSendNotification);
    }
    playButton.setButtonText(engine.isPlaying() ? "Pause" : "Play");
    recordButton.setButtonText(engine.isRecording() ? "Finish Take" : "Record");
    repaint();
}

void MainComponent::mouseDown(const juce::MouseEvent& event)
{
    grabKeyboardFocus();
    if (busy || engine.isRecording()) return;
    const auto area = timelineBounds();
    if (event.y >= area.getY() && event.y < area.getBottom())
    {
        const auto trackList = engine.tracks();
        const int index = (event.y - area.getY() - 16) / 84 + scrollRow;
        if (index >= 0 && index < static_cast<int>(trackList.size()))
        {
            selectTrack(trackList[static_cast<size_t>(index)].id);
            dragOffset = trackList[static_cast<size_t>(index)].offset; dragMouseX = event.x;
        }
    }
    if (!event.mods.isShiftDown() && event.x >= area.getX() && event.x < area.getRight()
        && event.y >= 128 && event.y < area.getBottom() && !engine.isRecording())
    {
        const double page = std::floor(engine.position() / visibleDuration()) * visibleDuration();
        engine.seek(page + (event.x - area.getX()) * visibleDuration() / area.getWidth());
    }
}

void MainComponent::mouseDrag(const juce::MouseEvent& event)
{
    if (!event.mods.isShiftDown() || selectedId.isEmpty() || busy || engine.isRecording()) return;
    const double newOffset = std::clamp(dragOffset + (event.x - dragMouseX) * visibleDuration()
                                       / timelineBounds().getWidth(), 0.0, 3600.0);
    engine.updateTrack(selectedId, [&](Track& track) { track.offset = newOffset; });
    offsetSlider.setValue(newOffset, juce::dontSendNotification); dirty = true; hasMeasurements = false;
}

void MainComponent::mouseWheelMove(const juce::MouseEvent&, const juce::MouseWheelDetails& wheel)
{
    const int count = static_cast<int>(engine.tracks().size());
    scrollRow = std::clamp(scrollRow + (wheel.deltaY < 0 ? 1 : -1), 0, std::max(0, count - 1));
    repaint();
}

bool MainComponent::keyPressed(const juce::KeyPress& key)
{
    if (key == juce::KeyPress::spaceKey)
    {
        playButton.onClick(); return true;
    }
    return false;
}

void MainComponent::selectTrack(juce::String id)
{
    selectedId = std::move(id); hasMeasurements = false; refreshControls();
}

void MainComponent::updateSelected(const std::function<void(Track&)>& update)
{
    if (selectedId.isEmpty()) return;
    engine.updateTrack(selectedId, update); dirty = true; hasMeasurements = false; repaint();
}

void MainComponent::refreshControls()
{
    updatingControls = true;
    const auto trackList = engine.tracks();
    const auto found = std::find_if(trackList.begin(), trackList.end(), [&](const Track& track) { return track.id == selectedId; });
    const bool available = found != trackList.end();
    for (auto* component : std::vector<juce::Component*>{&volumeSlider, &panSlider, &offsetSlider, &trimStartSlider,
        &trimEndSlider, &muteButton, &soloButton, &repairButton, &highPassButton, &humButton,
        &gateButton, &clickButton, &humFrequency, &gateSlider, &deleteButton})
        component->setEnabled(available);
    selectedLabel.setText(available ? found->name : "Select a track", juce::dontSendNotification);
    if (available)
    {
        volumeSlider.setValue(found->volumeDb, juce::dontSendNotification);
        panSlider.setValue(found->pan, juce::dontSendNotification);
        offsetSlider.setValue(found->offset, juce::dontSendNotification);
        trimStartSlider.setValue(found->trimStart, juce::dontSendNotification);
        trimEndSlider.setValue(found->trimEnd, juce::dontSendNotification);
        muteButton.setToggleState(found->mute, juce::dontSendNotification);
        soloButton.setToggleState(found->solo, juce::dontSendNotification);
        repairButton.setToggleState(found->repair.enabled, juce::dontSendNotification);
        highPassButton.setToggleState(found->repair.highPass, juce::dontSendNotification);
        humButton.setToggleState(found->repair.hum, juce::dontSendNotification);
        gateButton.setToggleState(found->repair.gate, juce::dontSendNotification);
        clickButton.setToggleState(found->repair.deClick, juce::dontSendNotification);
        humFrequency.setSelectedId(found->repair.humHz == 50 ? 2 : 1, juce::dontSendNotification);
        gateSlider.setValue(found->repair.gateDb, juce::dontSendNotification);
    }
    const auto master = engine.masterSettings();
    masterEnabled.setToggleState(master.enabled, juce::dontSendNotification);
    masterGainSlider.setValue(master.gainDb, juce::dontSendNotification);
    ceilingSlider.setValue(master.ceilingDb, juce::dontSendNotification);
    updatingControls = false; repaint();
}

void MainComponent::filesDropped(const juce::StringArray& files, int, int)
{
    juce::Array<juce::File> paths;
    for (const auto& path : files) paths.add(juce::File(path));
    importFiles(paths);
}

void MainComponent::importAudio()
{
    if (!canEdit()) return;
    chooser = std::make_unique<juce::FileChooser>("Import audio tracks", juce::File(), "*.wav;*.flac;*.aif;*.aiff;*.mp3");
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles
        | juce::FileBrowserComponent::canSelectMultipleItems,
        [safe = juce::Component::SafePointer<MainComponent>(this)](const juce::FileChooser& value)
        { if (safe) safe->importFiles(value.getResults()); });
}

void MainComponent::importFiles(juce::Array<juce::File> files, double offset)
{
    if (!canEdit() || files.isEmpty()) return;
    busy = true; showStatus("Decoding audio...");
    worker.addJob([this, safe = juce::Component::SafePointer<MainComponent>(this), files, offset]
    {
        std::vector<Track> loaded; juce::String errors;
        for (const auto& file : files)
        {
            if (cancelled.load()) break;
            juce::String error; auto track = AudioEngine::loadTrack(file, error);
            if (error.isNotEmpty()) errors += error + "\n";
            else { track.offset = offset; loaded.push_back(std::move(track)); }
        }
        juce::MessageManager::callAsync([safe, loaded = std::move(loaded), errors]() mutable
        {
            if (!safe) return;
            auto message = errors;
            for (auto& track : loaded)
            {
                juce::String error;
                const auto id = track.id;
                if (safe->engine.addTrack(std::move(track), error)) { safe->selectedId = id; safe->dirty = true; }
                else message += error + "\n";
            }
            safe->busy = false; safe->hasMeasurements = false; safe->refreshControls();
            safe->showStatus(message.isEmpty() ? "Audio imported. Select a track to mix or repair it." : message, message.isNotEmpty());
        });
    });
}

void MainComponent::record()
{
    if (engine.isRecording())
    {
        const double offset = engine.recordingOffset();
        const auto file = engine.stopRecording();
        if (file.existsAsFile()) importFiles({file}, offset);
        return;
    }
    if (!canEdit()) return;
    const auto folder = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("Virgo Studios Recordings");
    const auto result = folder.createDirectory();
    if (result.failed()) { showStatus(result.getErrorMessage(), true); return; }
    const auto file = folder.getNonexistentChildFile("Take", ".wav");
    const auto error = engine.startRecording(file);
    showStatus(error.isEmpty() ? "Recording input to " + file.getFullPathName() + ". Click Finish Take to add it." : error, error.isNotEmpty());
}

void MainComponent::audioSetup()
{
    if (engine.isRecording()) { showStatus("Finish recording before changing audio devices.", true); return; }
    engine.pause();
    auto* selector = new juce::AudioDeviceSelectorComponent(engine.devices, 0, 2, 0, 2, false, false, true, false);
    selector->setSize(620, 460);
    juce::DialogWindow::LaunchOptions options;
    options.content.setOwned(selector); options.dialogTitle = "Virgo Studios — Audio Setup";
    options.dialogBackgroundColour = background; options.useNativeTitleBar = true;
    options.componentToCentreAround = this; options.launchAsync();
}
}
