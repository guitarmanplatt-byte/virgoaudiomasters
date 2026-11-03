#include "PluginBrowser.h"

namespace studio
{
namespace
{
class BrowserPanel final : public juce::Component, private juce::ChangeListener
{
public:
    explicit BrowserPanel(std::function<juce::String(const juce::PluginDescription&)> load)
        : loadEffect(std::move(load))
    {
        formats.addDefaultFormats();
        const auto folder = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
            .getChildFile("Virgo Studios");
        folder.createDirectory();
        catalogueFile = folder.getChildFile("plugins.xml");
        if (auto xml = juce::XmlDocument::parse(catalogueFile)) known.recreateFromXml(*xml);
        juce::PropertiesFile::Options options;
        options.applicationName = "Virgo Studios";
        options.filenameSuffix = ".settings";
        options.folderName = "Virgo Studios";
        options.osxLibrarySubFolder = "Application Support";
        properties = std::make_unique<juce::PropertiesFile>(options);
        for (auto* format : formats.getFormats())
            if (format->getName() == "VST3")
            {
                vst3 = format;
                if (properties->getValue("lastPluginScanPath_VST3").isEmpty())
                {
                    auto paths = format->getDefaultLocationsToSearch();
                    paths.add(juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                        .getChildFile("Programs/Common/VST3"));
                    juce::PluginListComponent::setLastSearchPath(*properties, *format, paths);
                }
            }
        list = std::make_unique<juce::PluginListComponent>(formats, known,
            folder.getChildFile("scan-in-progress.txt"), properties.get());
        list->setNumberOfThreadsForScanning(1);
        list->setOptionsButtonText("Scan / manage plugins");
        list->setScanDialogText("Scan for VST3 plugins",
            "Choose plugin folders. Standard Windows folders are included; add custom folders with +. "
            "Only scan plugins you trust. Save your project first.");
        addAndMakeVisible(*list);
        addAndMakeVisible(scan);
        addAndMakeVisible(loadButton);
        addAndMakeVisible(message);
        message.setText("Scan folders, select an effect in the list, then Load selected effect. "
            "Windows x64 VST3 effects only; instruments are not supported.", juce::dontSendNotification);
        message.setColour(juce::Label::textColourId, juce::Colour(0xffd7b869));
        scan.onClick = [this]
        {
            if (vst3 && !list->isScanning()) list->scanFor(*vst3);
        };
        loadButton.onClick = [this]
        {
            if (list->isScanning()) { status("Wait for the scan to finish, or cancel it."); return; }
            const auto row = list->getTableListBox().getSelectedRow();
            const auto types = known.getTypes();
            if (!juce::isPositiveAndBelow(row, types.size())) { status("Select a plugin in the list first."); return; }
            const auto& type = types.getReference(row);
            if (type.isInstrument) { status("This preview supports audio effects, not instruments."); return; }
            if (!juce::File(type.fileOrIdentifier).exists()) { status("This plugin has moved or was removed. Scan its folder again."); return; }
            const auto error = loadEffect(type);
            status(error.isEmpty() ? type.name + " loaded onto the selected track. Use VST3 Effects to open its editor." : error);
        };
        known.addChangeListener(this);
        setSize(850, 560);
    }
    ~BrowserPanel() override
    {
        known.removeChangeListener(this);
        list.reset(); // Stop scanner before destroying its list/format manager.
        persist();
        properties->saveIfNeeded();
    }
    void resized() override
    {
        auto bounds = getLocalBounds().reduced(12);
        message.setBounds(bounds.removeFromTop(58));
        auto buttons = bounds.removeFromBottom(36);
        scan.setBounds(buttons.removeFromLeft(190).reduced(2));
        loadButton.setBounds(buttons.removeFromRight(210).reduced(2));
        list->setBounds(bounds.reduced(0, 6));
    }
private:
    void status(const juce::String& text) { message.setText(text, juce::dontSendNotification); }
    void persist()
    {
        if (auto xml = known.createXml())
        {
            juce::TemporaryFile temporary(catalogueFile);
            if (!xml->writeTo(temporary.getFile()) || !temporary.overwriteTargetFileWithTemporary())
                status("Could not save the plugin list. Check permissions for the Virgo Studios settings folder.");
        }
    }
    void changeListenerCallback(juce::ChangeBroadcaster*) override { persist(); }
    juce::AudioPluginFormatManager formats;
    juce::KnownPluginList known;
    juce::AudioPluginFormat* vst3 = nullptr;
    juce::File catalogueFile;
    std::unique_ptr<juce::PropertiesFile> properties;
    std::unique_ptr<juce::PluginListComponent> list;
    juce::TextButton scan {"Scan plugin folders..."}, loadButton {"Load selected effect"};
    juce::Label message;
    std::function<juce::String(const juce::PluginDescription&)> loadEffect;
};

class BrowserWindow final : public juce::DocumentWindow
{
public:
    explicit BrowserWindow(std::function<juce::String(const juce::PluginDescription&)> load)
        : DocumentWindow("Virgo Studios — Plugin Browser", juce::Colour(0xff191b21), closeButton)
    {
        theme.setColour(juce::ResizableWindow::backgroundColourId, juce::Colour(0xff191b21));
        theme.setColour(juce::ListBox::backgroundColourId, juce::Colour(0xff101115));
        theme.setColour(juce::ListBox::textColourId, juce::Colour(0xffe7e5df));
        theme.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff30323a));
        theme.setColour(juce::TextButton::textColourOffId, juce::Colour(0xffd7b869));
        setLookAndFeel(&theme);
        setUsingNativeTitleBar(true);
        setContentOwned(new BrowserPanel(std::move(load)), true);
        setResizable(true, false);
        setResizeLimits(640, 420, 1600, 1000);
        centreWithSize(850, 560);
        setVisible(true);
    }
    ~BrowserWindow() override { clearContentComponent(); setLookAndFeel(nullptr); }
    void closeButtonPressed() override { setVisible(false); }
private:
    juce::LookAndFeel_V4 theme;
};
}

std::unique_ptr<juce::DocumentWindow> createPluginBrowser(
    std::function<juce::String(const juce::PluginDescription&)> load)
{
    return std::make_unique<BrowserWindow>(std::move(load));
}
}
