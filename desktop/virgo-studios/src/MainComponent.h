#pragma once
#include "AudioEngine.h"

namespace studio
{
class MainComponent final : public juce::Component,
                            public juce::FileDragAndDropTarget,
                            private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;
    void paint(juce::Graphics&) override;
    void resized() override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseWheelMove(const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    bool keyPressed(const juce::KeyPress&) override;
    bool isInterestedInFileDrag(const juce::StringArray&) override { return true; }
    void filesDropped(const juce::StringArray&, int, int) override;
    void requestClose(std::function<void()>);
    juce::Image capture() { return createComponentSnapshot(getLocalBounds()); }

private:
    void timerCallback() override;
    void importAudio();
    void importFiles(juce::Array<juce::File>, double offset = 0);
    void record();
    void saveProject(std::function<void(bool)> completion = {});
    void newProject();
    void openProject();
    void exportAudio();
    void pluginMenu();
    void addPlugin();
    void quantizeAudio();
    void bounceTrack();
    void batchExport();
    void finishTake(const juce::File&, const juce::String& originalId, double offset, bool copySettings);
    void analyseAudio();
    void askAI();
    void selectTrack(juce::String);
    void updateSelected(const std::function<void(Track&)>&);
    void refreshControls();
    void showStatus(const juce::String&, bool error = false);
    void confirmDiscard(std::function<void()>);
    void audioSetup();
    bool canEdit();
    double visibleDuration() const;
    juce::Rectangle<int> timelineBounds() const;
    RenderState analysisSnapshot() const;
    static juce::var trackToJson(const Track&, const juce::File&);
    static juce::var masterToJson(MasterSettings);
    static juce::String analysisText(const Measurements&);
    static void configureSlider(juce::Slider&, double, double, double, const juce::String&);

    AudioEngine engine;
    juce::LookAndFeel_V4 lookAndFeel;
    juce::ThreadPool worker {1};
    std::atomic<bool> cancelled {false};
    std::unique_ptr<juce::FileChooser> chooser;
    juce::String selectedId;
    juce::File projectFile;
    bool dirty = false, busy = false, updatingControls = false;
    std::vector<std::unique_ptr<juce::DocumentWindow>> pluginWindows;
    int scrollRow = 0;
    double dragOffset = 0, dragMouseX = 0;
    Measurements measurements;
    bool hasMeasurements = false;
    float targetRms = -18;

    juce::TextButton importButton {"Import Audio"}, newButton {"New"}, openButton {"Open"}, saveButton {"Save"},
        exportButton {"Export WAV"}, setupButton {"Audio Setup"}, playButton {"Play"},
        stopButton {"Stop"}, recordButton {"Record"}, analyseButton {"Analyze Audio"},
        aiButton {"AI Plan + Apply"}, masterButton {"Apply Mastering"}, deleteButton {"Remove Track"},
        pluginsButton {"VST3 Effects"}, quantizeButton {"Quantize"}, bounceButton {"Bounce Track"},
        batchButton {"Batch Export"};
    juce::ToggleButton muteButton {"Mute"}, soloButton {"Solo"},
        repairButton {"Repair enabled"}, highPassButton {"DC / rumble filter"},
        humButton {"Hum removal"}, gateButton {"Noise gate"}, clickButton {"Click suppression"},
        masterEnabled {"Master processing"};
    juce::Slider volumeSlider, panSlider, offsetSlider, trimStartSlider, trimEndSlider,
        zoomSlider, masterGainSlider, ceilingSlider, gateSlider;
    juce::ComboBox humFrequency, analysisScope, masterTarget;
    juce::Label statusLabel, selectedLabel, positionLabel;
    juce::TextEditor analysisReport;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
}
