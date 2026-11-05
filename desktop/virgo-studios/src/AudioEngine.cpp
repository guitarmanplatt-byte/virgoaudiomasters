#include "AudioEngine.h"
#include <limits>

namespace studio
{
void RenderState::prepare(double sampleRate)
{
    rate = sampleRate;
    duration = 0;
    anySolo = false;
    nextTime = -1;
    commonLatency = 0;
    for (auto& track : tracks)
    {
        if (track.plugins)
        {
            track.plugins->prepare(rate, offline);
            commonLatency = std::max(commonLatency, track.plugins->latency());
        }
    }
    for (auto& track : tracks)
    {
        track.dsp.prepare(rate, track.repair);
        track.delay.assign(static_cast<size_t>(commonLatency - (track.plugins ? track.plugins->latency() : 0)), {0, 0});
        track.delayPosition = 0;
        double tail = 0;
        if (track.plugins)
            for (const auto& entry : track.plugins->entries)
                if (!entry.bypass)
                {
                    const double seconds = entry.processor->getTailLengthSeconds();
                    if (std::isfinite(seconds)) tail += std::clamp(seconds, 0.0, 10.0);
                }
        duration = std::max(duration, track.offset + track.duration() + std::min(10.0, tail));
        anySolo = anySolo || track.solo;
    }
    masterDSP.prepare(rate, master);
}

void RenderState::frame(double time, float& left, float& right)
{
    juce::AudioBuffer<float> value(2, 1);
    block(time, value);
    left = value.getSample(0, 0); right = value.getSample(1, 0);
}

void RenderState::block(double time, juce::AudioBuffer<float>& output)
{
    // Feed ahead by the common latency; all tracks emerge on the same grid.
    if (nextTime < 0 || std::abs(nextTime - time) > 0.5 / rate)
    {
        for (int done = 0; done < commonLatency; done += 128)
        {
            float storage[2][128] {};
            float* channels[] {storage[0], storage[1]};
            juce::AudioBuffer<float> discarded(channels, 2, std::min(128, commonLatency - done));
            processRaw(time + done / rate, discarded);
        }
    }
    processRaw(time + commonLatency / rate, output);
    nextTime = time + output.getNumSamples() / rate;
}

void RenderState::processRaw(double time, juce::AudioBuffer<float>& output)
{
    output.clear();
    const int count = output.getNumSamples();
    jassert(count <= 128);
    float storage[2][128] {};
    float* channels[] {storage[0], storage[1]};
    juce::AudioBuffer<float> input(channels, 2, count);
    for (auto& track : tracks)
    {
        if (track.mute || (anySolo && !track.solo) || !track.audio) continue;
        input.clear();
        for (int i = 0; i < count; ++i)
        {
        const double local = time + i / rate - track.offset;
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
        float envelope = 1;
        if (track.fadeIn > 0) envelope *= static_cast<float>(std::min(1.0, local / track.fadeIn));
        if (track.fadeOut > 0) envelope *= static_cast<float>(std::min(1.0, (track.duration() - local) / track.fadeOut));
        float l = read(0) * envelope, r = read(1) * envelope;
        track.dsp.process(l, r);
        input.setSample(0, i, l); input.setSample(1, i, r);
        }
        if (track.plugins && !track.plugins->process(input, time))
        {
            error = "A plugin produced invalid audio on " + track.name + ". Bypass or remove the effect.";
            output.clear();
            return;
        }
        const float level = gain(track.volumeDb);
        for (int i = 0; i < count; ++i)
        {
            float l = input.getSample(0, i), r = input.getSample(1, i);
            if (!track.delay.empty())
            {
                auto& delayed = track.delay[static_cast<size_t>(track.delayPosition)];
                const auto previous = delayed; delayed = {l, r}; l = previous[0]; r = previous[1];
                track.delayPosition = (track.delayPosition + 1) % static_cast<int>(track.delay.size());
            }
            output.addSample(0, i, l * level * std::min(1.0f, 1.0f - track.pan));
            output.addSample(1, i, r * level * std::min(1.0f, 1.0f + track.pan));
        }
    }
    for (int i = 0; i < count; ++i)
    {
        float l = output.getSample(0, i), r = output.getSample(1, i);
        masterDSP.process(l, r); output.setSample(0, i, l); output.setSample(1, i, r);
    }
}

AudioEngine::AudioEngine() { recordThread.startThread(); }

AudioEngine::~AudioEngine()
{
    devices.removeAudioCallback(this);
    playbackCache.clear();
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
    invalidatePreparedPlayback();
    const juce::ScopedLock lock(mutex);
    std::uint64_t bytes = 0;
    std::vector<const void*> counted;
    for (const auto& value : state.tracks)
        if (value.audio && std::find(counted.begin(), counted.end(), value.audio.get()) == counted.end())
        {
            counted.push_back(value.audio.get());
            bytes += static_cast<std::uint64_t>(value.audio->getNumSamples()) * value.audio->getNumChannels() * sizeof(float);
        }
    if (std::find(counted.begin(), counted.end(), track.audio.get()) == counted.end())
        bytes += static_cast<std::uint64_t>(track.audio->getNumSamples()) * track.audio->getNumChannels() * sizeof(float);
    if (bytes > 512ULL * 1024 * 1024 || state.tracks.size() >= 128)
    {
        error = "This version supports 128 clip lanes and 512 MB of unique decoded project audio.";
        return false;
    }
    state.tracks.push_back(std::move(track)); state.prepare(state.rate); ++editRevision;
    return true;
}

std::vector<Track> AudioEngine::tracks() const
{
    const juce::ScopedLock lock(mutex); return state.tracks;
}

void AudioEngine::updateTrack(const juce::String& id, const std::function<void(Track&)>& update)
{
    invalidatePreparedPlayback();
    const juce::ScopedLock lock(mutex);
    for (auto& track : state.tracks) if (track.id == id) update(track);
    state.error.clear();
    state.prepare(state.rate);
    ++editRevision;
}

void AudioEngine::removeTrack(const juce::String& id)
{
    invalidatePreparedPlayback();
    const juce::ScopedLock lock(mutex);
    state.tracks.erase(std::remove_if(state.tracks.begin(), state.tracks.end(),
        [&](const Track& track) { return track.id == id; }), state.tracks.end());
    state.prepare(state.rate);
    ++editRevision;
}

void AudioEngine::replaceTracks(std::vector<Track> tracks, MasterSettings master)
{
    invalidatePreparedPlayback();
    stop();
    const juce::ScopedLock lock(mutex);
    state.tracks = std::move(tracks); state.master = master; state.prepare(state.rate); ++editRevision;
}

void AudioEngine::setMaster(MasterSettings master)
{
    invalidatePreparedPlayback();
    const juce::ScopedLock lock(mutex);
    state.master = master; state.masterDSP.prepare(state.rate, master); ++editRevision;
}

MasterSettings AudioEngine::masterSettings() const
{
    const juce::ScopedLock lock(mutex); return state.master;
}

RenderState AudioEngine::snapshot(bool includeMaster, bool clonePlugins) const
{
    const juce::ScopedLock lock(mutex);
    auto result = state;
    try
    {
        for (auto& track : result.tracks)
            if (track.plugins)
            {
                track.savedPlugins = track.plugins->save();
                track.plugins = clonePlugins ? track.plugins->clone(48000) : nullptr;
            }
    }
    catch (const std::exception& exception)
    {
        result.error = "Could not snapshot plugin rack: " + juce::String(exception.what());
        result.tracks.clear();
    }
    if (!includeMaster) result.master.enabled = false;
    result.offline = true;
    result.prepare(48000); return result;
}

void AudioEngine::play()
{
    if (playbackCache.available())
    { playing.store(playbackCache.play(playhead.load())); return; }
    const juce::ScopedLock lock(mutex);
    state.error.clear(); state.prepare(state.rate); playing.store(true);
}
juce::String AudioEngine::playPrepared(const juce::File& file)
{
    playing.store(false);
    auto error = playbackCache.load(file, deviceRate, deviceBlockSize);
    if (error.isNotEmpty()) return error;
    { const juce::ScopedLock lock(mutex); state.error.clear(); }
    if (!playbackCache.play(playhead.load()))
    { playbackCache.clear(); return "The disk read-ahead buffer could not be prepared. Try a faster/local drive."; }
    playing.store(true);
    return {};
}
void AudioEngine::invalidatePreparedPlayback()
{
    if (playbackCache.available())
    { playing.store(false); playbackCache.clear(); outputPeak.store(0); }
}
juce::String AudioEngine::processingError() const
{
    if (playbackCache.starved()) return "Safe playback paused: storage could not keep up. No timeline samples were skipped. Press Play to refill.";
    const juce::ScopedLock lock(mutex); return state.error;
}
void AudioEngine::pause() { playing.store(false); playbackCache.pause(); }
void AudioEngine::stop() { playing.store(false); seek(0); }
void AudioEngine::seek(double seconds)
{
    if (recording.load()) return;
    const juce::ScopedLock lock(mutex);
    playhead.store(std::clamp(seconds, 0.0, state.duration));
    if (playbackCache.available())
    { playing.store(false); playbackCache.pause(); playbackCache.seek(playhead.load()); }
    else state.prepare(state.rate);
}
double AudioEngine::duration() const { const juce::ScopedLock lock(mutex); return state.duration; }

juce::String AudioEngine::startRecording(const juce::File& file)
{
    invalidatePreparedPlayback();
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
    recordingOverrun.store(false); recording.store(true); playing.store(true);
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
    invalidatePreparedPlayback();
    deviceRate = device->getCurrentSampleRate();
    deviceBlockSize = device->getCurrentBufferSizeSamples();
    const juce::ScopedLock lock(mutex); state.prepare(device->getCurrentSampleRate());
}

void AudioEngine::audioDeviceIOCallbackWithContext(const float* const* inputs, int numInputs,
    float* const* outputs, int numOutputs, int count, const juce::AudioIODeviceCallbackContext&)
{
    juce::ScopedNoDenormals noDenormals;
    for (int ch = 0; ch < numOutputs; ++ch) if (outputs[ch]) juce::FloatVectorOperations::clear(outputs[ch], count);
    if (playbackCache.available() && !recording.load())
    {
        if (!playing.load()) { outputPeak.store(0); return; }
        // No project mutex, plugin callbacks, preroll or file writes on this path.
        float peak = 0;
        for (int offset = 0; offset < count; offset += 512)
        {
            float storage[2][512] {};
            float* channels[] {storage[0], storage[1]};
            const int length = std::min(512, count - offset);
            juce::AudioBuffer<float> audio(channels, 2, length);
            if (!playbackCache.render(audio)) { playing.store(false); outputPeak.store(0); return; }
            for (int i = 0; i < length; ++i)
                for (int channel = 0; channel < std::min(2, numOutputs); ++channel)
                    if (outputs[channel])
                    {
                        const float sample = audio.getSample(channel, i);
                        outputs[channel][offset + i] = std::clamp(sample, -1.0f, 1.0f);
                        peak = std::max(peak, std::abs(sample));
                    }
        }
        playhead.store(playbackCache.position()); outputPeak.store(peak);
        if (!playbackCache.playing()) playing.store(false);
        return;
    }
    const juce::ScopedLock lock(mutex);
    if (recording.load() && recorder && numInputs > 0)
    {
        const float* recordingInputs[2] = {nullptr, nullptr};
        int found = 0;
        for (int channel = 0; channel < numInputs && found < 2; ++channel)
            if (inputs[channel]) recordingInputs[found++] = inputs[channel];
        if (found == 1) recordingInputs[1] = recordingInputs[0];
        if (found == 0 || !recorder->write(recordingInputs, count))
        {
            // Preserve recorded data and stop rather than silently losing frames.
            recordingOverrun.store(true);
            playing.store(false);
        }
    }
    if (!playing.load()) { outputPeak.store(0); return; }
    double time = playhead.load();
    float peak = 0;
    for (int start = 0; start < count; start += 128)
    {
        const int size = std::min(128, count - start);
        float storage[2][128] {};
        float* channels[] {storage[0], storage[1]};
        juce::AudioBuffer<float> buffer(channels, 2, size);
        state.block(time, buffer);
        if (state.error.isNotEmpty()) { playing.store(false); outputPeak.store(0); return; }
        for (int i = 0; i < size; ++i)
        {
        const float left = buffer.getSample(0, i), right = buffer.getSample(1, i);
        peak = std::max({peak, std::abs(left), std::abs(right)});
        // Device safety only. Export checks unmastered clipping separately.
        if (numOutputs > 0 && outputs[0]) outputs[0][start + i] = std::clamp(left, -1.0f, 1.0f);
        if (numOutputs > 1 && outputs[1]) outputs[1][start + i] = std::clamp(right, -1.0f, 1.0f);
        time += 1.0 / state.rate;
        }
    }
    playhead.store(time); outputPeak.store(peak);
    if (!recording.load() && time >= state.duration) playing.store(false);
}

Measurements AudioEngine::analyse(RenderState render, std::atomic<bool>* cancelled)
{
    if (render.error.isNotEmpty()) return {};
    Measurements l, r;
    const auto samples = static_cast<std::int64_t>(std::ceil(render.duration * render.rate));
    for (std::int64_t start = 0; start < samples; start += 128)
    {
        if (cancelled && cancelled->load()) return {};
        juce::AudioBuffer<float> block(2, static_cast<int>(std::min<std::int64_t>(128, samples - start)));
        render.block(start / render.rate, block);
        if (render.error.isNotEmpty()) return {};
        for (int i = 0; i < block.getNumSamples(); ++i)
        { l.push(block.getSample(0, i)); r.push(block.getSample(1, i)); }
    }
    l.samples += r.samples; l.sum += r.sum; l.squares += r.squares;
    l.peak = std::max(l.peak, r.peak); l.clipped += r.clipped; l.clicks += r.clicks;
    return l;
}

juce::String AudioEngine::exportWav(RenderState render, const juce::File& file, std::atomic<bool>* cancelled)
{
    if (render.error.isNotEmpty()) return render.error;
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
    const auto total = static_cast<std::int64_t>(std::ceil(render.duration * render.rate));
    for (std::int64_t position = 0; position < total; position += 128)
    {
        if (cancelled && cancelled->load()) return "Export cancelled; destination was not changed.";
        const int count = static_cast<int>(std::min<std::int64_t>(128, total - position));
        juce::AudioBuffer<float> block(2, count);
        render.block(position / render.rate, block);
        if (render.error.isNotEmpty()) return render.error;
        for (int i = 0; i < count; ++i)
        {
            const float left = block.getSample(0, i), right = block.getSample(1, i);
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
