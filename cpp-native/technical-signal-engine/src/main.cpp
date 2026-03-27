#include "feature_engine.hpp"

#include <iostream>

int main() {
    const std::vector<double> closes {100, 101, 102, 103, 102.5, 104, 105, 105.4, 106, 107, 108, 108.5,
                                      109.2, 110, 111, 112, 112.5, 113, 113.7, 114.1, 114.8, 115.2, 115.7,
                                      116.1, 116.9, 117.5};
    const auto snapshot = alphatrade::compute_snapshot(closes);
    std::cout << "trend_score=" << snapshot.trend_score << "\n";
    std::cout << "regime=" << alphatrade::classify_regime(snapshot) << "\n";
    return 0;
}
