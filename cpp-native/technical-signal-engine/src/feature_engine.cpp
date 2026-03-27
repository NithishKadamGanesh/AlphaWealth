#include "feature_engine.hpp"

#include <cmath>
#include <numeric>

namespace alphatrade {

namespace {
double mean(const std::vector<double>& values, std::size_t start) {
    const auto begin = values.begin() + static_cast<long long>(start);
    const auto count = values.size() - start;
    return std::accumulate(begin, values.end(), 0.0) / static_cast<double>(count);
}
}

Snapshot compute_snapshot(const std::vector<double>& closes) {
    Snapshot snapshot {};
    if (closes.size() < 25) {
        return snapshot;
    }

    const auto last = closes.back();
    snapshot.momentum_5 = (last / closes[closes.size() - 6]) - 1.0;
    snapshot.momentum_20 = (last / closes[closes.size() - 21]) - 1.0;

    std::vector<double> returns;
    returns.reserve(closes.size() - 1);
    for (std::size_t i = 1; i < closes.size(); ++i) {
        returns.push_back((closes[i] / closes[i - 1]) - 1.0);
    }

    const std::size_t start = returns.size() > 20 ? returns.size() - 20 : 0;
    const auto avg = mean(returns, start);
    double variance = 0.0;
    for (std::size_t i = start; i < returns.size(); ++i) {
        const auto diff = returns[i] - avg;
        variance += diff * diff;
    }
    variance /= static_cast<double>(returns.size() - start);
    snapshot.volatility_20 = std::sqrt(variance);
    snapshot.trend_score = snapshot.momentum_5 * 1.6 + snapshot.momentum_20 * 2.2 - snapshot.volatility_20 * 1.4;
    return snapshot;
}

std::string classify_regime(const Snapshot& snapshot) {
    if (snapshot.volatility_20 < 0.01) {
        return "TRENDING";
    }
    if (snapshot.volatility_20 < 0.02) {
        return "BALANCED";
    }
    return "VOLATILE";
}

}  // namespace alphatrade
