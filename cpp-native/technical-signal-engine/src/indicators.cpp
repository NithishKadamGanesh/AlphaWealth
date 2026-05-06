// indicators.cpp — Full technical indicator implementations

#include "feature_engine.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <stdexcept>

namespace alphatrade {

double sma(const std::vector<double>& values, int period) {
    if ((int)values.size() < period || period <= 0) return 0.0;
    double sum = 0;
    for (int i = (int)values.size() - period; i < (int)values.size(); ++i)
        sum += values[i];
    return sum / period;
}

double ema(const std::vector<double>& values, int period) {
    if (values.empty() || period <= 0) return 0.0;
    if ((int)values.size() < period) return sma(values, (int)values.size());

    double k = 2.0 / (period + 1);
    double e = sma(std::vector<double>(values.begin(), values.begin() + period), period);
    for (size_t i = period; i < values.size(); ++i)
        e = values[i] * k + e * (1 - k);
    return e;
}

double rsi(const std::vector<double>& closes, int period) {
    if ((int)closes.size() <= period) return 50.0;
    double gain = 0, loss = 0;

    // Initial average over first `period` deltas
    for (int i = 1; i <= period; ++i) {
        double delta = closes[i] - closes[i - 1];
        if (delta > 0) gain += delta; else loss -= delta;
    }
    double avgGain = gain / period;
    double avgLoss = loss / period;

    // Wilder smoothing for the remainder
    for (size_t i = period + 1; i < closes.size(); ++i) {
        double delta = closes[i] - closes[i - 1];
        double g = delta > 0 ? delta : 0;
        double l = delta < 0 ? -delta : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
    }

    if (avgLoss == 0) return 100.0;
    double rs = avgGain / avgLoss;
    return 100.0 - (100.0 / (1.0 + rs));
}

MACDResult macd(const std::vector<double>& closes, int fast, int slow, int signalPeriod) {
    double fastEma = ema(closes, fast);
    double slowEma = ema(closes, slow);
    double macdLine = fastEma - slowEma;

    // Compute MACD line series for last `signalPeriod` bars
    std::vector<double> macdSeries;
    int needed = signalPeriod + slow;
    if ((int)closes.size() >= needed) {
        for (size_t end = slow; end <= closes.size(); ++end) {
            std::vector<double> sub(closes.begin(), closes.begin() + end);
            macdSeries.push_back(ema(sub, fast) - ema(sub, slow));
        }
    }
    double signalLine = macdSeries.empty() ? macdLine : ema(macdSeries, signalPeriod);
    return { macdLine, signalLine, macdLine - signalLine };
}

BollingerResult bollinger(const std::vector<double>& closes, int period, double stdDevMul) {
    if ((int)closes.size() < period) {
        double last = closes.empty() ? 0 : closes.back();
        return { last, last, last, 0.5 };
    }
    double mid = sma(closes, period);
    double variance = 0;
    for (int i = (int)closes.size() - period; i < (int)closes.size(); ++i)
        variance += (closes[i] - mid) * (closes[i] - mid);
    double sd = std::sqrt(variance / period);
    double upper = mid + stdDevMul * sd;
    double lower = mid - stdDevMul * sd;
    double last = closes.back();
    double pctB = (upper - lower) > 0 ? (last - lower) / (upper - lower) : 0.5;
    return { upper, mid, lower, pctB };
}

double atr(const std::vector<double>& highs, const std::vector<double>& lows,
           const std::vector<double>& closes, int period) {
    size_t n = std::min({ highs.size(), lows.size(), closes.size() });
    if ((int)n < period + 1) return 0.0;

    std::vector<double> trs;
    trs.reserve(n - 1);
    for (size_t i = 1; i < n; ++i) {
        double tr = std::max({
            highs[i] - lows[i],
            std::abs(highs[i] - closes[i - 1]),
            std::abs(lows[i] - closes[i - 1])
        });
        trs.push_back(tr);
    }
    return ema(trs, period);
}

double vwap(const std::vector<double>& prices, const std::vector<double>& volumes) {
    size_t n = std::min(prices.size(), volumes.size());
    if (n == 0) return 0.0;
    double sumPV = 0, sumV = 0;
    for (size_t i = 0; i < n; ++i) {
        sumPV += prices[i] * volumes[i];
        sumV += volumes[i];
    }
    return sumV > 0 ? sumPV / sumV : 0.0;
}

Indicators compute_indicators(const std::vector<double>& closes,
                              const std::vector<double>& highs,
                              const std::vector<double>& lows,
                              const std::vector<double>& volumes) {
    auto m  = macd(closes);
    auto bb = bollinger(closes);
    return {
        rsi(closes),
        m.line, m.signal, m.histogram,
        sma(closes, 20), sma(closes, 50),
        ema(closes, 12), ema(closes, 26),
        bb.upper, bb.middle, bb.lower, bb.pctB,
        atr(highs, lows, closes),
        vwap(closes, volumes)
    };
}

Signal generate_signal(const std::string& symbol,
                       const std::vector<double>& closes,
                       const std::vector<double>& highs,
                       const std::vector<double>& lows,
                       const std::vector<double>& volumes) {
    Indicators ind = compute_indicators(closes, highs, lows, volumes);

    int score = 0;
    std::string reasons;

    // RSI
    if (ind.rsi_14 < 30)      { score += 2; reasons += "RSI oversold; "; }
    else if (ind.rsi_14 > 70) { score -= 2; reasons += "RSI overbought; "; }

    // MACD crossover
    if (ind.macd > ind.macd_signal && ind.macd_histogram > 0)
        { score += 1; reasons += "MACD bullish crossover; "; }
    else if (ind.macd < ind.macd_signal && ind.macd_histogram < 0)
        { score -= 1; reasons += "MACD bearish crossover; "; }

    // SMA trend
    if (ind.sma_20 > ind.sma_50)      { score += 1; reasons += "SMA20>SMA50; "; }
    else if (ind.sma_20 < ind.sma_50) { score -= 1; reasons += "SMA20<SMA50; "; }

    // Bollinger Bands
    if (ind.bb_pct_b < 0.1)      { score += 1; reasons += "near BB lower; "; }
    else if (ind.bb_pct_b > 0.9) { score -= 1; reasons += "near BB upper; "; }

    SignalAction action = SignalAction::HOLD;
    if (score >= 3)      action = SignalAction::BUY;
    else if (score <= -3) action = SignalAction::SELL;

    double confidence = std::min(1.0, std::abs(score) / 5.0);
    return { symbol, action, confidence, reasons.empty() ? "neutral" : reasons, ind };
}

}  // namespace alphatrade
