#pragma once

#include <string>
#include <vector>
#include <optional>

namespace alphatrade {

// ─── Existing simple snapshot API (kept for back-compat) ────
struct Snapshot {
    double momentum_5 {};
    double momentum_20 {};
    double volatility_20 {};
    double trend_score {};
};
Snapshot compute_snapshot(const std::vector<double>& closes);
std::string classify_regime(const Snapshot& snapshot);

// ─── Phase 2: Richer regime analysis for AI advisor RAG context ──
//
// Unlike classify_regime() which only looks at volatility, analyze_regime()
// combines volatility AND directionality to produce a label the LLM can
// actually reason with.
//
// regime: BULL_TREND  trending up, low/moderate vol
//         BEAR_TREND  trending down, low/moderate vol
//         RANGING     low vol, no clear direction
//         HIGH_VOL    elevated volatility, direction unreliable
//         INSUFFICIENT_DATA  fewer than 25 closes
//
// direction: UP / DOWN / NEUTRAL  (sign of trend_score)
//
// confidence: 0..1, scales with |trend_score| / volatility ratio.
struct RegimeAnalysis {
    std::string regime;
    std::string direction;
    double confidence {};
    Snapshot snapshot;
};
RegimeAnalysis analyze_regime(const std::vector<double>& closes);

// ─── Full technical indicator suite ────────────────────────
struct Indicators {
    double rsi_14;            // Relative Strength Index
    double macd;              // MACD line
    double macd_signal;       // MACD signal line
    double macd_histogram;
    double sma_20, sma_50;
    double ema_12, ema_26;
    double bb_upper, bb_middle, bb_lower;  // Bollinger Bands
    double bb_pct_b;          // %B position within bands
    double atr_14;            // Average True Range
    double vwap;              // Volume-Weighted Avg Price (intraday)
};

// ─── Signal output ────────────────────────────────────────
enum class SignalAction { BUY, SELL, HOLD };
struct Signal {
    std::string symbol;
    SignalAction action;
    double confidence;       // 0.0 .. 1.0
    std::string reason;
    Indicators indicators;
};

// ─── Indicator computation ────────────────────────────────
double rsi(const std::vector<double>& closes, int period = 14);
double sma(const std::vector<double>& values, int period);
double ema(const std::vector<double>& values, int period);
struct MACDResult { double line, signal, histogram; };
MACDResult macd(const std::vector<double>& closes, int fast = 12, int slow = 26, int signalPeriod = 9);
struct BollingerResult { double upper, middle, lower, pctB; };
BollingerResult bollinger(const std::vector<double>& closes, int period = 20, double stdDevMul = 2.0);
double atr(const std::vector<double>& highs, const std::vector<double>& lows,
           const std::vector<double>& closes, int period = 14);
double vwap(const std::vector<double>& prices, const std::vector<double>& volumes);

// ─── Compose into full Indicator struct + signal ──────────
Indicators compute_indicators(const std::vector<double>& closes,
                              const std::vector<double>& highs,
                              const std::vector<double>& lows,
                              const std::vector<double>& volumes);

Signal generate_signal(const std::string& symbol,
                       const std::vector<double>& closes,
                       const std::vector<double>& highs,
                       const std::vector<double>& lows,
                       const std::vector<double>& volumes);

}  // namespace alphatrade
