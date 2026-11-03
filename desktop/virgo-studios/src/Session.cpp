#include "MainComponent.h"

namespace studio
{
namespace
{
juce::var makeObject(std::initializer_list<std::pair<juce::Identifier, juce::var>> fields)
{
    auto* result = new juce::DynamicObject();
    for (const auto& field : fields) result->setProperty(field.first, field.second);
    return juce::var(result);
}
float number(const juce::var& object, const juce::Identifier& key, float fallback, float low, float high)
{
    if (!object.hasProperty(key)) return fallback;
    const float value = static_cast<float>(object[key]);
    return std::isfinite(value) ? std::clamp(value, low, high) : fallback;
}
}

juce::var MainComponent::trackToJson(const Track& track, const juce::File& file)
{
    return makeObject({
        {"id", track.id}, {"name", track.name}, {"file", file.getFullPathName()},
        {"offset", track.offset}, {"trimStart", track.trimStart}, {"trimEnd", track.trimEnd},
        {"volumeDb", track.volumeDb}, {"pan", track.pan}, {"mute", track.mute}, {"solo", track.solo},
        {"repair", makeObject({{"enabled", track.repair.enabled}, {"highPass", track.repair.highPass},
            {"hum", track.repair.hum}, {"humHz", track.repair.humHz}, {"gate", track.repair.gate},
            {"gateDb", track.repair.gateDb}, {"deClick", track.repair.deClick}})}
    });
}

juce::var MainComponent::masterToJson(MasterSettings master)
{
    return makeObject({{"enabled", master.enabled}, {"gainDb", master.gainDb},
        {"thresholdDb", master.thresholdDb}, {"ceilingDb", master.ceilingDb}, {"warmth", master.warmth}});
}

void MainComponent::saveProject(std::function<void(bool)> completion)
{
    if (!canEdit()) { if (completion) completion(false); return; }
    chooser = std::make_unique<juce::FileChooser>("Save Virgo Studios project",
        projectFile == juce::File() ? juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("Untitled.virgo")
                                   : projectFile, "*.virgo");
    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
        | juce::FileBrowserComponent::warnAboutOverwriting,
        [safe = juce::Component::SafePointer<MainComponent>(this), completion](const juce::FileChooser& choice)
    {
        if (!safe) return;
        auto destination = choice.getResult();
        if (destination == juce::File()) { if (completion) completion(false); return; }
        destination = destination.withFileExtension(".virgo");
        if (safe->busy || safe->engine.isRecording()) { if (completion) completion(false); return; }
        safe->busy = true;
        auto render = safe->engine.snapshot();
        safe->showStatus("Saving project and preserving source media...");
        safe->worker.addJob([safe, destination, render, completion]
        {
            juce::String error;
            const auto media = destination.getSiblingFile(destination.getFileNameWithoutExtension() + ".media");
            if (media.createDirectory().failed()) error = "Cannot create project media directory.";
            juce::Array<juce::var> serializedTracks;
            for (const auto& track : render.tracks)
            {
                if (error.isNotEmpty()) break;
                const auto target = media.getChildFile(track.id + track.file.getFileExtension());
                if (track.file != target && !target.existsAsFile() && !track.file.copyFileTo(target))
                {
                    error = "Could not preserve source media: " + track.file.getFullPathName(); break;
                }
                auto json = trackToJson(track, target);
                json.getDynamicObject()->setProperty("file", target.getRelativePathFrom(destination.getParentDirectory()));
                serializedTracks.add(json);
            }
            if (error.isEmpty())
            {
                const auto json = makeObject({{"format", "Virgo Studios"}, {"version", 1},
                    {"tracks", serializedTracks}, {"master", masterToJson(render.master)}});
                juce::TemporaryFile temporary(destination);
                if (!temporary.getFile().replaceWithText(juce::JSON::toString(json, false))
                    || !temporary.overwriteTargetFileWithTemporary())
                    error = "Could not save project. Any existing project file was left intact.";
            }
            juce::MessageManager::callAsync([safe, destination, error, completion]
            {
                if (!safe) return;
                safe->busy = false;
                if (error.isEmpty()) { safe->dirty = false; safe->projectFile = destination; }
                safe->showStatus(error.isEmpty() ? "Saved " + destination.getFileName() + " with its .media folder." : error, error.isNotEmpty());
                if (completion) completion(error.isEmpty());
            });
        });
    });
}

void MainComponent::confirmDiscard(std::function<void()> continuation)
{
    if (!dirty) { continuation(); return; }
    juce::AlertWindow::showYesNoCancelBox(juce::AlertWindow::QuestionIcon, "Unsaved Virgo Studios project",
        "Save your changes before continuing?", "Save", "Discard", "Cancel", this,
        juce::ModalCallbackFunction::create(
            [safe = juce::Component::SafePointer<MainComponent>(this), continuation](int result)
        {
            if (!safe) return;
            if (result == 1) safe->saveProject([continuation](bool saved) { if (saved) continuation(); });
            else if (result == 2) continuation();
        }));
}

void MainComponent::requestClose(std::function<void()> continuation)
{
    if (busy) { showStatus("Wait for the current operation to finish before closing.", true); return; }
    if (engine.isRecording()) { showStatus("Finish the current take before closing; the WAV is being written to Documents.", true); return; }
    confirmDiscard(std::move(continuation));
}

void MainComponent::openProject()
{
    if (!canEdit()) return;
    confirmDiscard([safe = juce::Component::SafePointer<MainComponent>(this)]
    {
        if (!safe) return;
        safe->chooser = std::make_unique<juce::FileChooser>("Open Virgo Studios project", juce::File(), "*.virgo");
        safe->chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
            [safe](const juce::FileChooser& choice)
        {
            if (!safe || choice.getResult() == juce::File()) return;
            const auto file = choice.getResult();
            safe->busy = true; safe->showStatus("Opening project...");
            safe->worker.addJob([safe, file]
            {
                const auto data = juce::JSON::parse(file.loadFileAsString());
                juce::String error;
                std::vector<Track> loaded;
                MasterSettings master;
                const auto* list = data["tracks"].getArray();
                if (data["format"].toString() != "Virgo Studios" || static_cast<int>(data["version"]) != 1
                    || !list || list->size() > 32)
                    error = "This is not a supported Virgo Studios project.";
                std::uint64_t bytes = 0;
                if (error.isEmpty()) for (const auto& item : *list)
                {
                    const auto path = item["file"].toString();
                    const auto source = juce::File::isAbsolutePath(path) ? juce::File(path) : file.getParentDirectory().getChildFile(path);
                    auto track = AudioEngine::loadTrack(source, error);
                    if (error.isNotEmpty()) break;
                    bytes += static_cast<std::uint64_t>(track.audio->getNumSamples()) * track.audio->getNumChannels() * sizeof(float);
                    if (bytes > 512ULL * 1024 * 1024) { error = "Project exceeds the 512 MB decoded-audio limit."; break; }
                    // IDs supplied by a project are not trusted as filesystem names.
                    track.name = item["name"].toString().substring(0, 120);
                    track.offset = number(item, "offset", 0, 0, 3600);
                    const auto full = static_cast<float>(track.trimEnd);
                    track.trimStart = number(item, "trimStart", 0, 0, std::max(0.0f, full - 0.001f));
                    track.trimEnd = number(item, "trimEnd", full, static_cast<float>(track.trimStart + 0.001), full);
                    track.volumeDb = number(item, "volumeDb", 0, -60, 12); track.pan = number(item, "pan", 0, -1, 1);
                    track.mute = static_cast<bool>(item["mute"]); track.solo = static_cast<bool>(item["solo"]);
                    const auto repair = item["repair"];
                    track.repair.enabled = static_cast<bool>(repair["enabled"]);
                    track.repair.highPass = static_cast<bool>(repair["highPass"]);
                    track.repair.hum = static_cast<bool>(repair["hum"]);
                    track.repair.humHz = number(repair, "humHz", 60, 50, 60) < 55 ? 50.0f : 60.0f;
                    track.repair.gate = static_cast<bool>(repair["gate"]);
                    track.repair.gateDb = number(repair, "gateDb", -55, -80, -25);
                    track.repair.deClick = static_cast<bool>(repair["deClick"]);
                    loaded.push_back(std::move(track));
                }
                const auto m = data["master"];
                master.enabled = static_cast<bool>(m["enabled"]);
                master.gainDb = number(m, "gainDb", 0, -12, 12);
                master.thresholdDb = number(m, "thresholdDb", -16, -30, -6);
                master.ceilingDb = number(m, "ceilingDb", -1, -6, -0.1f);
                master.warmth = number(m, "warmth", 0.12f, 0, 0.3f);
                juce::MessageManager::callAsync([safe, file, loaded = std::move(loaded), master, error]() mutable
                {
                    if (!safe) return;
                    safe->busy = false;
                    if (error.isEmpty())
                    {
                        safe->engine.replaceTracks(std::move(loaded), master);
                        safe->projectFile = file; safe->selectedId.clear(); safe->dirty = false;
                        safe->hasMeasurements = false; safe->scrollRow = 0; safe->refreshControls();
                    }
                    safe->showStatus(error.isEmpty() ? "Opened " + file.getFileName()
                        : error + " Your current project was not replaced.", error.isNotEmpty());
                });
            });
        });
    });
}

void MainComponent::exportAudio()
{
    if (!canEdit()) return;
    if (engine.duration() <= 0) { showStatus("Import or record audio first.", true); return; }
    chooser = std::make_unique<juce::FileChooser>("Export stereo master",
        juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("Virgo Master.wav"), "*.wav");
    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
        | juce::FileBrowserComponent::warnAboutOverwriting,
        [safe = juce::Component::SafePointer<MainComponent>(this)](const juce::FileChooser& choice)
    {
        if (!safe || choice.getResult() == juce::File() || safe->busy || safe->engine.isRecording()) return;
        const auto file = choice.getResult().withFileExtension(".wav");
        auto render = safe->engine.snapshot();
        safe->busy = true; safe->showStatus("Rendering stereo 48 kHz / 24-bit WAV...");
        safe->worker.addJob([safe, file, render]
        {
            const auto error = AudioEngine::exportWav(render, file);
            juce::MessageManager::callAsync([safe, file, error]
            {
                if (!safe) return;
                safe->busy = false;
                safe->showStatus(error.isEmpty() ? "Exported " + file.getFullPathName() : error, error.isNotEmpty());
            });
        });
    });
}
}
