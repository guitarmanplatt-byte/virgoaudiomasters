#include "MainComponent.h"

namespace studio
{
RenderState MainComponent::analysisSnapshot() const
{
    auto render = engine.snapshot(false);
    if (analysisScope.getSelectedId() == 2)
    {
        render.tracks.erase(std::remove_if(render.tracks.begin(), render.tracks.end(),
            [&](const Track& track) { return track.id != selectedId; }), render.tracks.end());
        for (auto& track : render.tracks) { track.solo = false; track.mute = false; track.offset = 0; }
        render.prepare(48000);
    }
    return render;
}

juce::String MainComponent::analysisText(const Measurements& value)
{
    if (!value.samples) return "No samples were analyzed.";
    juce::String result;
    result << "MEASURED AUDIO REPORT\n\n"
        << "Sample peak: " << juce::String(value.peakDb(), 2) << " dBFS\n"
        << "RMS level: " << juce::String(value.rmsDb(), 2) << " dBFS\n"
        << "Crest factor: " << juce::String(value.crestDb(), 2) << " dB\n"
        << "DC offset: " << juce::String(value.dc(), 6) << "\n"
        << "Near-full-scale samples: " << juce::String(static_cast<juce::int64>(value.clipped)) << "\n"
        << "Large sample transitions: " << juce::String(static_cast<juce::int64>(value.clicks)) << "\n\n"
        << "These are measured statistics, not a trained AI model's opinion. "
        << "Transient/clipping counts are warnings, not proof of damage. RMS is not LUFS.\n\n";
    if (std::abs(value.dc()) > 0.002f) result << "Repair suggestion: enable the DC / rumble filter.\n";
    if (value.clipped > 0) result << "Possible clipping: lost waveform detail cannot be reliably reconstructed here. "
        << "Lowering gain prevents further clipping, but does not restore the source.\n";
    if (value.clicks > 0) result << "Audition click suppression carefully; it can also soften intentional transients.\n";
    result << "\nUse Apply Mastering for a bounded, analysis-driven starting point. "
        << "Use Ask Local AI for model-assisted settings; the audio itself is not uploaded.";
    return result;
}

void MainComponent::analyseAudio()
{
    if (!canEdit()) return;
    auto render = analysisSnapshot();
    if (render.duration <= 0) { showStatus("Choose audio to analyze first.", true); return; }
    busy = true; showStatus("Analyzing actual audio samples...");
    worker.addJob([this, safe = juce::Component::SafePointer<MainComponent>(this), render]
    {
        const auto result = AudioEngine::analyse(render, &cancelled);
        juce::MessageManager::callAsync([safe, result]
        {
            if (!safe) return;
            safe->measurements = result; safe->hasMeasurements = result.samples > 0; safe->busy = false;
            safe->analysisReport.setText(analysisText(result));
            safe->showStatus("Analysis complete. Repair settings are non-destructive; master bypass is available.");
        });
    });
}

void MainComponent::askAI()
{
    if (!canEdit()) return;
    if (!hasMeasurements) { showStatus("Analyze the audio before asking the local AI.", true); return; }
    auto* payload = new juce::DynamicObject();
    payload->setProperty("model", "llama3.2");
    payload->setProperty("stream", false);
    payload->setProperty("format", "json");
    const juce::String prompt =
        "You are an audio engineering assistant. Use only the supplied measured statistics. "
        "Do not pretend you heard the waveform. Do not diagnose hum, reverb or noise from RMS alone. "
        "Return ONLY a JSON object with keys summary (string), gainDb (number -12 to 12), "
        "thresholdDb (number -30 to -6), ceilingDb (number -6 to -0.1), "
        "highPass (boolean), gate (boolean; default false), gateDb (number -80 to -25), "
        "deClick (boolean; default false). Avoid unnecessary processing. "
        "The master uses 2:1 compression and a sample-peak guard, not true-peak limiting. "
        "The repair has a 30Hz high pass, a soft noise gate and slew-based click suppression. "
        "Describe limitations honestly. Target RMS dBFS: " + juce::String(targetRms, 1)
        + ". Input report:\n" + analysisText(measurements);
    payload->setProperty("prompt", prompt);
    const auto request = juce::JSON::toString(juce::var(payload));
    const bool selectedScope = analysisScope.getSelectedId() == 2;
    const auto trackId = selectedId;
    busy = true;
    showStatus("Asking local Ollama (llama3.2). This can take up to 60 seconds...");
    worker.addJob([safe = juce::Component::SafePointer<MainComponent>(this), request, selectedScope, trackId]
    {
        juce::String error, summary;
        juce::var plan;
        int status = 0;
        const juce::URL url("http://127.0.0.1:11434/api/generate");
        const auto options = juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inPostData)
            .withHttpRequestCmd("POST").withExtraHeaders("Content-Type: application/json\r\n")
            .withConnectionTimeoutMs(60000).withStatusCode(&status);
        auto input = url.withPOSTData(request).createInputStream(options);
        if (!input) error = "Cannot connect to local AI. Install Ollama, run `ollama pull llama3.2`, and ensure it is running. "
            "Measured analysis and manual processing remain available without AI.";
        else
        {
            const auto response = juce::JSON::parse(input->readEntireStreamAsString());
            if (status != 200) error = "Ollama returned HTTP " + juce::String(status) + ": " + response["error"].toString();
            else
            {
                plan = juce::JSON::parse(response["response"].toString());
                if (!plan.isObject() || !plan["summary"].isString())
                    error = "The model returned an invalid plan. No settings were changed.";
                else summary = plan["summary"].toString().substring(0, 4000);
            }
        }
        juce::MessageManager::callAsync([safe, plan, summary, error, selectedScope, trackId]
        {
            if (!safe) return;
            safe->busy = false;
            if (error.isNotEmpty()) { safe->analysisReport.setText(error); safe->showStatus("Local AI unavailable; no settings changed.", true); return; }
            const auto bounded = [&](const juce::Identifier& key, float fallback, float low, float high)
            {
                const auto value = plan[key];
                if (!value.isDouble() && !value.isInt() && !value.isInt64()) return fallback;
                const auto number = static_cast<float>(value);
                return std::isfinite(number) ? std::clamp(number, low, high) : fallback;
            };
            if (selectedScope)
            {
                safe->engine.updateTrack(trackId, [&](Track& track)
                {
                    track.repair.enabled = true;
                    track.repair.highPass = plan["highPass"].isBool() ? static_cast<bool>(plan["highPass"]) : true;
                    track.repair.gate = plan["gate"].isBool() && static_cast<bool>(plan["gate"]);
                    track.repair.deClick = plan["deClick"].isBool() && static_cast<bool>(plan["deClick"]);
                    track.repair.gateDb = bounded("gateDb", -55, -80, -25);
                });
            }
            else
            {
                auto master = safe->engine.masterSettings();
                master.enabled = true;
                master.gainDb = bounded("gainDb", 0, -12, 12);
                master.thresholdDb = bounded("thresholdDb", -16, -30, -6);
                master.ceilingDb = bounded("ceilingDb", -1, -6, -0.1f);
                safe->engine.setMaster(master);
            }
            safe->dirty = true; safe->hasMeasurements = false; safe->refreshControls();
            safe->analysisReport.setText("LOCAL AI SETTINGS APPLIED\n\n" + summary
                + "\n\nThe model assessed measured features, not the waveform. Compare using "
                + (selectedScope ? "Repair enabled." : "Master processing.") + " Original files are unchanged.");
            safe->showStatus("Local AI settings applied. Use bypass to compare and adjust by ear.");
        });
    });
}
}
