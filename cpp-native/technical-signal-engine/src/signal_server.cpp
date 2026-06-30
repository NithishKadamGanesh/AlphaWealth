// signal_server.cpp
// Networked signal engine - REST + ZMQ pub
// Build with: cmake -DBUILD_SERVER=ON ..
//
// Endpoints:
//   GET  /health
//   POST /indicators        { closes, highs, lows, volumes }          -> Indicators JSON
//   POST /signals/compute   { symbol, closes, highs, lows, volumes }  -> Signal JSON
//   POST /regime            { closes }                                 -> RegimeAnalysis JSON
//   POST /scan/batch        { items:[{symbol, closes, highs, lows, volumes}] }
//   POST /classifiers/lorentzian { closes, highs, lows, volumes, k, horizon }
//   POST /options/price     { type, spot, strike, days, volatility, rate }
//   POST /options/iv        { type, spot, strike, days, rate, marketPrice }
//   POST /options/strategies { symbol, spot, volatility, rate, dte }
//   POST /backtest          { symbol, strategy, closes, highs, lows, volumes }
//   POST /risk/portfolio    { assets:[{symbol, closes, weight}] }
//
// ZMQ pub on tcp://*:5555 - broadcasts signals as they're generated.

#include "feature_engine.hpp"

#include <httplib.h>
#include <nlohmann/json.hpp>
#include <zmq.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <numeric>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using json = nlohmann::json;
using namespace alphatrade;

static std::atomic<bool> running{true};

static const char* action_to_str(SignalAction a) {
    switch (a) {
        case SignalAction::BUY:  return "BUY";
        case SignalAction::SELL: return "SELL";
        default:                 return "HOLD";
    }
}

static json indicators_to_json(const Indicators& i);
static json signal_to_json(const Signal& s);
static json regime_to_json(const RegimeAnalysis& r);

static void publish_json(void* zpub, const json& payload) {
    if (!zpub) return;
    const std::string msg = payload.dump();
    zmq_send(zpub, msg.c_str(), msg.size(), ZMQ_DONTWAIT);
}

static std::string upper(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::toupper(c));
    });
    return value;
}

static double round_to(double value, int places = 4) {
    if (!std::isfinite(value)) return 0.0;
    const double scale = std::pow(10.0, places);
    return std::round(value * scale) / scale;
}

static double mean_value(const std::vector<double>& values) {
    if (values.empty()) return 0.0;
    return std::accumulate(values.begin(), values.end(), 0.0) / static_cast<double>(values.size());
}

static double stddev_value(const std::vector<double>& values) {
    if (values.size() < 2) return 0.0;
    const double avg = mean_value(values);
    double var = 0.0;
    for (double v : values) var += (v - avg) * (v - avg);
    return std::sqrt(var / static_cast<double>(values.size() - 1));
}

static std::vector<double> returns_of(const std::vector<double>& closes) {
    std::vector<double> out;
    if (closes.size() < 2) return out;
    out.reserve(closes.size() - 1);
    for (std::size_t i = 1; i < closes.size(); ++i) {
        if (closes[i - 1] != 0.0) out.push_back((closes[i] / closes[i - 1]) - 1.0);
    }
    return out;
}

static double correlation(const std::vector<double>& a, const std::vector<double>& b) {
    const std::size_t n = std::min(a.size(), b.size());
    if (n < 3) return 0.0;
    const std::size_t ao = a.size() - n;
    const std::size_t bo = b.size() - n;
    double ma = 0.0, mb = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        ma += a[ao + i];
        mb += b[bo + i];
    }
    ma /= static_cast<double>(n);
    mb /= static_cast<double>(n);
    double num = 0.0, da = 0.0, db = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const double x = a[ao + i] - ma;
        const double y = b[bo + i] - mb;
        num += x * y;
        da += x * x;
        db += y * y;
    }
    const double den = std::sqrt(da * db);
    return den > 0.0 ? num / den : 0.0;
}

static double covariance(const std::vector<double>& a, const std::vector<double>& b) {
    const std::size_t n = std::min(a.size(), b.size());
    if (n < 3) return 0.0;
    const std::size_t ao = a.size() - n;
    const std::size_t bo = b.size() - n;
    double ma = 0.0, mb = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        ma += a[ao + i];
        mb += b[bo + i];
    }
    ma /= static_cast<double>(n);
    mb /= static_cast<double>(n);
    double cov = 0.0;
    for (std::size_t i = 0; i < n; ++i) cov += (a[ao + i] - ma) * (b[bo + i] - mb);
    return cov / static_cast<double>(n - 1);
}

static double norm_pdf(double x) {
    static constexpr double inv_sqrt_2pi = 0.3989422804014327;
    return inv_sqrt_2pi * std::exp(-0.5 * x * x);
}

static double norm_cdf(double x) {
    return 0.5 * std::erfc(-x / std::sqrt(2.0));
}

static double d1(double spot, double strike, double years, double vol, double rate) {
    return (std::log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * std::sqrt(years));
}

static json price_option_json(std::string type, double spot, double strike, double days, double vol, double rate) {
    type = upper(type);
    const bool is_call = type != "PUT";
    const double years = days / 365.0;
    if (spot <= 0.0 || strike <= 0.0 || years <= 0.0 || vol <= 0.0) {
        return {
            {"type", type}, {"strike", strike}, {"expDays", days}, {"spot", spot}, {"vol", vol}, {"rate", rate},
            {"price", 0.0}, {"intrinsic", 0.0}, {"timeValue", 0.0},
            {"greeks", {{"delta", 0.0}, {"gamma", 0.0}, {"theta", 0.0}, {"vega", 0.0}, {"rho", 0.0}}}
        };
    }

    const double x1 = d1(spot, strike, years, vol, rate);
    const double x2 = x1 - vol * std::sqrt(years);
    const double disc = strike * std::exp(-rate * years);
    const double price = is_call
        ? spot * norm_cdf(x1) - disc * norm_cdf(x2)
        : disc * norm_cdf(-x2) - spot * norm_cdf(-x1);
    const double delta = is_call ? norm_cdf(x1) : norm_cdf(x1) - 1.0;
    const double gamma = norm_pdf(x1) / (spot * vol * std::sqrt(years));
    const double theta = (-spot * norm_pdf(x1) * vol / (2.0 * std::sqrt(years))
        - rate * disc * (is_call ? norm_cdf(x2) : norm_cdf(-x2))) / 365.0;
    const double vega = spot * norm_pdf(x1) * std::sqrt(years) / 100.0;
    const double rho = (is_call ? strike * years * std::exp(-rate * years) * norm_cdf(x2)
                                : -strike * years * std::exp(-rate * years) * norm_cdf(-x2)) / 100.0;
    const double intrinsic = is_call ? std::max(spot - strike, 0.0) : std::max(strike - spot, 0.0);
    const double time_value = std::max(price - intrinsic, 0.0);

    return {
        {"type", type}, {"strike", round_to(strike, 2)}, {"expDays", round_to(days, 2)},
        {"spot", round_to(spot, 2)}, {"vol", round_to(vol, 4)}, {"rate", round_to(rate, 4)},
        {"price", round_to(price, 2)}, {"intrinsic", round_to(intrinsic, 2)}, {"timeValue", round_to(time_value, 2)},
        {"greeks", {
            {"delta", round_to(delta, 4)}, {"gamma", round_to(gamma, 4)}, {"theta", round_to(theta, 4)},
            {"vega", round_to(vega, 4)}, {"rho", round_to(rho, 4)}
        }}
    };
}

static double option_price_value(const std::string& type, double spot, double strike, double days, double vol, double rate) {
    return price_option_json(type, spot, strike, days, vol, rate).value("price", 0.0);
}

static double implied_volatility(std::string type, double market_price, double spot, double strike, double days, double rate) {
    if (market_price <= 0.0 || spot <= 0.0 || strike <= 0.0 || days <= 0.0) return 0.0;
    double lo = 0.005, hi = 5.0;
    auto price_at = [&](double vol) { return option_price_value(type, spot, strike, days, vol, rate); };
    double plo = price_at(lo) - market_price;
    double phi = price_at(hi) - market_price;
    if (!std::isfinite(plo) || !std::isfinite(phi) || plo * phi > 0.0) return 0.0;
    for (int i = 0; i < 90; ++i) {
        const double mid = 0.5 * (lo + hi);
        const double pmid = price_at(mid) - market_price;
        if (std::abs(pmid) < 1e-4 || (hi - lo) < 1e-6) return round_to(mid, 4);
        if (plo * pmid <= 0.0) {
            hi = mid;
            phi = pmid;
        } else {
            lo = mid;
            plo = pmid;
        }
    }
    return round_to(0.5 * (lo + hi), 4);
}

static double probability_above(double spot, double level, double days, double vol, double rate) {
    const double years = days / 365.0;
    if (spot <= 0.0 || level <= 0.0 || years <= 0.0 || vol <= 0.0) return 0.0;
    const double x = (std::log(spot / level) + (rate - 0.5 * vol * vol) * years) / (vol * std::sqrt(years));
    return norm_cdf(x);
}

static json strategy_idea(
    const std::string& structure,
    const std::string& direction,
    const std::string& legs,
    double dte,
    double max_loss,
    double max_profit,
    double breakeven,
    double liquidity,
    const std::string& rationale,
    const std::string& invalidation,
    double pop
) {
    return {
        {"structure", structure},
        {"direction", direction},
        {"legs", legs},
        {"dte", static_cast<int>(std::round(dte))},
        {"maxLoss", round_to(max_loss, 2)},
        {"maxProfit", std::isfinite(max_profit) ? json(round_to(max_profit, 2)) : json("Unlimited")},
        {"breakeven", round_to(breakeven, 2)},
        {"liquidityScore", round_to(liquidity, 1)},
        {"probabilityOfProfit", round_to(pop * 100.0, 1)},
        {"rationale", rationale},
        {"invalidation", invalidation},
        {"source", "cpp-signal-engine"}
    };
}

static json options_strategy_ideas(const std::string& symbol, double spot, double vol, double rate, double dte) {
    const double step = spot > 200.0 ? 5.0 : spot > 50.0 ? 2.5 : 1.0;
    const double atm = std::round(spot / step) * step;
    const double liq = spot > 100.0 ? 8.0 : spot > 30.0 ? 6.0 : 4.0;
    json ideas = json::array();

    const double call_k = atm + step;
    const double call_prem = option_price_value("CALL", spot, call_k, dte, vol, rate);
    if (call_prem > 0.5) {
        const double be = call_k + call_prem;
        ideas.push_back(strategy_idea(
            "Long Call", "Bullish",
            symbol + " $" + std::to_string(static_cast<int>(std::round(call_k))) + "C exp ~" + std::to_string(static_cast<int>(dte)) + "d",
            dte, call_prem * 100.0, std::numeric_limits<double>::infinity(), be, liq,
            "Defined-risk bullish play priced by the native C++ options engine.",
            "Close below $" + std::to_string(static_cast<int>(std::round(call_k - spot * 0.05))) + " or implied volatility collapses.",
            probability_above(spot, be, dte, vol, rate)
        ));
    }

    const double lc = atm + step;
    const double sc = atm + step * 4.0;
    const double net_debit = option_price_value("CALL", spot, lc, dte, vol, rate) - option_price_value("CALL", spot, sc, dte, vol, rate);
    const double max_profit = (sc - lc) - net_debit;
    if (net_debit > 0.3 && max_profit > net_debit) {
        const double be = lc + net_debit;
        ideas.push_back(strategy_idea(
            "Call Debit Spread", "Bullish",
            "Buy $" + std::to_string(static_cast<int>(std::round(lc))) + "C / Sell $" + std::to_string(static_cast<int>(std::round(sc))) + "C exp ~" + std::to_string(static_cast<int>(dte)) + "d",
            dte, net_debit * 100.0, max_profit * 100.0, be, liq + 0.5,
            "Capped-risk bullish spread with native risk/reward scoring.",
            "Close below $" + std::to_string(static_cast<int>(std::round(lc - step))) + " or time decay erodes the setup.",
            probability_above(spot, be, dte, vol, rate)
        ));
    }

    const double cc_k = atm + step * 2.0;
    const double cc_prem = option_price_value("CALL", spot, cc_k, dte, vol, rate);
    if (cc_prem > 0.3) {
        ideas.push_back(strategy_idea(
            "Covered Call", "Neutral/Income",
            "Sell $" + std::to_string(static_cast<int>(std::round(cc_k))) + "C exp ~" + std::to_string(static_cast<int>(dte)) + "d (requires 100 shares)",
            dte, std::max(spot - cc_prem, 0.0) * 100.0, cc_prem * 100.0, spot - cc_prem, liq,
            "Income overlay for existing shares; C++ estimates premium, breakeven, and assignment risk.",
            "Stock pushes above $" + std::to_string(static_cast<int>(std::round(cc_k))) + " before expiry.",
            1.0 - probability_above(spot, cc_k, dte, vol, rate)
        ));
    }

    const double put_k = atm - step * 2.0;
    const double put_prem = option_price_value("PUT", spot, put_k, dte, vol, rate);
    if (put_prem > 0.2) {
        const double be = put_k - put_prem;
        ideas.push_back(strategy_idea(
            "Cash-Secured Put", "Neutral/Acquisition",
            "Sell $" + std::to_string(static_cast<int>(std::round(put_k))) + "P exp ~" + std::to_string(static_cast<int>(dte)) + "d",
            dte, be * 100.0, put_prem * 100.0, be, liq,
            "Acquire shares below spot or collect premium; native engine computes downside breakeven.",
            "Avoid around binary catalysts or a gap below $" + std::to_string(static_cast<int>(std::round(be))) + ".",
            probability_above(spot, be, dte, vol, rate)
        ));
    }

    const double lp = atm - step;
    const double sp = atm - step * 4.0;
    const double put_debit = option_price_value("PUT", spot, lp, dte, vol, rate) - option_price_value("PUT", spot, sp, dte, vol, rate);
    const double put_profit = (lp - sp) - put_debit;
    if (put_debit > 0.2 && put_profit > put_debit) {
        const double be = lp - put_debit;
        ideas.push_back(strategy_idea(
            "Put Debit Spread", "Bearish",
            "Buy $" + std::to_string(static_cast<int>(std::round(lp))) + "P / Sell $" + std::to_string(static_cast<int>(std::round(sp))) + "P exp ~" + std::to_string(static_cast<int>(dte)) + "d",
            dte, put_debit * 100.0, put_profit * 100.0, be, liq + 0.5,
            "Defined-risk bearish hedge scored by native pricing.",
            "Invalidated by a recovery above $" + std::to_string(static_cast<int>(std::round(lp + step))) + ".",
            1.0 - probability_above(spot, be, dte, vol, rate)
        ));
    }

    return ideas;
}

static json lorentzian_json(
    const std::string& symbol,
    const std::vector<double>& closes,
    const std::vector<double>& highs,
    const std::vector<double>& lows,
    const std::vector<double>& volumes,
    int k,
    int horizon
) {
    if (closes.size() < 70) {
        return {{"symbol", symbol}, {"action", "HOLD"}, {"confidence", 0.0}, {"score", 0.0},
                {"reason", "Need at least 70 candles for Lorentzian classification"}, {"neighbors", 0},
                {"source", "cpp-signal-engine"}};
    }

    k = std::clamp(k, 3, 25);
    horizon = std::clamp(horizon, 2, 20);

    const auto current_ind = compute_indicators(closes, highs, lows, volumes);
    const auto current_snap = compute_snapshot(closes);
    const double last = closes.back();
    const std::vector<double> cur = {
        current_ind.rsi_14 / 100.0,
        last != 0.0 ? current_ind.macd_histogram / last : 0.0,
        current_ind.bb_pct_b,
        current_snap.momentum_5,
        current_snap.volatility_20
    };

    struct Neighbor { double dist; int label; };
    std::vector<Neighbor> neighbors;
    const std::size_t max_i = closes.size() - static_cast<std::size_t>(horizon);
    for (std::size_t i = 55; i + static_cast<std::size_t>(horizon) < max_i; ++i) {
        std::vector<double> sub_closes(closes.begin(), closes.begin() + static_cast<long long>(i + 1));
        std::vector<double> sub_highs(highs.begin(), highs.begin() + static_cast<long long>(std::min(highs.size(), i + 1)));
        std::vector<double> sub_lows(lows.begin(), lows.begin() + static_cast<long long>(std::min(lows.size(), i + 1)));
        std::vector<double> sub_vols(volumes.begin(), volumes.begin() + static_cast<long long>(std::min(volumes.size(), i + 1)));
        if (sub_highs.size() != sub_closes.size()) sub_highs = sub_closes;
        if (sub_lows.size() != sub_closes.size()) sub_lows = sub_closes;
        if (sub_vols.size() != sub_closes.size()) sub_vols = std::vector<double>(sub_closes.size(), 1.0);

        const auto ind = compute_indicators(sub_closes, sub_highs, sub_lows, sub_vols);
        const auto snap = compute_snapshot(sub_closes);
        const double px = sub_closes.back();
        const std::vector<double> f = {
            ind.rsi_14 / 100.0,
            px != 0.0 ? ind.macd_histogram / px : 0.0,
            ind.bb_pct_b,
            snap.momentum_5,
            snap.volatility_20
        };

        double dist = 0.0;
        for (std::size_t j = 0; j < cur.size(); ++j) dist += std::log1p(std::abs(cur[j] - f[j]));
        const double future = closes[i + static_cast<std::size_t>(horizon)];
        const int label = future > px * 1.002 ? 1 : future < px * 0.998 ? -1 : 0;
        neighbors.push_back({dist, label});
    }

    if (neighbors.empty()) {
        return {{"symbol", symbol}, {"action", "HOLD"}, {"confidence", 0.0}, {"score", 0.0},
                {"reason", "No historical neighbors available"}, {"neighbors", 0}, {"source", "cpp-signal-engine"}};
    }
    std::sort(neighbors.begin(), neighbors.end(), [](const Neighbor& a, const Neighbor& b) { return a.dist < b.dist; });
    const int n = std::min<int>(k, neighbors.size());
    double vote = 0.0;
    double weight_sum = 0.0;
    int up = 0, down = 0, flat = 0;
    for (int i = 0; i < n; ++i) {
        const double weight = 1.0 / (neighbors[i].dist + 1e-6);
        vote += weight * neighbors[i].label;
        weight_sum += weight;
        if (neighbors[i].label > 0) ++up;
        else if (neighbors[i].label < 0) ++down;
        else ++flat;
    }
    const double score = weight_sum > 0.0 ? vote / weight_sum : 0.0;
    const std::string action = score > 0.20 ? "BUY" : score < -0.20 ? "SELL" : "HOLD";
    const double confidence = std::clamp(std::abs(score), 0.0, 1.0);

    return {
        {"symbol", symbol},
        {"action", action},
        {"confidence", round_to(confidence, 4)},
        {"score", round_to(score, 4)},
        {"neighbors", n},
        {"distribution", {{"up", up}, {"down", down}, {"flat", flat}}},
        {"features", {
            {"rsi_14", round_to(current_ind.rsi_14, 2)},
            {"macd_histogram", round_to(current_ind.macd_histogram, 4)},
            {"bb_pct_b", round_to(current_ind.bb_pct_b, 4)},
            {"momentum_5", round_to(current_snap.momentum_5, 4)},
            {"volatility_20", round_to(current_snap.volatility_20, 4)}
        }},
        {"reason", "Lorentzian nearest-neighbor classifier over RSI, MACD, Bollinger %B, momentum, and volatility"},
        {"source", "cpp-signal-engine"}
    };
}

static json scan_item_json(
    const std::string& symbol,
    const std::vector<double>& closes,
    const std::vector<double>& highs,
    const std::vector<double>& lows,
    const std::vector<double>& volumes
) {
    if (closes.size() < 55) {
        return {{"symbol", symbol}, {"action", "HOLD"}, {"score", 0.0}, {"confidence", 0.0},
                {"reason", "Insufficient candles for native scan"}, {"source", "cpp-signal-engine"}};
    }

    const auto ind = compute_indicators(closes, highs, lows, volumes);
    const auto sig = generate_signal(symbol, closes, highs, lows, volumes);
    const auto regime = analyze_regime(closes);
    const auto lor = lorentzian_json(symbol, closes, highs, lows, volumes, 8, 4);

    double score = 50.0;
    std::vector<std::string> evidence;
    std::vector<std::string> risk;

    const std::string signal_action = action_to_str(sig.action);
    if (signal_action == "BUY") {
        score += 18.0 * std::max(sig.confidence, 0.35);
        evidence.push_back("C++ technical signal BUY");
    } else if (signal_action == "SELL") {
        score -= 18.0 * std::max(sig.confidence, 0.35);
        risk.push_back("C++ technical signal SELL");
    }

    const std::string lor_action = lor.value("action", "HOLD");
    const double lor_conf = lor.value("confidence", 0.0);
    if (lor_action == "BUY") {
        score += 22.0 * std::max(lor_conf, 0.25);
        evidence.push_back("Lorentzian classifier bullish");
    } else if (lor_action == "SELL") {
        score -= 22.0 * std::max(lor_conf, 0.25);
        risk.push_back("Lorentzian classifier bearish");
    }

    if (regime.regime == "BULL_TREND") {
        score += 12.0 * std::max(regime.confidence, 0.35);
        evidence.push_back("Regime BULL_TREND");
    } else if (regime.regime == "BEAR_TREND") {
        score -= 12.0 * std::max(regime.confidence, 0.35);
        risk.push_back("Regime BEAR_TREND");
    } else if (regime.regime == "HIGH_VOL") {
        score -= 8.0;
        risk.push_back("HIGH_VOL regime");
    }

    if (ind.rsi_14 < 35.0) evidence.push_back("RSI near oversold");
    if (ind.rsi_14 > 70.0) risk.push_back("RSI overbought");
    if (ind.bb_pct_b < 0.15) evidence.push_back("Near lower Bollinger band");
    if (ind.bb_pct_b > 0.90) risk.push_back("Near upper Bollinger band");

    score = std::clamp(score, 0.0, 100.0);
    std::string action = "WATCH";
    if (score >= 72.0 && risk.size() <= evidence.size()) action = "RESEARCH";
    else if (score <= 35.0 || risk.size() > evidence.size() + 1) action = "AVOID";

    return {
        {"symbol", symbol},
        {"score", round_to(score, 1)},
        {"action", action},
        {"direction", score >= 58.0 ? "Bullish" : score <= 42.0 ? "Bearish" : "Neutral"},
        {"confidence", round_to(std::max(sig.confidence, lor_conf), 4)},
        {"price", round_to(closes.back(), 2)},
        {"nativeSignal", signal_to_json(sig)},
        {"regime", regime_to_json(regime)},
        {"lorentzian", lor},
        {"indicators", indicators_to_json(ind)},
        {"evidence", evidence},
        {"riskFlags", risk},
        {"source", "cpp-signal-engine"}
    };
}

static json backtest_json(
    const std::string& symbol,
    std::string strategy,
    const std::vector<double>& closes,
    const std::vector<double>& highs,
    const std::vector<double>& lows,
    const std::vector<double>& volumes,
    double capital,
    double position_pct,
    double commission,
    double slippage_bps
) {
    strategy = upper(strategy);
    if (closes.size() < 80) {
        return {{"symbol", symbol}, {"error", "Need at least 80 closes for native backtest"}, {"source", "cpp-signal-engine"}};
    }

    double cash = capital;
    double shares = 0.0;
    double entry = 0.0;
    double peak = capital;
    double max_dd = 0.0;
    double total_pnl = 0.0;
    int trades = 0;
    int wins = 0;
    json trade_log = json::array();
    std::vector<double> equity_curve;
    std::vector<double> daily_returns;
    equity_curve.reserve(closes.size());

    for (std::size_t i = 60; i < closes.size(); ++i) {
        const double price = closes[i];
        std::vector<double> sub_closes(closes.begin(), closes.begin() + static_cast<long long>(i + 1));
        std::vector<double> sub_highs(highs.begin(), highs.begin() + static_cast<long long>(std::min(highs.size(), i + 1)));
        std::vector<double> sub_lows(lows.begin(), lows.begin() + static_cast<long long>(std::min(lows.size(), i + 1)));
        std::vector<double> sub_vols(volumes.begin(), volumes.begin() + static_cast<long long>(std::min(volumes.size(), i + 1)));
        if (sub_highs.size() != sub_closes.size()) sub_highs = sub_closes;
        if (sub_lows.size() != sub_closes.size()) sub_lows = sub_closes;
        if (sub_vols.size() != sub_closes.size()) sub_vols = std::vector<double>(sub_closes.size(), 1.0);

        std::string signal = "HOLD";
        if (strategy == "LORENTZIAN" || strategy == "LORENTZIAN_CLASSIFIER") {
            auto lor = lorentzian_json(symbol, sub_closes, sub_highs, sub_lows, sub_vols, 8, 4);
            signal = lor.value("action", "HOLD");
        } else {
            const double sma20 = sma(sub_closes, 20);
            const double sma50 = sma(sub_closes, 50);
            signal = sma20 > sma50 ? "BUY" : sma20 < sma50 ? "SELL" : "HOLD";
        }

        const double slip = price * slippage_bps / 10000.0;
        if (shares <= 0.0 && signal == "BUY") {
            const double fill = price + slip;
            const double budget = cash * std::clamp(position_pct, 0.05, 1.0);
            shares = std::floor((budget - commission) / fill);
            if (shares > 0.0) {
                cash -= shares * fill + commission;
                entry = fill;
            }
        } else if (shares > 0.0 && signal == "SELL") {
            const double fill = price - slip;
            const double pnl = (fill - entry) * shares - commission;
            cash += shares * fill - commission;
            total_pnl += pnl;
            wins += pnl > 0.0 ? 1 : 0;
            ++trades;
            trade_log.push_back({{"index", i}, {"side", "SELL"}, {"price", round_to(fill, 2)}, {"pnl", round_to(pnl, 2)}});
            shares = 0.0;
            entry = 0.0;
        }

        const double equity = cash + shares * price;
        if (!equity_curve.empty() && equity_curve.back() > 0.0) daily_returns.push_back((equity / equity_curve.back()) - 1.0);
        equity_curve.push_back(equity);
        peak = std::max(peak, equity);
        if (peak > 0.0) max_dd = std::max(max_dd, (peak - equity) / peak);
    }

    if (shares > 0.0) {
        const double price = closes.back();
        const double pnl = (price - entry) * shares - commission;
        cash += shares * price - commission;
        total_pnl += pnl;
        wins += pnl > 0.0 ? 1 : 0;
        ++trades;
        trade_log.push_back({{"index", closes.size() - 1}, {"side", "LIQUIDATE"}, {"price", round_to(price, 2)}, {"pnl", round_to(pnl, 2)}});
    }

    const double ending = cash;
    const double total_pct = capital > 0.0 ? ((ending / capital) - 1.0) * 100.0 : 0.0;
    const double avg_ret = mean_value(daily_returns);
    const double ret_sd = stddev_value(daily_returns);
    const double sharpe = ret_sd > 0.0 ? (avg_ret / ret_sd) * std::sqrt(252.0) : 0.0;

    return {
        {"symbol", symbol},
        {"strategy", strategy},
        {"startingCapital", round_to(capital, 2)},
        {"endingCapital", round_to(ending, 2)},
        {"totalPnl", round_to(ending - capital, 2)},
        {"totalPnlPct", round_to(total_pct, 2)},
        {"maxDrawdownPct", round_to(max_dd * 100.0, 2)},
        {"sharpeRatio", round_to(sharpe, 2)},
        {"winRate", trades > 0 ? round_to(static_cast<double>(wins) / trades * 100.0, 1) : 0.0},
        {"trades", trades},
        {"tradeLog", trade_log},
        {"source", "cpp-signal-engine"}
    };
}

static json portfolio_risk_json(const json& assets) {
    if (!assets.is_array() || assets.size() < 2) {
        return {{"error", "Need at least two assets"}, {"source", "cpp-signal-engine"}};
    }

    std::vector<std::string> symbols;
    std::vector<std::vector<double>> returns;
    std::vector<double> weights;

    for (const auto& asset : assets) {
        auto closes = asset.value("closes", std::vector<double>{});
        if (closes.size() < 3) continue;
        symbols.push_back(asset.value("symbol", "UNKNOWN"));
        returns.push_back(returns_of(closes));
        weights.push_back(asset.value("weight", 0.0));
    }

    const std::size_t n = symbols.size();
    if (n < 2) return {{"error", "Need at least two assets with returns"}, {"source", "cpp-signal-engine"}};
    double weight_sum = std::accumulate(weights.begin(), weights.end(), 0.0);
    if (weight_sum <= 0.0) {
        weights.assign(n, 1.0 / static_cast<double>(n));
    } else {
        for (double& w : weights) w /= weight_sum;
    }

    std::vector<double> ann_ret(n), ann_vol(n), inv_vol(n);
    for (std::size_t i = 0; i < n; ++i) {
        ann_ret[i] = mean_value(returns[i]) * 252.0;
        ann_vol[i] = stddev_value(returns[i]) * std::sqrt(252.0);
        inv_vol[i] = 1.0 / std::max(ann_vol[i], 0.01);
    }
    const double inv_sum = std::accumulate(inv_vol.begin(), inv_vol.end(), 0.0);

    double port_ret = 0.0;
    double port_var_daily = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        port_ret += weights[i] * ann_ret[i];
        for (std::size_t j = 0; j < n; ++j) {
            port_var_daily += weights[i] * weights[j] * covariance(returns[i], returns[j]);
        }
    }
    const double port_vol = std::sqrt(std::max(port_var_daily, 0.0)) * std::sqrt(252.0);

    json assets_out = json::array();
    for (std::size_t i = 0; i < n; ++i) {
        double marginal_daily = 0.0;
        for (std::size_t j = 0; j < n; ++j) marginal_daily += weights[j] * covariance(returns[i], returns[j]);
        const double contribution = port_var_daily > 0.0 ? weights[i] * marginal_daily / port_var_daily : 0.0;
        assets_out.push_back({
            {"symbol", symbols[i]},
            {"weight", round_to(weights[i], 4)},
            {"suggestedWeight", round_to(inv_vol[i] / inv_sum, 4)},
            {"expectedReturn", round_to(ann_ret[i], 4)},
            {"volatility", round_to(ann_vol[i], 4)},
            {"riskContribution", round_to(contribution, 4)}
        });
    }

    json corrs = json::array();
    for (std::size_t i = 0; i < n; ++i) {
        for (std::size_t j = i + 1; j < n; ++j) {
            corrs.push_back({{"sym1", symbols[i]}, {"sym2", symbols[j]}, {"correlation", round_to(correlation(returns[i], returns[j]), 4)}});
        }
    }

    return {
        {"expectedReturn", round_to(port_ret, 4)},
        {"volatility", round_to(port_vol, 4)},
        {"sharpe", port_vol > 0.0 ? round_to(port_ret / port_vol, 4) : 0.0},
        {"assets", assets_out},
        {"correlations", corrs},
        {"source", "cpp-signal-engine"}
    };
}

static json indicators_to_json(const Indicators& i) {
    return {
        {"rsi_14",        i.rsi_14},
        {"macd",          i.macd},
        {"macd_signal",   i.macd_signal},
        {"macd_histogram",i.macd_histogram},
        {"sma_20",        i.sma_20},
        {"sma_50",        i.sma_50},
        {"ema_12",        i.ema_12},
        {"ema_26",        i.ema_26},
        {"bb_upper",      i.bb_upper},
        {"bb_middle",     i.bb_middle},
        {"bb_lower",      i.bb_lower},
        {"bb_pct_b",      i.bb_pct_b},
        {"atr_14",        i.atr_14},
        {"vwap",          i.vwap}
    };
}

static json signal_to_json(const Signal& s) {
    return {
        {"symbol",     s.symbol},
        {"action",     action_to_str(s.action)},
        {"confidence", s.confidence},
        {"reason",     s.reason},
        {"indicators", indicators_to_json(s.indicators)}
    };
}

static json snapshot_to_json(const Snapshot& s) {
    return {
        {"momentum_5",    s.momentum_5},
        {"momentum_20",   s.momentum_20},
        {"volatility_20", s.volatility_20},
        {"trend_score",   s.trend_score}
    };
}

static json regime_to_json(const RegimeAnalysis& r) {
    return {
        {"regime",     r.regime},
        {"direction",  r.direction},
        {"confidence", r.confidence},
        {"snapshot",   snapshot_to_json(r.snapshot)}
    };
}

int main() {
    // ─── ZMQ publisher ──────────────────────────────────────
    void* zctx = zmq_ctx_new();
    void* zpub = zmq_socket(zctx, ZMQ_PUB);
    if (zmq_bind(zpub, "tcp://*:5555") != 0) {
        std::cerr << "ZMQ bind failed: " << zmq_strerror(errno) << "\n";
        return 1;
    }
    std::cout << "[zmq] PUB bound to tcp://*:5555\n";

    // ─── REST server ───────────────────────────────────────
    httplib::Server srv;

    srv.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(R"({"status":"healthy","service":"cpp-signal-engine"})", "application/json");
    });

    srv.Post("/indicators", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::vector<double> closes  = body.value("closes", std::vector<double>{});
            std::vector<double> highs   = body.value("highs", closes);
            std::vector<double> lows    = body.value("lows", closes);
            std::vector<double> volumes = body.value("volumes", std::vector<double>(closes.size(), 1.0));
            Indicators ind = compute_indicators(closes, highs, lows, volumes);
            res.set_content(indicators_to_json(ind).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/signals/compute", [&](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string symbol = body.value("symbol", "UNKNOWN");
            std::vector<double> closes  = body.value("closes", std::vector<double>{});
            std::vector<double> highs   = body.value("highs", closes);
            std::vector<double> lows    = body.value("lows", closes);
            std::vector<double> volumes = body.value("volumes", std::vector<double>(closes.size(), 1.0));

            Signal s = generate_signal(symbol, closes, highs, lows, volumes);
            json j = signal_to_json(s);

            // Publish to ZMQ
            publish_json(zpub, j);

            res.set_content(j.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // Phase 2: regime analysis for AI advisor RAG context
    srv.Post("/regime", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::vector<double> closes = body.value("closes", std::vector<double>{});
            RegimeAnalysis ra = analyze_regime(closes);
            res.set_content(regime_to_json(ra).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/scan/batch", [&](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            json results = json::array();
            for (const auto& item : body.value("items", json::array())) {
                std::string symbol = upper(item.value("symbol", "UNKNOWN"));
                std::vector<double> closes  = item.value("closes", std::vector<double>{});
                std::vector<double> highs   = item.value("highs", closes);
                std::vector<double> lows    = item.value("lows", closes);
                std::vector<double> volumes = item.value("volumes", std::vector<double>(closes.size(), 1.0));
                json scan = scan_item_json(symbol, closes, highs, lows, volumes);
                results.push_back(scan);
                publish_json(zpub, {
                    {"type", "native_scan"},
                    {"symbol", symbol},
                    {"score", scan.value("score", 0.0)},
                    {"action", scan.value("action", "WATCH")},
                    {"direction", scan.value("direction", "Neutral")},
                    {"generatedAtMs", std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch()).count()},
                    {"payload", scan}
                });
            }
            res.set_content(json{{"results", results}, {"source", "cpp-signal-engine"}}.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/classifiers/lorentzian", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string symbol = upper(body.value("symbol", "UNKNOWN"));
            std::vector<double> closes  = body.value("closes", std::vector<double>{});
            std::vector<double> highs   = body.value("highs", closes);
            std::vector<double> lows    = body.value("lows", closes);
            std::vector<double> volumes = body.value("volumes", std::vector<double>(closes.size(), 1.0));
            int k = body.value("k", 8);
            int horizon = body.value("horizon", 4);
            res.set_content(lorentzian_json(symbol, closes, highs, lows, volumes, k, horizon).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/options/price", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            const std::string type = body.value("type", "CALL");
            const double spot = body.value("spot", 150.0);
            const double strike = body.value("strike", 155.0);
            const double days = body.value("days", body.value("daysToExpiry", 30.0));
            const double vol = body.value("volatility", body.value("vol", 0.30));
            const double rate = body.value("rate", body.value("riskFreeRate", 0.05));
            res.set_content(price_option_json(type, spot, strike, days, vol, rate).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/options/iv", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            const std::string type = body.value("type", "CALL");
            const double spot = body.value("spot", 150.0);
            const double strike = body.value("strike", 155.0);
            const double days = body.value("days", body.value("daysToExpiry", 30.0));
            const double rate = body.value("rate", body.value("riskFreeRate", 0.05));
            const double market_price = body.value("marketPrice", 5.0);
            const double iv = implied_volatility(type, market_price, spot, strike, days, rate);
            res.set_content(json{{"days", days}, {"impliedVolatility", iv}, {"ivPercent", round_to(iv * 100.0, 2)},
                                 {"source", "cpp-signal-engine"}}.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/options/strategies", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            const std::string symbol = upper(body.value("symbol", "UNKNOWN"));
            const double spot = body.value("spot", 150.0);
            const double vol = body.value("volatility", body.value("vol", 0.30));
            const double rate = body.value("rate", body.value("riskFreeRate", 0.05));
            const double dte = body.value("dte", body.value("days", 35.0));
            res.set_content(json{{"symbol", symbol}, {"ideas", options_strategy_ideas(symbol, spot, vol, rate, dte)},
                                 {"source", "cpp-signal-engine"}}.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/backtest", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string symbol = upper(body.value("symbol", "UNKNOWN"));
            std::vector<double> closes  = body.value("closes", std::vector<double>{});
            std::vector<double> highs   = body.value("highs", closes);
            std::vector<double> lows    = body.value("lows", closes);
            std::vector<double> volumes = body.value("volumes", std::vector<double>(closes.size(), 1.0));
            res.set_content(backtest_json(
                symbol,
                body.value("strategy", "LORENTZIAN"),
                closes, highs, lows, volumes,
                body.value("capital", 10000.0),
                body.value("positionPct", 0.95),
                body.value("commission", 1.0),
                body.value("slippageBps", 5.0)
            ).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.Post("/risk/portfolio", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            res.set_content(portfolio_risk_json(body.value("assets", json::array())).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    srv.set_pre_routing_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        return httplib::Server::HandlerResponse::Unhandled;
    });

    srv.Options(".*", [](const httplib::Request&, httplib::Response& res) {
        res.status = 204;
    });

    std::cout << "[http] listening on 0.0.0.0:9000\n";
    std::thread http_thread([&]() {
        srv.listen("0.0.0.0", 9000);
    });

    // Wait for ctrl-c
    while (running) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    srv.stop();
    if (http_thread.joinable()) http_thread.join();
    zmq_close(zpub);
    zmq_ctx_destroy(zctx);
    return 0;
}
