#pragma once
#include <juce_audio_utils/juce_audio_utils.h>

namespace studio
{
// The browser owns its catalogue and scanner for the lifetime of its window.
std::unique_ptr<juce::DocumentWindow> createPluginBrowser(
    std::function<juce::String(const juce::PluginDescription&)> loadEffect);
}
