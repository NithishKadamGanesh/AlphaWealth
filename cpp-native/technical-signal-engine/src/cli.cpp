#include "feature_engine.hpp"

#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {
std::vector<double> parse_closes(const std::string& raw) {
    std::vector<double> closes;
    std::stringstream stream(raw);
    std::string token;
    while (std::getline(stream, token, ',')) {
        if (!token.empty()) {
            closes.push_back(std::stod(token));
        }
    }
    return closes;
}
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: signal_engine_cli 100,101,102,...\n";
        return 1;
    }

    const auto closes = parse_closes(argv[1]);
    const auto snapshot = alphatrade::compute_snapshot(closes);
    const auto regime = alphatrade::classify_regime(snapshot);

    std::cout << std::fixed << std::setprecision(6)
              << "{"
              << "\"momentum5\":" << snapshot.momentum_5 << ","
              << "\"momentum20\":" << snapshot.momentum_20 << ","
              << "\"volatility20\":" << snapshot.volatility_20 << ","
              << "\"trendScore\":" << snapshot.trend_score << ","
              << "\"regime\":\"" << regime << "\""
              << "}\n";
    return 0;
}
