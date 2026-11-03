#pragma once
#include "AudioEngine.h"
#include "TestEffect.h"
#include "StartupArguments.h"
#include <iostream>
#include <stdexcept>

namespace studio
{
inline int runEngineTests(const juce::File& pluginFile = {})
{
    std::cout.setf(std::ios::unitbuf);
    std::cerr.setf(std::ios::unitbuf);
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
        require(startupArgument("\"--plugin-test=C:\\My Plugins\\Silver Opto.vst3\"")
            == "--plugin-test=C:\\My Plugins\\Silver Opto.vst3", "Quoted Windows startup argument was not parsed");
        require(startupArgument("--plugin-test=\"C:\\My Plugins\\Silver Opto.vst3\"")
            .fromFirstOccurrenceOf("=", false, false).unquoted() == "C:\\My Plugins\\Silver Opto.vst3",
            "Quoted plugin path was not parsed");
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
        {
            auto impulse = track;
            impulse.audio = std::make_shared<juce::AudioBuffer<float>>(2, 4800);
            impulse.audio->clear();
            impulse.audio->setSample(0, 0, 0.2f); impulse.audio->setSample(1, 0, -0.2f);
            auto delayed = impulse;
            delayed.plugins = std::make_shared<PluginChain>();
            delayed.plugins->entries.push_back({{}, std::make_unique<TestDelayEffect>(), false});
            RenderState aligned; aligned.tracks = {impulse, delayed}; aligned.prepare(48000);
            juce::AudioBuffer<float> block(2, 128);
            aligned.block(0, block);
            require(std::abs(block.getSample(0, 0) - 0.4f) < 1e-6f, "Plugin latency misaligned the first attack");
            require(std::abs(block.getSample(1, 0) + 0.4f) < 1e-6f, "Stereo latency compensation failed");
            for (int i = 1; i < 128; ++i) require(block.getSample(0, i) == 0, "Delayed duplicate attack");
            aligned.block(128.0 / 48000, block);
            require(block.getMagnitude(0, 128) == 0, "Latency state did not continue across blocks");
            delayed.plugins = std::make_shared<PluginChain>();
            delayed.plugins->entries.push_back({{}, std::make_unique<TestDelayEffect>(true), false});
            RenderState invalid; invalid.tracks = {delayed}; invalid.prepare(48000);
            require(AudioEngine::exportWav(invalid, protectedFile).isNotEmpty(), "Invalid plugin audio was exported");
            require(protectedFile.loadFileAsString() == "unchanged", "Invalid plugin export destroyed destination");
            std::cout << "PASS: stereo plugin latency compensation, block continuity, invalid plugin audio protection\n";
        }
        if (pluginFile != juce::File())
        {
            std::cout << "VST3 TEST: scanning plugin directory\n";
            juce::AudioPluginFormatManager scanFormats;
            scanFormats.addDefaultFormats();
            juce::KnownPluginList catalogue;
            juce::AudioPluginFormat* vst3 = nullptr;
            for (auto* format : scanFormats.getFormats())
                if (format->getName() == "VST3") vst3 = format;
            require(vst3 != nullptr, "VST3 scanner unavailable");
            juce::PluginDirectoryScanner scanner(catalogue, *vst3,
                juce::FileSearchPath(pluginFile.getParentDirectory().getFullPathName()), true,
                directory.getChildFile("scan-marker.txt"));
            juce::String scannedName;
            while (scanner.scanNextFile(true, scannedName)) {}
            require(!catalogue.getTypes().isEmpty(), "Folder scan did not discover the VST3 plugin");
            const auto catalogFile = directory.getChildFile("plugins.xml");
            require(catalogue.createXml()->writeTo(catalogFile), "Could not persist plugin catalogue");
            juce::KnownPluginList reopened;
            auto catalogueXml = juce::XmlDocument::parse(catalogFile);
            require(catalogueXml != nullptr, "Could not read plugin catalogue");
            reopened.recreateFromXml(*catalogueXml);
            require(reopened.getTypes().size() == catalogue.getTypes().size(), "Saved plugin catalogue lost entries");
            // Keep the array alive while selecting a description from multi-plugin bundles.
            const auto types = reopened.getTypes();
            const auto selected = std::find_if(types.begin(), types.end(),
                [&](const juce::PluginDescription& type) { return juce::File(type.fileOrIdentifier) == pluginFile; });
            require(selected != types.end(), "Discovered plugin identity/path was not preserved");
            juce::PluginDirectoryScanner rescan(catalogue, *vst3,
                juce::FileSearchPath(pluginFile.getParentDirectory().getFullPathName()), true,
                directory.getChildFile("scan-marker.txt"));
            while (rescan.scanNextFile(true, scannedName)) {}
            require(catalogue.getTypes().size() == types.size(), "Rescanning created duplicate plugins");
            auto instrument = *selected;
            instrument.isInstrument = true;
            PluginChain rejected;
            require(rejected.add(instrument, 48000).isNotEmpty() && rejected.entries.empty(),
                "Instrument was accepted by the audio effect rack");
            std::cout << "VST3 TEST: loading " << pluginFile.getFullPathName() << '\n';
            auto rack = std::make_shared<PluginChain>();
            error = rack->add(*selected, 48000);
            std::cout << "VST3 TEST: load returned " << error << '\n';
            require(error.isEmpty(), ("VST3 load failed: " + error).toRawUTF8());
            require(rack->entries.size() == 1, "Plugin was not inserted");
            std::cout << "PASS: VST3 folder discovery, catalogue save/reload, selected plugin loading\n";
            auto& processor = *rack->entries[0].processor;
            require(processor.getParameters().size() > 0, "Plugin parameters unavailable");
            // Deliberately change a parameter, then verify saved/restored state.
            auto* parameter = processor.getParameters()[0];
            parameter->setValueNotifyingHost(0.73f);
            std::cout << "VST3 TEST: saving plugin state\n";
            const auto saved = rack->save();
            std::cout << "VST3 TEST: restoring plugin state\n";
            auto restored = std::make_shared<PluginChain>();
            require(restored->restore(saved, 48000).isEmpty(), "Plugin restore failed");
            require(std::abs(restored->entries[0].processor->getParameters()[0]->getValue() - 0.73f) < 0.001f,
                "Plugin parameter was not preserved");
            engine.replaceTracks({track}, {});
            std::cout << "VST3 TEST: preparing live rack\n";
            engine.updateTrack(track.id, [&](Track& value) { value.plugins = rack; });
            std::cout << "VST3 TEST: cloning offline rack\n";
            auto offline = engine.snapshot(false);
            require(offline.error.isEmpty() && offline.tracks[0].plugins != rack, "Offline render reused live plugin instance");
            auto processed = AudioEngine::analyse(offline);
            std::cout << "VST3 TEST: analysis completed\n";
            require(processed.samples > 0 && std::isfinite(processed.peak), "Hosted plugin produced invalid audio");
            const auto bounced = directory.getChildFile("bounced.wav");
            require(AudioEngine::exportWav(engine.snapshot(false), bounced).isEmpty(), "Plugin bounce failed");
            std::cout << "VST3 TEST: bounce completed\n";
            auto bouncedTrack = AudioEngine::loadTrack(bounced, error);
            require(bouncedTrack.audio != nullptr && error.isEmpty(), "Bounced audio could not be imported");
            rack->entries[0].bypass = true;
            engine.updateTrack(track.id, [](Track&) {});
            const auto bypassed = AudioEngine::analyse(engine.snapshot(false));
            require(std::abs(bypassed.rmsDb() - measured.rmsDb()) < 0.02, "Plugin bypass changed audio");
            for (int i = 0; i < 3; ++i)
            {
                auto stem = engine.snapshot(false);
                require(AudioEngine::exportWav(stem, directory.getChildFile("stem" + juce::String(i) + ".wav")).isEmpty(),
                    "Multiple-file render failed");
            }
            require(engine.tracks()[0].file == source, "Rendering replaced the original source");
            std::cout << "PASS: actual VST3 load, state restoration, independent offline instance, plugin bounce, bypass, batch WAV rendering\n";
        }
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
