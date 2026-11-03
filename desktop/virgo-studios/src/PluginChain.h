#pragma once
#include <juce_audio_processors/juce_audio_processors.h>

namespace studio
{
// A render snapshot owns independent plugin instances, never the live rack.
class PluginChain : private juce::AudioProcessorListener
{
public:
    ~PluginChain() override;
    std::atomic<bool> changed {false};
    struct Entry
    {
        juce::PluginDescription description;
        std::unique_ptr<juce::AudioPluginInstance> processor;
        bool bypass = false;
    };
    std::vector<Entry> entries;
    juce::String add(const juce::File&, double rate);
    juce::String restore(const juce::var&, double rate);
    juce::var save() const;
    std::shared_ptr<PluginChain> clone(double rate) const;
    void prepare(double rate);
    bool process(juce::AudioBuffer<float>&, double seconds);
    int latency() const;
private:
    double currentRate = 0;
    static juce::AudioPluginFormatManager& formats();
    juce::String instantiate(const juce::PluginDescription&, const juce::MemoryBlock&, bool, double);
    void audioProcessorParameterChanged(juce::AudioProcessor*, int, float) override { changed.store(true); }
    void audioProcessorChanged(juce::AudioProcessor*, const juce::AudioProcessorListener::ChangeDetails&) override { changed.store(true); }
};
}
