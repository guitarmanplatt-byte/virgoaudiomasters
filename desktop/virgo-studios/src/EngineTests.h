#pragma once
#include "AudioEngine.h"
#include <iostream>
#include <stdexcept>

namespace studio
{
inline int runEngineTests()
{
    const auto directory = juce::File::getSpecialLocation(juce::File::tempDirectory)
        .getNonexistentChildFile("VirgoStudiosTests", "", false);
    directory.createDirectory();
    struct Cleanup { juce::File directory; ~Cleanup() { directory.deleteRecursively(); } } cleanup {directory};
    try
    {
        const auto require = [](bool condition, const char* message)
        {
            if (!condition) throw std::runtime_error(message);
        };
        const auto source = directory.getChildFile("source.wav");
        juce::AudioBuffer<float> sourceAudio(2, 4800);
        for (int i = 0; i < sourceAudio.getNumSamples(); ++i)
        {
            const auto value = static_cast<float>(0.2 * std::sin(2.0 * pi * 1000 * i / 48000.0));
            sourceAudio.setSample(0, i, value); sourceAudio.setSample(1, i, -value);
        }
        auto output = source.createOutputStream();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::AudioFormatWriter> writer(wav.createWriterFor(output.get(), 48000, 2, 24, {}, 0));
        require(writer != nullptr, "Could not create source fixture");
        output.release();
        require(writer->writeFromAudioSampleBuffer(sourceAudio, 0, sourceAudio.getNumSamples()), "Could not write fixture");
        writer.reset();
        juce::String error;
        auto track = AudioEngine::loadTrack(source, error);
        require(error.isEmpty() && track.audio != nullptr, "File import failed");
        require(track.waveform && !track.waveform->empty(), "Waveform generation failed");
        AudioEngine engine;
        const auto id = track.id;
        require(engine.addTrack(track, error), "Track insertion failed");
        auto render = engine.snapshot(false);
        auto measured = AudioEngine::analyse(render);
        require(std::abs(measured.rmsDb() - db(0.2f / std::sqrt(2.0f))) < 0.02, "Mix RMS incorrect");
        engine.updateTrack(id, [](Track& value) { value.offset = 0.05; value.trimStart = 0.02; value.trimEnd = 0.08; });
        render = engine.snapshot(false);
        require(std::abs(render.duration - 0.11) < 0.0001, "Track position/trim incorrect");
        float left = 1, right = 1;
        render.frame(0, left, right);
        require(left == 0 && right == 0, "Clip offset was ignored");
        engine.updateTrack(id, [](Track& value) { value.mute = true; });
        require(AudioEngine::analyse(engine.snapshot(false)).peak == 0, "Mute failed");
        engine.updateTrack(id, [](Track& value) { value.mute = false; value.volumeDb = 6; });
        require(AudioEngine::analyse(engine.snapshot(false)).peak > 0.39f, "Mixer gain failed");
        engine.setMaster(recommendMaster(measured, -18));
        const auto destination = directory.getChildFile("master.wav");
        require(AudioEngine::exportWav(engine.snapshot(), destination).isEmpty(), "Export failed");
        auto exported = AudioEngine::loadTrack(destination, error);
        require(error.isEmpty() && exported.audio && exported.sourceRate == 48000, "Export cannot be read back");
        require(!AudioEngine::exportWav(engine.snapshot(), source).isEmpty(), "Source overwrite was allowed");
        engine.setMaster({});
        engine.updateTrack(id, [](Track& value) { value.volumeDb = 12; });
        auto loud = track;
        loud.id = juce::Uuid().toString(); loud.volumeDb = 12;
        require(engine.addTrack(loud, error), "Second track insertion failed");
        const auto protectedFile = directory.getChildFile("protected.wav");
        protectedFile.replaceWithText("unchanged");
        require(AudioEngine::exportWav(engine.snapshot(), protectedFile).isNotEmpty(), "Clipping export was not rejected");
        require(protectedFile.loadFileAsString() == "unchanged", "Failed export destroyed existing destination");
        engine.removeTrack(id);
        require(engine.tracks().size() == 1, "Track removal failed");
        std::cout << "PASS: import, waveform, mixing, offsets, trim, mute, mastering, WAV round-trip, source protection, atomic failed export\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL: " << error.what() << '\n';
        return 1;
    }
}
}
