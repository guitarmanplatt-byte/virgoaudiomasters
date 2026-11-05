#include "../src/AudioDSP.h"
#include "../src/RenderLength.h"
#include <cstdlib>
#include <iostream>
#include <stdexcept>

void require(bool condition, const char* message)
{
    if (!condition) throw std::runtime_error(message);
}

int main()
{
    try
    {
        for (const double rate : { 44100.0, 48000.0, 96000.0 })
        {
            for (const auto count : {1, 127, 128, 24000, 24001, 10000001})
                require(studio::renderSampleCount(count / rate, rate) == count, "Integer render length gained/lost a sample");
            require(studio::renderSampleCount(24000.25 / rate, rate) == 24001, "Fractional render length was truncated");
            studio::Measurements measurement;
            studio::RepairDSP repair;
            studio::MasterDSP master;
            studio::RepairSettings repairSettings;
            repairSettings.enabled = true; repairSettings.hum = true;
            repairSettings.gate = true; repairSettings.deClick = true;
            repair.prepare(rate, repairSettings);
            studio::MasterSettings settings;
            settings.enabled = true; settings.gainDb = 12;
            master.prepare(rate, settings);
            for (int i = 0; i < static_cast<int>(rate); ++i)
            {
                const float input = static_cast<float>(0.25 * std::sin(2 * studio::pi * 1000 * i / rate));
                measurement.push(input);
                float l = input * 12, r = -input * 12;
                repair.process(l, r); master.process(l, r);
                require(std::isfinite(l) && std::isfinite(r), "Non-finite output");
                require(std::abs(l) <= studio::gain(-1.0f) + 1e-6f, "Sample ceiling exceeded");
                require(std::abs(r) <= studio::gain(-1.0f) + 1e-6f, "Right sample ceiling exceeded");
                require(std::abs(l + r) < 1e-5f, "Stereo polarity/link changed");
            }
            require(std::abs(measurement.rmsDb() + 15.0515f) < 0.02f, "RMS calibration");
            require(std::abs(measurement.peakDb() + 12.0412f) < 0.02f, "Peak calibration");
            studio::Measurements silence;
            for (int i = 0; i < 100; ++i) silence.push(0);
            require(studio::recommendMaster(silence, -18).gainDb == 0, "Silence gained");
            master.prepare(rate, settings); repair.prepare(rate, repairSettings);
            float l = 0, r = 0;
            repair.process(l, r); master.process(l, r);
            require(l == 0 && r == 0, "Silence not silent");

            studio::RepairSettings bypass;
            repair.prepare(rate, bypass); master.prepare(rate, {});
            l = 0.123f; r = -0.234f;
            repair.process(l, r); master.process(l, r);
            require(l == 0.123f && r == -0.234f, "Bypass changed samples");

            studio::RepairSettings dcSettings;
            dcSettings.enabled = true; dcSettings.highPass = true;
            repair.prepare(rate, dcSettings);
            for (int i = 0; i < static_cast<int>(rate); ++i)
            {
                l = r = 0.1f; repair.process(l, r);
            }
            require(std::abs(l) < 1e-4f, "DC filter did not settle");

            studio::RepairSettings humSettings;
            humSettings.enabled = true; humSettings.highPass = false; humSettings.hum = true;
            for (const auto frequency : {50.0f, 60.0f})
            {
                humSettings.humHz = frequency; repair.prepare(rate, humSettings);
                double energy = 0;
                for (int i = 0; i < static_cast<int>(rate * 2); ++i)
                {
                    l = r = static_cast<float>(0.2 * std::sin(2 * studio::pi * frequency * i / rate));
                    repair.process(l, r);
                    if (i > rate) energy += l * l;
                }
                require(std::sqrt(energy / rate) < 0.01, "Hum notch suppression insufficient");
            }
            studio::RepairSettings gateSettings;
            gateSettings.enabled = true; gateSettings.highPass = false; gateSettings.gate = true;
            repair.prepare(rate, gateSettings);
            for (int i = 0; i < static_cast<int>(rate); ++i)
            {
                l = r = 0.0001f; repair.process(l, r);
            }
            require(std::abs(l) < 1e-6f, "Noise gate failed on low-level input");
        }
        std::cout << "PASS: exact/fractional render lengths, RMS/peak calibration, silence, bypass, stereo linking, finite output, sample ceiling, DC, hum, noise gate at 44.1/48/96 kHz\n";
        return EXIT_SUCCESS;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return EXIT_FAILURE;
    }
}
