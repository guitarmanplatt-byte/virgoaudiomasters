#include "MainComponent.h"
#include "Quantize.h"
#include "PluginBrowser.h"

namespace studio
{
namespace
{
class EffectWindow final : public juce::DocumentWindow
{
public:
    EffectWindow(std::shared_ptr<PluginChain> owner, int index)
        : DocumentWindow(owner->entries[static_cast<size_t>(index)].description.name,
              juce::Colour(0xff191b21), DocumentWindow::closeButton), rack(std::move(owner))
    {
        auto* processor = rack->entries[static_cast<size_t>(index)].processor.get();
        auto* editor = processor->createEditorIfNeeded();
        if (!editor) editor = new juce::GenericAudioProcessorEditor(*processor);
        setUsingNativeTitleBar(true);
        setContentOwned(editor, true);
        centreWithSize(std::max(320, editor->getWidth()), std::max(200, editor->getHeight()));
        setResizable(editor->isResizable(), false);
        setVisible(true);
    }
    ~EffectWindow() override { clearContentComponent(); }
    void closeButtonPressed() override { setVisible(false); }
private:
    std::shared_ptr<PluginChain> rack;
};

juce::File takesDirectory()
{
    return juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
        .getChildFile("Virgo Studios Renders");
}

juce::String writeTake(const juce::AudioBuffer<float>& buffer, double rate, const juce::File& destination)
{
    if (destination.exists()) return "The destination already exists.";
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            if (!std::isfinite(buffer.getSample(channel, i)) || std::abs(buffer.getSample(channel, i)) > 1)
                return "The source exceeds full scale or contains invalid samples. Normalize it before quantizing.";
    juce::TemporaryFile temporary(destination);
    auto stream = temporary.getFile().createOutputStream();
    if (!stream) return "Could not create audio take.";
    juce::WavAudioFormat format;
    std::unique_ptr<juce::AudioFormatWriter> writer(format.createWriterFor(stream.get(), rate, 2, 24, {}, 0));
    if (!writer) return "Could not create WAV writer.";
    stream.release();
    if (!writer->writeFromAudioSampleBuffer(buffer, 0, buffer.getNumSamples())) return "Could not write audio take.";
    writer.reset();
    return temporary.overwriteTargetFileWithTemporary() ? juce::String() : "Could not finish audio take.";
}
}

void MainComponent::pluginMenu()
{
    if (!canEdit() || selectedId.isEmpty()) { showStatus("Select a track first.", true); return; }
    engine.pause();
    const auto list = engine.tracks();
    const auto found = std::find_if(list.begin(), list.end(), [&](const Track& track) { return track.id == selectedId; });
    if (found == list.end()) return;
    auto rack = found->plugins;
    juce::PopupMenu menu;
    menu.addItem(1, "Browse / scan installed VST3 effects...");
    menu.addItem(2, "Choose VST3 file manually...");
    menu.addSectionHeader("Signal order: repair > effects > track gain / pan");
    if (rack)
        for (size_t i = 0; i < rack->entries.size(); ++i)
        {
            const auto& entry = rack->entries[i];
            const int base = 100 + static_cast<int>(i) * 10;
            juce::PopupMenu slot;
            slot.addItem(base, "Open editor");
            slot.addItem(base + 1, "Bypass", true, entry.bypass);
            slot.addItem(base + 2, "Move earlier", i > 0);
            slot.addItem(base + 3, "Move later", i + 1 < rack->entries.size());
            slot.addItem(base + 4, "Remove effect");
            menu.addSubMenu(juce::String(static_cast<int>(i) + 1) + ". " + entry.description.name
                + (entry.bypass ? " [bypassed]" : ""), slot);
        }
    const auto id = selectedId;
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&pluginsButton),
        [safe = juce::Component::SafePointer<MainComponent>(this), id, rack](int result)
    {
        if (!safe || !safe->canEdit() || safe->selectedId != id) return;
        if (result == 1) { safe->browsePlugins(); return; }
        if (result == 2) { safe->addPlugin(); return; }
        if (!rack || result < 100) return;
        const int index = (result - 100) / 10, action = (result - 100) % 10;
        if (index < 0 || index >= static_cast<int>(rack->entries.size())) return;
        safe->engine.pause();
        // Editors retain a plugin pointer; close them before changing rack order/lifetime.
        safe->pluginWindows.clear();
        if (action == 0)
        {
            safe->pluginWindows.push_back(std::make_unique<EffectWindow>(rack, index));
            safe->dirty = true;
            return;
        }
        safe->engine.updateTrack(id, [=](Track& track)
        {
            if (action == 1) rack->entries[static_cast<size_t>(index)].bypass = !rack->entries[static_cast<size_t>(index)].bypass;
            if (action == 2 && index > 0) std::swap(rack->entries[static_cast<size_t>(index)], rack->entries[static_cast<size_t>(index - 1)]);
            if (action == 3 && index + 1 < static_cast<int>(rack->entries.size()))
                std::swap(rack->entries[static_cast<size_t>(index)], rack->entries[static_cast<size_t>(index + 1)]);
            if (action == 4) rack->entries.erase(rack->entries.begin() + index);
            track.plugins = rack;
        });
        safe->dirty = true; safe->hasMeasurements = false;
        safe->showStatus("Effect rack updated. Play to audition; save the project to preserve settings.");
    });
}

void MainComponent::browsePlugins()
{
    if (!canEdit() || selectedId.isEmpty()) return;
    if (!pluginBrowser)
    {
        pluginBrowser = createPluginBrowser([safe = juce::Component::SafePointer<MainComponent>(this)]
            (const juce::PluginDescription& description) -> juce::String
        {
            if (!safe || !safe->canEdit()) return "Finish the current operation before loading a plugin.";
            const auto id = safe->selectedId;
            const auto tracks = safe->engine.tracks();
            if (id.isEmpty() || std::none_of(tracks.begin(), tracks.end(),
                [&](const Track& track) { return track.id == id; }))
                return "Select an audio track in the main window first.";
            safe->engine.pause();
            juce::String error;
            safe->engine.updateTrack(id, [&](Track& track)
            {
                if (!track.plugins) track.plugins = std::make_shared<PluginChain>();
                error = track.plugins->add(description, 48000);
            });
            if (error.isEmpty()) { safe->dirty = true; safe->hasMeasurements = false; }
            safe->showStatus(error.isEmpty() ? description.name + " loaded onto the selected track." : error,
                error.isNotEmpty());
            return error;
        });
    }
    pluginBrowser->setVisible(true);
    pluginBrowser->toFront(true);
}

void MainComponent::addPlugin()
{
    if (!canEdit() || selectedId.isEmpty()) return;
    const auto id = selectedId;
    chooser = std::make_unique<juce::FileChooser>("Choose a trusted 64-bit VST3 audio effect",
        juce::File("C:\\Program Files\\Common Files\\VST3"), "*.vst3");
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles
        | juce::FileBrowserComponent::canSelectDirectories,
        [safe = juce::Component::SafePointer<MainComponent>(this), id](const juce::FileChooser& choice)
    {
        if (!safe || !safe->canEdit() || choice.getResult() == juce::File()) return;
        safe->engine.pause();
        juce::String error;
        safe->engine.updateTrack(id, [&](Track& track)
        {
            if (!track.plugins) track.plugins = std::make_shared<PluginChain>();
            error = track.plugins->add(choice.getResult(), 48000);
        });
        if (error.isEmpty()) { safe->dirty = true; safe->hasMeasurements = false; }
        safe->showStatus(error.isEmpty() ? "VST3 effect loaded. Open VST3 Effects to edit, reorder or bypass it." : error, error.isNotEmpty());
    });
}

void MainComponent::finishTake(const juce::File& file, const juce::String& originalId, double offset, bool copySettings)
{
    juce::String error;
    auto take = AudioEngine::loadTrack(file, error);
    if (error.isNotEmpty()) { showStatus(error, true); return; }
    const auto list = engine.tracks();
    const auto original = std::find_if(list.begin(), list.end(), [&](const Track& track) { return track.id == originalId; });
    take.offset = offset;
    if (original != list.end())
    {
        take.solo = original->solo;
        if (copySettings)
        {
            take.volumeDb = original->volumeDb; take.pan = original->pan; take.repair = original->repair;
            try { if (original->plugins) take.plugins = original->plugins->clone(48000); }
            catch (const std::exception& exception) { showStatus(exception.what(), true); return; }
        }
    }
    const auto id = take.id;
    if (!engine.addTrack(std::move(take), error))
    { showStatus(error + " Rendered file was preserved at " + file.getFullPathName(), true); return; }
    engine.updateTrack(originalId, [](Track& track) { track.mute = true; track.solo = false; });
    selectedId = id; dirty = true; hasMeasurements = false; refreshControls();
    showStatus("New take added; original track is muted, not deleted. " + file.getFullPathName());
}

void MainComponent::quantizeAudio()
{
    if (!canEdit() || selectedId.isEmpty()) { showStatus("Select an audio track to quantize.", true); return; }
    engine.pause();
    auto* dialog = new juce::AlertWindow("Quantize audio",
        "Transient slices snap to the project grid without pitch shifting. Gaps/overlaps can change decays; "
        "the original remains as a muted track. Best for drums and rhythmic material.",
        juce::AlertWindow::NoIcon);
    dialog->addTextEditor("tempo", "120", "Tempo (20-300 BPM)");
    dialog->addComboBox("grid", {"1/4 notes", "1/8 notes", "1/16 notes", "1/32 notes"}, "Grid");
    dialog->getComboBoxComponent("grid")->setSelectedItemIndex(2);
    dialog->addTextEditor("strength", "100", "Strength (0-100%)");
    dialog->addButton("Create quantized take", 1);
    dialog->addButton("Cancel", 0);
    const auto id = selectedId;
    dialog->enterModalState(true, juce::ModalCallbackFunction::create(
        [safe = juce::Component::SafePointer<MainComponent>(this), dialog, id](int result)
    {
        if (!safe || result != 1 || !safe->canEdit()) return;
        const double bpm = dialog->getTextEditorContents("tempo").getDoubleValue();
        const double strength = dialog->getTextEditorContents("strength").getDoubleValue() / 100.0;
        const int division = 4 << dialog->getComboBoxComponent("grid")->getSelectedItemIndex();
        if (bpm < 20 || bpm > 300 || strength < 0 || strength > 1)
        { safe->showStatus("Enter tempo 20-300 BPM and strength 0-100%.", true); return; }
        const auto list = safe->engine.tracks();
        const auto found = std::find_if(list.begin(), list.end(), [&](const Track& value) { return value.id == id; });
        if (found == list.end()) return;
        const Track track = *found;
        safe->busy = true; safe->showStatus("Detecting transients and creating a quantized take...");
        safe->worker.addJob([safe, track, bpm, division, strength]
        {
            const int start = static_cast<int>(std::round(track.trimStart * track.sourceRate));
            const int count = std::min(track.audio->getNumSamples() - start,
                static_cast<int>(std::round(track.duration() * track.sourceRate)));
            const auto* left = track.audio->getReadPointer(0, start);
            const auto* right = track.audio->getReadPointer(std::min(1, track.audio->getNumChannels() - 1), start);
            const auto markers = quantizeMarkers(left, right, count, track.sourceRate, bpm, division, strength, track.offset);
            juce::String error;
            juce::File file;
            if (markers.empty()) error = "No clear transients detected; no audio was changed.";
            else
            {
                juce::AudioBuffer<float> output(2, count);
                renderQuantized(left, output.getWritePointer(0), count, track.sourceRate, markers);
                renderQuantized(right, output.getWritePointer(1), count, track.sourceRate, markers);
                auto directory = takesDirectory();
                if (directory.createDirectory().failed()) error = "Cannot create render directory.";
                file = directory.getNonexistentChildFile(juce::File::createLegalFileName(track.name) + " Quantized", ".wav");
                if (error.isEmpty()) error = writeTake(output, track.sourceRate, file);
            }
            juce::MessageManager::callAsync([safe, track, file, error]
            {
                if (!safe) return;
                safe->busy = false;
                if (error.isNotEmpty()) safe->showStatus(error, true);
                else safe->finishTake(file, track.id, track.offset, true);
            });
        });
    }), true);
}

void MainComponent::bounceTrack()
{
    if (!canEdit() || selectedId.isEmpty()) { showStatus("Select a track to render its effects.", true); return; }
    engine.pause();
    auto render = engine.snapshot(false);
    if (render.error.isNotEmpty()) { showStatus(render.error, true); return; }
    const auto id = selectedId;
    render.tracks.erase(std::remove_if(render.tracks.begin(), render.tracks.end(),
        [&](const Track& track) { return track.id != id; }), render.tracks.end());
    if (render.tracks.empty()) return;
    const double offset = render.tracks[0].offset;
    const auto name = render.tracks[0].name;
    render.tracks[0].offset = 0; render.tracks[0].mute = render.tracks[0].solo = false;
    render.prepare(48000);
    auto directory = takesDirectory();
    if (directory.createDirectory().failed()) { showStatus("Cannot create render directory.", true); return; }
    const auto file = directory.getNonexistentChildFile(juce::File::createLegalFileName(name) + " Bounced", ".wav");
    busy = true; showStatus("Rendering repair, VST3 effects, gain and pan to a new audio take...");
    worker.addJob([safe = juce::Component::SafePointer<MainComponent>(this), render, file, id, offset]
    {
        const auto error = AudioEngine::exportWav(render, file, safe ? &safe->cancelled : nullptr);
        juce::MessageManager::callAsync([safe, error, file, id, offset]
        {
            if (!safe) return;
            safe->busy = false;
            if (error.isNotEmpty()) safe->showStatus(error, true);
            else safe->finishTake(file, id, offset, false);
        });
    });
}

void MainComponent::batchExport()
{
    if (!canEdit() || engine.tracks().empty()) { showStatus("Import audio tracks before batch export.", true); return; }
    engine.pause();
    chooser = std::make_unique<juce::FileChooser>("Choose parent folder for a new batch (one timeline-aligned WAV per track)",
        juce::File::getSpecialLocation(juce::File::userDocumentsDirectory));
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
        [safe = juce::Component::SafePointer<MainComponent>(this)](const juce::FileChooser& choice)
    {
        if (!safe || !safe->canEdit() || choice.getResult() == juce::File()) return;
        auto render = safe->engine.snapshot(false);
        if (render.error.isNotEmpty()) { safe->showStatus(render.error, true); return; }
        const auto destination = choice.getResult().getNonexistentChildFile("Virgo Stems", "", false);
        const auto staging = choice.getResult().getChildFile(".virgo-batch-" + juce::Uuid().toString());
        safe->busy = true; safe->showStatus("Batch rendering all tracks, including muted tracks; master processing excluded...");
        safe->worker.addJob([safe, render, destination, staging]
        {
            juce::String error;
            if (staging.createDirectory().failed()) error = "Cannot create batch folder.";
            int index = 0;
            for (auto track : render.tracks)
            {
                if (error.isNotEmpty()) break;
                RenderState stem; stem.tracks.push_back(std::move(track));
                stem.tracks[0].mute = stem.tracks[0].solo = false;
                stem.prepare(48000);
                // Equal lengths and original timeline offsets make stems easy to reimport.
                stem.duration = render.duration;
                const auto filename = juce::String(++index).paddedLeft('0', 2) + " - "
                    + juce::File::createLegalFileName(stem.tracks[0].name) + ".wav";
                error = AudioEngine::exportWav(stem, staging.getChildFile(filename), safe ? &safe->cancelled : nullptr);
            }
            if (error.isEmpty() && !staging.moveFileTo(destination)) error = "Could not finalize batch folder.";
            if (error.isNotEmpty()) staging.deleteRecursively();
            juce::MessageManager::callAsync([safe, error, destination, index]
            {
                if (!safe) return;
                safe->busy = false;
                safe->showStatus(error.isEmpty() ? juce::String(index) + " WAV files rendered to " + destination.getFullPathName()
                    : error + " No completed batch was published.", error.isNotEmpty());
                if (error.isEmpty()) destination.revealToUser();
            });
        });
    });
}
}
