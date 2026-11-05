#include "MainComponent.h"
#include <cstdlib>

namespace studio
{
void MainComponent::playAudio()
{
    if (busy) { showStatus("Finish the current operation before starting playback.", true); return; }
    if (engine.isRecording()) { record(); return; }
    if (engine.isPlaying()) { engine.pause(); return; }
    if (engine.position() >= engine.duration()) engine.seek(0);
    if (!safePlayback.getToggleState() || engine.hasPreparedPlayback())
    { engine.play(); return; }
    engine.pause();
    auto render = engine.snapshot();
    if (render.error.isNotEmpty()) { showStatus(render.error, true); return; }
    if (render.duration <= 0) { showStatus("Import audio before playing.", true); return; }
    const auto file = juce::File::getSpecialLocation(juce::File::tempDirectory)
        .getChildFile("Virgo-playback-" + juce::Uuid().toString() + ".wav");
    cancelled.store(false); busy = preparingPlayback = true;
    showStatus("Preparing Safe Playback: rendering all effects to a temporary WAV. Stop cancels; original audio is unchanged.");
    worker.addJob([safe = juce::Component::SafePointer<MainComponent>(this), render, file]
    {
        const auto error = AudioEngine::exportWav(render, file, safe ? &safe->cancelled : nullptr);
        juce::MessageManager::callAsync([safe, file, error]
        {
            if (!safe) { file.deleteFile(); return; }
            safe->busy = safe->preparingPlayback = false;
            const bool wasCancelled = safe->cancelled.exchange(false);
            if (error.isNotEmpty() || wasCancelled)
            { file.deleteFile(); safe->showStatus(error.isNotEmpty() ? error : "Playback preparation cancelled.", error.isNotEmpty()); return; }
            const auto loadError = safe->engine.playPrepared(file);
            if (loadError.isNotEmpty()) file.deleteFile();
            safe->showStatus(loadError.isEmpty() ? "Safe Playback ready. Effects are rendered; no plugin DSP runs in the playback callback."
                : loadError, loadError.isNotEmpty());
        });
    });
}
MainComponent::ClipUndo MainComponent::captureEdit() const
{
    ClipUndo edit; edit.tracks = engine.tracks(); edit.selected = selectedId;
    edit.position = engine.position(); edit.revision = engine.revision();
    for (auto& track : edit.tracks) { std::vector<std::array<float, 2>>().swap(track.delay); track.delayPosition = 0; }
    return edit;
}
void MainComponent::rememberEdit(ClipUndo edit)
{
    edit.revision = engine.revision();
    clipUndo.push_back(std::move(edit));
    if (clipUndo.size() > 20) clipUndo.erase(clipUndo.begin());
    dirty = true; hasMeasurements = false; refreshControls(); repaint();
}
void MainComponent::editMenu()
{
    if (!canEdit()) return;
    juce::PopupMenu menu;
    menu.addItem(1, "Copy selected clip    Ctrl+C", selectedId.isNotEmpty());
    menu.addItem(2, "Paste at playhead    Ctrl+V", clipboardReady);
    menu.addItem(3, "Split at playhead    Ctrl+E", selectedId.isNotEmpty());
    menu.addItem(4, "Splice range / close gap...", selectedId.isNotEmpty());
    menu.addSeparator(); menu.addItem(5, "Undo clip edit    Ctrl+Z", !clipUndo.empty());
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&editButton),
        [safe = juce::Component::SafePointer<MainComponent>(this)](int choice)
    {
        if (!safe) return;
        if (choice == 1) safe->copyClip();
        if (choice == 2) safe->pasteClip();
        if (choice == 3) safe->splitClip();
        if (choice == 4) safe->spliceClip();
        if (choice == 5) safe->undoClipEdit();
    });
}
void MainComponent::copyClip()
{
    if (!canEdit()) return;
    const auto tracks = engine.tracks();
    const auto selected = std::find_if(tracks.begin(), tracks.end(), [&](const Track& track) { return track.id == selectedId; });
    if (selected == tracks.end()) { showStatus("Select a clip to copy.", true); return; }
    clipboard = *selected;
    if (clipboard.plugins) clipboard.savedPlugins = clipboard.plugins->save();
    clipboard.plugins.reset(); clipboard.delay = {}; clipboardReady = true;
    showStatus("Copied the trimmed clip and effect settings. Place the playhead, then Paste. Source audio is unchanged.");
}
void MainComponent::pasteClip()
{
    if (!canEdit() || !clipboardReady) { showStatus("Copy an audio clip first.", true); return; }
    auto before = captureEdit(); juce::String error, id;
    if (!engine.pasteClip(clipboard, engine.position(), id, error)) { showStatus(error, true); return; }
    selectedId = id; rememberEdit(std::move(before));
    showStatus("Pasted on a new clip lane at the playhead, with independent effect instances. Ctrl+Z undoes.");
}
void MainComponent::splitClip()
{
    if (!canEdit()) return;
    auto before = captureEdit(); juce::String error, id;
    if (!engine.splitClip(selectedId, engine.position(), id, error)) { showStatus(error, true); return; }
    selectedId = id; rememberEdit(std::move(before));
    showStatus("Split at the playhead. Both pieces reference the unchanged source on separate clip lanes. Ctrl+Z undoes.");
}
void MainComponent::spliceClip()
{
    if (!canEdit()) return;
    const auto tracks = engine.tracks();
    const auto selected = std::find_if(tracks.begin(), tracks.end(), [&](const Track& track) { return track.id == selectedId; });
    if (selected == tracks.end()) { showStatus("Select a clip to splice.", true); return; }
    const auto id = selectedId;
    auto* dialog = new juce::AlertWindow("Splice audio range",
        "Remove a range from the selected clip and close its gap. Other lanes do not move. "
        "Enter timeline seconds. Original audio is preserved; 5 ms edge fades reduce clicks.",
        juce::AlertWindow::NoIcon);
    dialog->addTextEditor("start", juce::String(std::clamp(engine.position(), selected->offset, selected->offset + selected->duration()), 6), "Start (timeline seconds)");
    dialog->addTextEditor("end", juce::String(selected->offset + selected->duration(), 6), "End (timeline seconds)");
    dialog->addButton("Splice", 1); dialog->addButton("Cancel", 0);
    dialog->enterModalState(true, juce::ModalCallbackFunction::create(
        [safe = juce::Component::SafePointer<MainComponent>(this), dialog, id](int result)
    {
        if (result != 1 || !safe || !safe->canEdit()) return;
        const auto startText = dialog->getTextEditorContents("start").trim();
        const auto endText = dialog->getTextEditorContents("end").trim();
        const auto parse = [](const juce::String& value, double& number)
        {
            const auto utf8 = value.toRawUTF8(); char* endPointer = nullptr;
            number = std::strtod(utf8, &endPointer);
            return endPointer != utf8 && *endPointer == '\0' && std::isfinite(number);
        };
        double start = 0, end = 0;
        if (!parse(startText, start) || !parse(endText, end))
        { safe->showStatus("Enter valid numeric start and end times.", true); return; }
        auto before = safe->captureEdit(); juce::String error;
        if (!safe->engine.spliceClip(id, start, end, error))
        { safe->showStatus(error, true); return; }
        const auto remaining = safe->engine.tracks();
        if (std::none_of(remaining.begin(), remaining.end(), [&](const Track& track) { return track.id == safe->selectedId; }))
            safe->selectedId.clear();
        safe->rememberEdit(std::move(before));
        safe->showStatus("Splice complete; selected clip gap closed, source file preserved. Ctrl+Z undoes.");
    }), true);
}
void MainComponent::undoClipEdit()
{
    if (!canEdit() || clipUndo.empty()) return;
    if (clipUndo.back().revision != engine.revision())
    { clipUndo.clear(); showStatus("Clip undo was cleared by a later project change.", true); return; }
    auto previous = std::move(clipUndo.back()); clipUndo.pop_back();
    engine.replaceTracks(std::move(previous.tracks), engine.masterSettings());
    engine.seek(previous.position); selectedId = previous.selected;
    if (!clipUndo.empty()) clipUndo.back().revision = engine.revision();
    dirty = true; hasMeasurements = false; refreshControls(); repaint();
    showStatus("Clip edit undone. Source files were not changed.");
}
}
