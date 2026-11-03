#include "MainComponent.h"
#include "EngineTests.h"

class VirgoStudiosApplication final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "Virgo Studios"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return false; }

    void initialise(const juce::String& commandLine) override
    {
        if (commandLine.trim() == "--self-test")
        {
            setApplicationReturnValue(studio::runEngineTests());
            quit();
            return;
        }
        window = std::make_unique<Window>();
        // CI can capture the real native interface without simulating audio hardware.
        if (commandLine.startsWith("--screenshot="))
        {
            const auto file = juce::File(commandLine.fromFirstOccurrenceOf("=", false, false).unquoted());
            juce::Timer::callAfterDelay(1500, [this, file]
            {
                auto image = window->content->capture();
                file.getParentDirectory().createDirectory();
                if (auto output = file.createOutputStream())
                {
                    juce::PNGImageFormat png;
                    png.writeImageToStream(image, *output);
                }
                quit();
            });
        }
    }
    void shutdown() override { window.reset(); }
    void systemRequestedQuit() override
    {
        if (window) window->content->requestClose([this] { quit(); });
        else quit();
    }
    void anotherInstanceStarted(const juce::String&) override
    {
        if (window) window->toFront(true);
    }
private:
    class Window final : public juce::DocumentWindow
    {
    public:
        Window() : DocumentWindow("Virgo Studios", juce::Colour(0xff101115), allButtons)
        {
            setUsingNativeTitleBar(true);
            content = new studio::MainComponent();
            setContentOwned(content, true);
            setResizable(true, true);
            setResizeLimits(1120, 800, 2560, 1600);
            centreWithSize(1440, 940);
            setVisible(true);
        }
        void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
        studio::MainComponent* content = nullptr;
    };
    std::unique_ptr<Window> window;
};

START_JUCE_APPLICATION(VirgoStudiosApplication)
