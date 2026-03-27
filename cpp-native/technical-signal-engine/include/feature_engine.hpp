#pragma once

#include <string>
#include <vector>

namespace alphatrade {

struct Snapshot {
    double momentum_5 {};
    double momentum_20 {};
    double volatility_20 {};
    double trend_score {};
};

Snapshot compute_snapshot(const std::vector<double>& closes);
std::string classify_regime(const Snapshot& snapshot);

}  // namespace alphatrade
