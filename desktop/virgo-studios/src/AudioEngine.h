#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include "AudioDSP.h"
#include <atomic>
#include <memory>
#include <vector>

namespace studio
{
struct Track
{
    juce::String id, name;
    juce::File file;
    std::shared_ptr<juce::AudioBuffer<float>> audio;
    std::shared_ptr<std::vector<std::array<float, 2>>> waveform;
    double sourceRate = 48000, offset = 0, trimStart = 0, trimEnd = 0;
    float volumeDb = 0, pan = 0;
    bool mute = false, solo = false;
    RepairSettings repair;
    RepairDSP dsp;
    double duration() const { return std::max(0.0, trimEnd - trimStart); }
};

struct RenderState
{
    std::vector<Track> tracks;
    MasterSettings master;
    MasterDSP masterDSP;
    double rate = 48000, duration = 0;
    bool anySolo = false;
    void prepare(double sampleRate);
    void frame(double time, float& left, float& right);
};

class AudioEngine final : private juce::AudioIODeviceCallback
{
public:
    AudioEngine();
    ~AudioEngine() override;
    juce::String initialise();
    static Track loadTrack(const juce::File&, juce::String& error);
    bool addTrack(Track, juce::String& error);
    std::vector<Track> tracks() const;
    void updateTrack(const juce::String& id, const std::function<void(Track&)>&);
    void removeTrack(const juce::String& id);
    void replaceTracks(std::vector<Track>, MasterSettings);
    void setMaster(MasterSettings);
    MasterSettings masterSettings() const;
    RenderState snapshot(bool includeMaster = true) const;
    void play();
    void pause();
    void stop();
    void seek(double seconds);
    bool isPlaying() const { return playing.load(); }
    double position() const { return playhead.load(); }
    double duration() const;
    float peakLevel() const { return outputPeak.load(); }
    bool isRecording() const { return recording.load(); }
    bool hasRecordingOverrun() const { return recordingOverrun.load(); }
    juce::String startRecording(const juce::File&);
    juce::File stopRecording();
    double recordingOffset() const { return recordOffset; }
    static Measurements analyse(RenderState, std::atomic<bool>* cancelled = nullptr);
    static juce::String exportWav(RenderState, const juce::File&, std::atomic<bool>* cancelled = nullptr);
    juce::AudioDeviceManager devices;

private:
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const*, int,
                                         int, const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice*) override;
    void audioDeviceStopped() override {}
    mutable juce::CriticalSection mutex;
    RenderState state;
    std::atomic<bool> playing {false}, recording {false}, recordingOverrun {false};
    std::atomic<double> playhead {0};
    std::atomic<float> outputPeak {0};
    juce::TimeSliceThread recordThread {"Virgo recording writer"};
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> recorder;
    juce::File recordingFile;
    double recordOffset = 0;
};
}
