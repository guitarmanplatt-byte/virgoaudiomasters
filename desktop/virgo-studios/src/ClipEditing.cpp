#include "AudioEngine.h"
#include <stdexcept>

namespace studio
{
namespace
{
void resetClipRuntime(Track& track)
{
    track.delay = {}; track.delayPosition = 0; track.dsp = {};
}
Track independentClip(const Track& source, double rate)
{
    auto result = source;
    result.id = juce::Uuid().toString();
    resetClipRuntime(result);
    if (source.plugins) result.plugins = source.plugins->clone(rate);
    else if (source.savedPlugins.isArray() && source.savedPlugins.size() > 0)
    {
        result.plugins = std::make_shared<PluginChain>();
        const auto error = result.plugins->restore(source.savedPlugins, rate);
        if (error.isNotEmpty()) throw std::runtime_error(error.toStdString());
    }
    return result;
}
}
bool AudioEngine::pasteClip(const Track& clipboard, double position, juce::String& newId, juce::String& error)
{
    if (!clipboard.audio || !std::isfinite(position) || position < 0 || position > 3600)
    { error = "Copy a valid audio clip, then choose a paste position from 0 to 3600 seconds."; return false; }
    pause();
    try
    {
        auto pasted = independentClip(clipboard, state.rate);
        pasted.offset = position; pasted.name += " Copy";
        newId = pasted.id;
        return addTrack(std::move(pasted), error);
    }
    catch (const std::exception& exception) { error = "Could not copy effect settings: " + juce::String(exception.what()); return false; }
}
bool AudioEngine::splitClip(const juce::String& id, double position, juce::String& newId, juce::String& error)
{
    pause(); invalidatePreparedPlayback();
    const juce::ScopedLock lock(mutex);
    auto found = std::find_if(state.tracks.begin(), state.tracks.end(), [&](const Track& track) { return track.id == id; });
    if (found == state.tracks.end()) { error = "Select an audio clip."; return false; }
    const auto original = *found;
    const double source = std::round((position - original.offset + original.trimStart) * original.sourceRate) / original.sourceRate;
    if (!std::isfinite(source) || source <= original.trimStart || source >= original.trimEnd)
    { error = "Place the playhead inside the selected clip to split it."; return false; }
    if (state.tracks.size() >= 128) { error = "The project already has 128 clip lanes."; return false; }
    try
    {
        auto right = independentClip(original, state.rate);
        right.trimStart = source; right.offset = original.offset + source - original.trimStart;
        right.fadeIn = 0; right.name += " [R]";
        newId = right.id;
        found->trimEnd = source; found->fadeOut = 0; found->name += " [L]";
        state.tracks.insert(found + 1, std::move(right));
        state.prepare(state.rate);
        ++editRevision;
        return true;
    }
    catch (const std::exception& exception) { error = "Could not split effects: " + juce::String(exception.what()); return false; }
}
bool AudioEngine::spliceClip(const juce::String& id, double start, double end, juce::String& error)
{
    pause(); invalidatePreparedPlayback();
    const juce::ScopedLock lock(mutex);
    auto found = std::find_if(state.tracks.begin(), state.tracks.end(), [&](const Track& track) { return track.id == id; });
    if (found == state.tracks.end()) { error = "Select an audio clip."; return false; }
    const auto original = *found;
    const double low = original.offset, high = low + original.duration();
    if (!std::isfinite(start) || !std::isfinite(end) || start < low || end > high || end <= start)
    { error = "Splice start/end must form a nonempty range inside the selected clip (timeline seconds)."; return false; }
    const double a = original.trimStart + std::round((start - low) * original.sourceRate) / original.sourceRate;
    const double b = original.trimStart + std::round((end - low) * original.sourceRate) / original.sourceRate;
    if (b <= a) { error = "Select at least one sample to splice."; return false; }
    const bool leftExists = a > original.trimStart, rightExists = b < original.trimEnd;
    if (leftExists && rightExists && state.tracks.size() >= 128)
    { error = "The project already has 128 clip lanes."; return false; }
    try
    {
        std::vector<Track> replacement;
        if (leftExists)
        {
            auto left = original; resetClipRuntime(left);
            left.trimEnd = a; left.fadeOut = std::min(0.005, left.duration() * 0.25);
            left.name += " [splice L]"; replacement.push_back(std::move(left));
        }
        if (rightExists)
        {
            auto right = leftExists ? independentClip(original, state.rate) : original;
            resetClipRuntime(right); right.trimStart = b;
            right.offset = original.offset + a - original.trimStart;
            right.fadeIn = std::min(0.005, right.duration() * 0.25);
            right.name += " [splice R]"; replacement.push_back(std::move(right));
        }
        const auto index = static_cast<size_t>(found - state.tracks.begin());
        state.tracks.erase(state.tracks.begin() + static_cast<std::ptrdiff_t>(index));
        state.tracks.insert(state.tracks.begin() + static_cast<std::ptrdiff_t>(index), replacement.begin(), replacement.end());
        state.prepare(state.rate); ++editRevision; return true;
    }
    catch (const std::exception& exception) { error = "Could not splice effects: " + juce::String(exception.what()); return false; }
}
}
