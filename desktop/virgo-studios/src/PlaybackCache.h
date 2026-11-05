#pragma once
#include <juce_audio_utils/juce_audio_utils.h>

namespace studio
{
// Hardware playback reads a buffered WAV rather than executing third-party DSP.
// Loading/releasing belongs to the message thread, never the device callback.
class PlaybackCache
{
public:
    PlaybackCache() { readAhead.startThread(); }
    ~PlaybackCache() { clear(); readAhead.stopThread(5000); }
    juce::String load(const juce::File& file, double deviceRate, int blockSize)
    {
        clear();
        juce::AudioFormatManager formats; formats.registerBasicFormats();
        auto* reader = formats.createReaderFor(file);
        if (!reader) return "Could not open the prepared playback WAV.";
        source = std::make_unique<juce::AudioFormatReaderSource>(reader, true);
        sourceRate = reader->sampleRate;
        buffered = std::make_unique<juce::BufferingAudioSource>(source.get(), readAhead, false, 524288, 2, true);
        transport.prepareToPlay(std::max(128, blockSize), deviceRate);
        // At least 2.7 seconds at 192 kHz; disk work runs on readAhead.
        transport.setSource(buffered.get(), 0, nullptr,
                            std::abs(reader->sampleRate - deviceRate) < 1 ? 0 : reader->sampleRate);
        ratio = reader->sampleRate / deviceRate;
        ownedFile = file;
        ready.store(true);
        return {};
    }
    void clear()
    {
        ready.store(false);
        underrun.store(false);
        transport.stop(); transport.setSource(nullptr);
        buffered.reset(); source.reset();
        if (ownedFile != juce::File()) ownedFile.deleteFile();
        ownedFile = juce::File();
    }
    bool available() const { return ready.load(); }
    bool play(double seconds)
    {
        transport.setPosition(seconds);
        juce::AudioBuffer<float> probe(2, std::max(4096, static_cast<int>(sourceRate * 0.1)));
        if (!buffered->waitForNextAudioBlockReady(juce::AudioSourceChannelInfo(&probe, 0, probe.getNumSamples()), 5000))
            return false;
        underrun.store(false); transport.start(); return true;
    }
    void pause() { transport.stop(); }
    void seek(double seconds) { transport.setPosition(seconds); }
    bool playing() const { return transport.isPlaying(); }
    double position() const { return transport.getCurrentPosition(); }
    bool render(juce::AudioBuffer<float>& buffer)
    {
        // Never block the hardware thread waiting for storage. Stop explicitly
        // rather than advancing the playhead across missing samples.
        const int needed = static_cast<int>(std::ceil(buffer.getNumSamples() * ratio)) + 32;
        if (!buffered->waitForNextAudioBlockReady(juce::AudioSourceChannelInfo(&buffer, 0, needed), 0))
        { buffer.clear(); underrun.store(true); return false; }
        transport.getNextAudioBlock(juce::AudioSourceChannelInfo(&buffer, 0, buffer.getNumSamples()));
        return true;
    }
    bool starved() const { return underrun.load(); }
private:
    juce::TimeSliceThread readAhead {"Virgo safe playback read-ahead"};
    juce::AudioTransportSource transport;
    std::unique_ptr<juce::AudioFormatReaderSource> source;
    std::unique_ptr<juce::BufferingAudioSource> buffered;
    juce::File ownedFile;
    std::atomic<bool> ready {false};
    std::atomic<bool> underrun {false};
    double sourceRate = 48000, ratio = 1;
};
}
