#pragma once
#include "AudioEngine.h"
#include "TestEffect.h"
#include <iostream>
#include <stdexcept>

namespace studio
{
inline void runEditingAndRackTests(const juce::File& directory)
{
    const auto require = [](bool value, const char* message)
    { if (!value) throw std::runtime_error(message); };
    Track original;
    original.id = juce::Uuid().toString(); original.name = "Continuity";
    original.audio = std::make_shared<juce::AudioBuffer<float>>(2, 24000);
    original.sourceRate = 48000; original.trimEnd = 0.5;
    for (int i = 0; i < 24000; ++i)
    {
        const float sample = static_cast<float>((i * 17) % 257 - 128) / 1024;
        original.audio->setSample(0, i, sample); original.audio->setSample(1, i, -sample);
    }
    AudioEngine edits; juce::String error, rightId, pastedId;
    require(edits.addTrack(original, error), "Editing source insertion failed");
    const auto savedBefore = edits.tracks();
    require(edits.splitClip(original.id, 0.2, rightId, error), "Clip split failed");
    auto clips = edits.tracks();
    require(clips.size() == 2 && clips[0].audio == clips[1].audio, "Split duplicated or lost source data");
    require(std::abs(clips[0].duration() - 0.2) < 1e-9 && std::abs(clips[1].offset - 0.2) < 1e-9, "Split timing incorrect");
    auto split = edits.snapshot(false);
    juce::AudioBuffer<float> block(2, 128);
    for (int offset = 0; offset < 24000; offset += 128)
    {
        const int count = std::min(128, 24000 - offset);
        block.setSize(2, count, false, false, true); split.block(offset / 48000.0, block);
        for (int i = 0; i < count; ++i)
            require(std::abs(block.getSample(0, i) - original.audio->getSample(0, offset + i)) < 1e-6f, "Split changed audio at a boundary");
    }
    edits.replaceTracks(savedBefore, {});
    require(edits.tracks().size() == 1 && edits.tracks()[0].trimEnd == 0.5, "Undo snapshot did not restore clip");
    require(edits.pasteClip(original, 0.7, pastedId, error), "Clip paste failed");
    clips = edits.tracks();
    require(clips.size() == 2 && clips[1].id != original.id && clips[1].offset == 0.7
            && clips[1].audio == original.audio, "Paste timing, ID or source sharing incorrect");
    edits.replaceTracks(savedBefore, {});
    require(edits.spliceClip(original.id, 0.1, 0.3, error), "Middle range splice failed");
    clips = edits.tracks();
    require(clips.size() == 2 && std::abs(clips[1].offset - 0.1) < 1e-9
            && std::abs(clips[1].trimStart - 0.3) < 1e-9, "Splice did not close gap");
    require(clips[0].fadeOut > 0 && clips[1].fadeIn > 0, "Splice click-protection fades missing");
    require(original.audio->getNumSamples() == 24000 && original.trimEnd == 0.5, "Edit changed original audio");
    const auto unchanged = edits.revision();
    require(!edits.spliceClip(clips[0].id, -1, 99, error) && edits.revision() == unchanged, "Invalid splice mutated project");
    edits.replaceTracks(savedBefore, {});
    require(!edits.splitClip(original.id, 0, rightId, error), "Split at clip edge was accepted");
    require(edits.spliceClip(original.id, 0, 0.5, error) && edits.tracks().empty(), "Whole-clip splice failed");
    for (const double rate : {44100.0, 48000.0, 96000.0})
        for (const int effects : {3, 16, 64})
        {
            auto track = original;
            track.sourceRate = rate; track.trimEnd = 24000 / rate;
            track.plugins = std::make_shared<PluginChain>();
            for (int i = 0; i < effects; ++i)
                track.plugins->entries.push_back({{}, std::make_unique<TestDelayEffect>(false, i == 0 ? 8192 : 3), false});
            RenderState render; render.offline = true; render.tracks = {track}; render.prepare(rate);
            for (const auto& entry : track.plugins->entries)
                require(entry.processor->isNonRealtime(), "Offline mode was not sent to a plugin");
            for (int offset = 0; offset < 24000; offset += 128)
            {
                const int count = std::min(128, 24000 - offset);
                block.setSize(2, count, false, false, true);
                render.block(offset / rate, block);
                require(render.error.isEmpty(), "Long plugin chain processing failed");
                for (int i = 0; i < count; ++i)
                    for (int channel = 0; channel < 2; ++channel)
                        require(std::abs(block.getSample(channel, i) - original.audio->getSample(channel, offset + i)) < 1e-6f,
                            "Long plugin chain skipped/repeated/changed samples");
            }
            render.prepare(rate);
            const auto file = directory.getChildFile("rack-" + juce::String(effects) + "-" + juce::String(rate, 0) + ".wav");
            require(AudioEngine::exportWav(render, file).isEmpty(), "Long plugin chain bounce failed");
            error.clear(); const auto bounced = AudioEngine::loadTrack(file, error);
            require(error.isEmpty() && bounced.audio && bounced.audio->getNumSamples() == 24000, "Bounce duration changed");
            for (int i = 0; i < 24000; ++i)
                require(std::abs(bounced.audio->getSample(0, i) - original.audio->getSample(0, i)) < 2e-7f, "Bounced file has missing or altered samples");
        }
    // Real buffered disk playback, without an audio device or third-party DSP.
    RenderState dry; dry.tracks = {original}; dry.prepare(48000);
    const auto cacheFile = directory.getChildFile("owned-playback-cache.wav");
    require(AudioEngine::exportWav(dry, cacheFile).isEmpty(), "Playback cache creation failed");
    {
        PlaybackCache cache;
        require(cache.load(cacheFile, 48000, 128).isEmpty(), "Buffered playback load failed");
        require(cache.play(0), "Buffered playback did not prefill");
        block.setSize(2, 128);
        for (int offset = 0; offset < 12000; offset += 128)
        {
            require(cache.render(block), "Read-ahead cache unexpectedly starved");
            if (offset >= 1024)
                for (int i = 0; i < 128; ++i)
                    require(std::abs(block.getSample(0, i) - original.audio->getSample(0, offset + i)) < 2e-7f, "Buffered playback skipped or repeated samples");
        }
        cache.pause(); require(cache.play(0.1), "Cached seek/resume failed");
        require(cache.render(block), "Cached seek read failed");
    }
    require(!cacheFile.existsAsFile(), "Temporary playback cache leaked after release");
    std::cout << "PASS: copy/paste, sample-aligned split, range splice/close-gap/fades, undo snapshot, source preservation; 3/16/64-effect sample continuity and WAV round-trip at 44.1/48/96 kHz; buffered disk playback and seek\n";
}
}
