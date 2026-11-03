#include "AudioEngine.h"
#include <limits>

namespace studio
{
void RenderState::prepare(double sampleRate)
{
    rate = sampleRate;
    duration = 0;
    anySolo = false;
    for (auto& track : tracks)
    {
        track.dsp.prepare(rate, track.repair);
        duration = std::max(duration, track.offset + track.duration());
        anySolo = anySolo || track.solo;
    }
    masterDSP.prepare(rate, master);
}

void RenderState::frame(double time, float& left, float& right)
{
    left = right = 0;
    for (auto& track : tracks)
    {
        if (track.mute || (anySolo && !track.solo) || !track.audio) continue;
        const double local = time - track.offset;
        if (local < 0 || local >= track.duration()) continue;
        const double sample = (local + track.trimStart) * track.sourceRate;
        const int index = static_cast<int>(sample);
        if (index < 0 || index >= track.audio->getNumSamples()) continue;
        const int next = std::min(index + 1, track.audio->getNumSamples() - 1);
        const float fraction = static_cast<float>(sample - index);
        const auto read = [&](int channel)
        {
            const auto* data = track.audio->getReadPointer(std::min(channel, track.audio->getNumChannels() - 1));
            return data[index] + fraction * (data[next] - data[index]);
        };
        float l = read(0), r = read(1);
        track.dsp.process(l, r);
        const float level = gain(track.volumeDb);
        // Stereo balance: preserves unity at centre, attenuates the opposite side.
        left += l * level * std::min(1.0f, 1.0f - track.pan);
        right += r * level * std::min(1.0f, 1.0f + track.pan);
    }
    masterDSP.process(left, right);
}

AudioEngine::AudioEngine() { recordThread.startThread(); }

AudioEngine::~AudioEngine()
{
    devices.removeAudioCallback(this);
    stopRecording();
    recordThread.stopThread(5000);
}

juce::String AudioEngine::initialise()
{
    auto error = devices.initialiseWithDefaultDevices(2, 2);
    if (error.isNotEmpty()) error = devices.initialiseWithDefaultDevices(0, 2);
    if (error.isEmpty()) devices.addAudioCallback(this);
    return error;
}

Track AudioEngine::loadTrack(const juce::File& file, juce::String& error)
{
    juce::AudioFormatManager formats;
    formats.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(file));
    Track track;
    if (!reader) { error = "Unsupported or unreadable audio: " + file.getFileName(); return track; }
    const auto channels = std::min(2u, reader->numChannels);
    const auto length = reader->lengthInSamples;
    if (length <= 0 || channels == 0 || reader->sampleRate < 8000
        || length > std::numeric_limits<int>::max()
        || length * channels * sizeof(float) > 256ULL * 1024 * 1024)
    {
        error = "Audio must be nonempty and at most 256 MB decoded per track. Split longer files first.";
        return track;
    }
    track.audio = std::make_shared<juce::AudioBuffer<float>>(static_cast<int>(channels), static_cast<int>(length));
    if (!reader->read(track.audio.get(), 0, static_cast<int>(length), 0, true, channels > 1))
    {
        error = "Could not decode " + file.getFileName(); track.audio.reset(); return track;
    }
    // Damaged floating-point files must never propagate NaN into the device.
    for (int channel = 0; channel < track.audio->getNumChannels(); ++channel)
        for (int sample = 0; sample < track.audio->getNumSamples(); ++sample)
            if (!std::isfinite(track.audio->getSample(channel, sample)))
            {
                error = "This file contains invalid floating-point samples: " + file.getFileName();
                track.audio.reset(); return track;
            }
    track.id = juce::Uuid().toString(); track.name = file.getFileNameWithoutExtension();
    track.file = file; track.sourceRate = reader->sampleRate;
    track.trimEnd = static_cast<double>(length) / track.sourceRate;
    track.waveform = std::make_shared<std::vector<std::array<float, 2>>>();
    for (int start = 0; start < track.audio->getNumSamples(); start += 512)
    {
        float low = 0, high = 0;
        for (int i = start; i < std::min(start + 512, track.audio->getNumSamples()); ++i)
            for (int channel = 0; channel < track.audio->getNumChannels(); ++channel)
            {
                low = std::min(low, track.audio->getSample(channel, i));
                high = std::max(high, track.audio->getSample(channel, i));
            }
        track.waveform->push_back({low, high});
    }
    return track;
}

bool AudioEngine::addTrack(Track track, juce::String& error)
{
    if (!track.audio) { error = "No decoded audio."; return false; }
    const juce::ScopedLock lock(mutex);
    std::uint64_t bytes = 0;
    for (const auto& value : state.tracks)
        bytes += static_cast<std::uint64_t>(value.audio->getNumSamples()) * value.audio->getNumChannels() * sizeof(float);
    bytes += static_cast<std::uint64_t>(track.audio->getNumSamples()) * track.audio->getNumChannels() * sizeof(float);
    if (bytes > 512ULL * 1024 * 1024 || state.tracks.size() >= 32)
    {
        error = "This first version supports 32 tracks and 512 MB of decoded project audio.";
        return false;
    }
    state.tracks.push_back(std::move(track)); state.prepare(state.rate);
    return true;
}

std::vector<Track> AudioEngine::tracks() const
{
    const juce::ScopedLock lock(mutex); return state.tracks;
}

void AudioEngine::updateTrack(const juce::String& id, const std::function<void(Track&)>& update)
{
    const juce::ScopedLock lock(mutex);
    for (auto& track : state.tracks) if (track.id == id) update(track);
    state.prepare(state.rate);
}

void AudioEngine::removeTrack(const juce::String& id)
{
    const juce::ScopedLock lock(mutex);
    state.tracks.erase(std::remove_if(state.tracks.begin(), state.tracks.end(),
        [&](const Track& track) { return track.id == id; }), state.tracks.end());
    state.prepare(state.rate);
}

void AudioEngine::replaceTracks(std::vector<Track> tracks, MasterSettings master)
{
    stop();
    const juce::ScopedLock lock(mutex);
    state.tracks = std::move(tracks); state.master = master; state.prepare(state.rate);
}

void AudioEngine::setMaster(MasterSettings master)
{
    const juce::ScopedLock lock(mutex);
    state.master = master; state.masterDSP.prepare(state.rate, master);
}

MasterSettings AudioEngine::masterSettings() const
{
    const juce::ScopedLock lock(mutex); return state.master;
}

RenderState AudioEngine::snapshot(bool includeMaster) const
{
    const juce::ScopedLock lock(mutex);
    auto result = state;
    if (!includeMaster) result.master.enabled = false;
    result.prepare(48000); return result;
}

void AudioEngine::play() { playing.store(true); }
void AudioEngine::pause() { playing.store(false); }
void AudioEngine::stop() { playing.store(false); seek(0); }
void AudioEngine::seek(double seconds)
{
    if (recording.load()) return;
    const juce::ScopedLock lock(mutex);
    playhead.store(std::clamp(seconds, 0.0, state.duration));
    state.prepare(state.rate);
}
double AudioEngine::duration() const { const juce::ScopedLock lock(mutex); return state.duration; }

juce::String AudioEngine::startRecording(const juce::File& file)
{
    const juce::ScopedLock lock(mutex);
    if (recording.load()) return "Recording is already running.";
    const auto* device = devices.getCurrentAudioDevice();
    if (!device || device->getActiveInputChannels().countNumberOfSetBits() == 0)
        return "No audio input is enabled. Open Audio Setup and choose an input.";
    if (file.existsAsFile()) return "The recording filename already exists.";
    auto output = file.createOutputStream();
    if (!output) return "Cannot create recording file.";
    juce::WavAudioFormat wav;
    auto* writer = wav.createWriterFor(output.get(), state.rate, 2, 24, {}, 0);
    if (!writer) return "Cannot create WAV recording.";
    output.release();
    recorder = std::make_unique<juce::AudioFormatWriter::ThreadedWriter>(writer, recordThread, 131072);
    recordingFile = file; recordOffset = playhead.load();
    recording.store(true); playing.store(true);
    return {};
}

juce::File AudioEngine::stopRecording()
{
    const juce::ScopedLock lock(mutex);
    if (!recording.exchange(false)) return {};
    playing.store(false);
    recorder.reset();
    return recordingFile;
}

void AudioEngine::audioDeviceAboutToStart(juce::AudioIODevice* device)
{
    const juce::ScopedLock lock(mutex); state.prepare(device->getCurrentSampleRate());
}

void AudioEngine::audioDeviceIOCallbackWithContext(const float* const* inputs, int numInputs,
    float* const* outputs, int numOutputs, int count, const juce::AudioIODeviceCallbackContext&)
{
    juce::ScopedNoDenormals noDenormals;
    for (int ch = 0; ch < numOutputs; ++ch) if (outputs[ch]) juce::FloatVectorOperations::clear(outputs[ch], count);
    const juce::ScopedLock lock(mutex);
    if (recording.load() && recorder && numInputs > 0 && inputs[0])
    {
        const float* recordingInputs[] = { inputs[0], numInputs > 1 && inputs[1] ? inputs[1] : inputs[0] };
        if (!recorder->write(recordingInputs, count))
        {
            // Preserve recorded data and stop rather than silently losing frames.
            playing.store(false);
        }
    }
    if (!playing.load()) { outputPeak.store(0); return; }
    double time = playhead.load();
    float peak = 0;
    for (int i = 0; i < count; ++i)
    {
        float left = 0, right = 0;
        state.frame(time, left, right);
        peak = std::max({peak, std::abs(left), std::abs(right)});
        // Device safety only. Export checks unmastered clipping separately.
        if (numOutputs > 0 && outputs[0]) outputs[0][i] = std::clamp(left, -1.0f, 1.0f);
        if (numOutputs > 1 && outputs[1]) outputs[1][i] = std::clamp(right, -1.0f, 1.0f);
        time += 1.0 / state.rate;
    }
    playhead.store(time); outputPeak.store(peak);
    if (!recording.load() && time >= state.duration) playing.store(false);
}

Measurements AudioEngine::analyse(RenderState render, std::atomic<bool>* cancelled)
{
    Measurements l, r;
    const auto samples = static_cast<std::int64_t>(std::ceil(render.duration * render.rate));
    for (std::int64_t i = 0; i < samples; ++i)
    {
        if (cancelled && (i % 4096 == 0) && cancelled->load()) return {};
        float left = 0, right = 0; render.frame(i / render.rate, left, right);
        l.push(left); r.push(right);
    }
    l.samples += r.samples; l.sum += r.sum; l.squares += r.squares;
    l.peak = std::max(l.peak, r.peak); l.clipped += r.clipped; l.clicks += r.clicks;
    return l;
}

juce::String AudioEngine::exportWav(RenderState render, const juce::File& file, std::atomic<bool>* cancelled)
{
    for (const auto& track : render.tracks)
        if (track.file == file) return "Export cannot overwrite source audio.";
    if (render.duration <= 0) return "The project has no audio to export.";
    juce::TemporaryFile temporary(file);
    auto output = temporary.getFile().createOutputStream();
    if (!output) return "Cannot open export destination.";
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::AudioFormatWriter> writer(wav.createWriterFor(output.get(), render.rate, 2, 24, {}, 0));
    if (!writer) return "Could not create WAV writer.";
    output.release();
    juce::AudioBuffer<float> block(2, 1024);
    const auto total = static_cast<std::int64_t>(std::ceil(render.duration * render.rate));
    for (std::int64_t position = 0; position < total; position += 1024)
    {
        if (cancelled && cancelled->load()) return "Export cancelled; destination was not changed.";
        const int count = static_cast<int>(std::min<std::int64_t>(1024, total - position));
        for (int i = 0; i < count; ++i)
        {
            float left = 0, right = 0; render.frame((position + i) / render.rate, left, right);
            if (!std::isfinite(left) || !std::isfinite(right)) return "Invalid audio detected; export aborted.";
            if (std::abs(left) > 1 || std::abs(right) > 1)
                return "The mix clips. Lower track levels or enable mastering before exporting.";
            block.setSample(0, i, left); block.setSample(1, i, right);
        }
        if (!writer->writeFromAudioSampleBuffer(block, 0, count)) return "Disk write failed during export.";
    }
    writer.reset();
    if (!temporary.overwriteTargetFileWithTemporary()) return "Could not finish saving export.";
    return {};
}
}
