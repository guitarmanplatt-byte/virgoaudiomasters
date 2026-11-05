#pragma once
#include <algorithm>
#include <array>
#include <cmath>

namespace VirgoFuzz
{
// Silicon-era two-transistor topology. Voltages are solved, not waveshaped.
// Grounded-emitter Ebers-Moll BJTs, collector/base feedback, coupling caps,
// loaded 350k stage-blend pot, 22k shunt and 35k output load.
class Circuit
{
public:
    void prepare(double rate, double tone = 0.75)
    {
        sampleRate = std::max(8000.0, rate);
        v = {0.55, 0.65, 0.55, 0.65, 0, 0, 0};
        capacitors = {};
        solve(0, tone, true, 100);
        capacitors = {v[0], v[1] - v[4], v[1] - v[2], v[3] - v[5]};
    }

    float process(float input, double tone)
    {
        const double source = std::isfinite(input) ? std::clamp<double>(input, -8, 8) : 0;
        solve(source, std::clamp(tone, 0.0, 1.0), false, 12);
        const double inputG = (50e-9 * sampleRate) / (1.0 + 10000.0 * 50e-9 * sampleRate);
        const double current = inputG * (v[0] - source - capacitors[0]);
        capacitors[0] += current / (50e-9 * sampleRate);
        capacitors[1] = v[1] - v[4];
        capacitors[2] = v[1] - v[2];
        capacitors[3] = v[3] - v[5];
        return static_cast<float>(std::clamp(v[6], -4.0, 4.0));
    }

private:
    using Vector = std::array<double, 7>;
    using Matrix = std::array<Vector, 7>;
    double sampleRate = 192000;
    Vector v {};
    std::array<double, 4> capacitors {};

    static void resistor(Matrix& a, int first, int second, double resistance)
    {
        const double g = 1 / resistance;
        a[first][first] += g;
        if (second >= 0)
        {
            a[second][second] += g;
            a[first][second] -= g;
            a[second][first] -= g;
        }
    }
    static void capacitor(Matrix& a, Vector& b, int first, int second,
                          double conductance, double history, double source = 0)
    {
        a[first][first] += conductance;
        b[first] += conductance * (history + source);
        if (second >= 0)
        {
            a[second][second] += conductance;
            a[first][second] -= conductance;
            a[second][first] -= conductance;
            b[second] -= conductance * history;
        }
    }
    static void transistor(Matrix& jacobian, Vector& residual, const Vector& voltage,
                           int base, int collector, double beta)
    {
        constexpr double vt = 0.02585, saturation = 1e-14, alphaReverse = 0.5;
        const double alphaForward = beta / (beta + 1);
        const double ef = std::exp(std::clamp(voltage[base] / vt, -60.0, 40.0));
        const double er = std::exp(std::clamp((voltage[base] - voltage[collector]) / vt, -60.0, 40.0));
        const double reverseIs = saturation * alphaForward / alphaReverse;
        const double forward = saturation * (ef - 1), reverse = reverseIs * (er - 1);
        const double gf = saturation * ef / vt, gr = reverseIs * er / vt;
        residual[collector] += alphaForward * forward - reverse;
        residual[base] += (1 - alphaForward) * forward + (1 - alphaReverse) * reverse;
        jacobian[collector][base] += alphaForward * gf - gr;
        jacobian[collector][collector] += gr;
        jacobian[base][base] += (1 - alphaForward) * gf + (1 - alphaReverse) * gr;
        jacobian[base][collector] -= (1 - alphaReverse) * gr;
    }
    static bool linearSolve(Matrix a, Vector b, Vector& result)
    {
        for (int i = 0; i < 7; ++i)
        {
            int pivot = i;
            for (int row = i + 1; row < 7; ++row)
                if (std::abs(a[row][i]) > std::abs(a[pivot][i])) pivot = row;
            if (std::abs(a[pivot][i]) < 1e-18) return false;
            if (pivot != i) { std::swap(a[pivot], a[i]); std::swap(b[pivot], b[i]); }
            for (int row = i + 1; row < 7; ++row)
            {
                const auto scale = a[row][i] / a[i][i];
                for (int col = i + 1; col < 7; ++col) a[row][col] -= scale * a[i][col];
                b[row] -= scale * b[i];
            }
        }
        for (int i = 6; i >= 0; --i)
        {
            double sum = b[i];
            for (int col = i + 1; col < 7; ++col) sum -= a[i][col] * result[col];
            result[i] = sum / a[i][i];
            if (!std::isfinite(result[i])) return false;
        }
        return true;
    }
    void solve(double input, double tone, bool dc, int iterations)
    {
        Matrix linear {};
        Vector b {};
        for (int collector : {1, 3})
        {
            resistor(linear, collector, -1, 470000);
            b[collector] += 9.0 / 470000;
            resistor(linear, collector, collector - 1, 470000);
        }
        resistor(linear, 4, 6, 20 + 350000 * tone);
        resistor(linear, 6, 5, 20 + 350000 * (1 - tone));
        resistor(linear, 5, -1, 22000);
        resistor(linear, 6, -1, 35000);
        if (!dc)
        {
            const double g = 50e-9 * sampleRate;
            capacitor(linear, b, 0, -1, g / (1 + 10000 * g), capacitors[0], input);
            capacitor(linear, b, 1, 4, 2e-9 * sampleRate, capacitors[1]);
            capacitor(linear, b, 1, 2, g, capacitors[2]);
            capacitor(linear, b, 3, 5, 2e-9 * sampleRate, capacitors[3]);
        }
        for (int iteration = 0; iteration < iterations; ++iteration)
        {
            auto jacobian = linear;
            Vector residual {}, delta {};
            for (int row = 0; row < 7; ++row)
            {
                residual[row] = -b[row];
                for (int col = 0; col < 7; ++col) residual[row] += linear[row][col] * v[col];
            }
            transistor(jacobian, residual, v, 0, 1, 180);
            transistor(jacobian, residual, v, 2, 3, 140);
            if (!linearSolve(jacobian, residual, delta)) return;
            double largest = 0;
            for (const auto change : delta) largest = std::max(largest, std::abs(change));
            const double damping = largest > 0.15 ? 0.15 / largest : 1;
            for (int i = 0; i < 7; ++i) v[i] -= damping * delta[i];
            if (largest < 1e-8) break;
        }
    }
};
}
