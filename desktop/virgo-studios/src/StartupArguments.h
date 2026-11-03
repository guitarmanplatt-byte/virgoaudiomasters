#pragma once
#include <juce_core/juce_core.h>

namespace studio
{
inline juce::String startupArgument(const juce::String& commandLine)
{
    const auto tokens = juce::StringArray::fromTokens(commandLine, true);
    return tokens.isEmpty() ? juce::String() : tokens[0].unquoted();
}
}
