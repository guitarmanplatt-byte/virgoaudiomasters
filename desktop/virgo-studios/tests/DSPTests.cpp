#include "../src/AudioDSP.h"
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
        }
        std::cout << "PASS: RMS/peak calibration, silence, stereo linking, finite output, sample ceiling at 44.1/48/96 kHz\n";
        return EXIT_SUCCESS;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return EXIT_FAILURE;
    }
}
