// signal_server.cpp
// Networked signal engine - REST + ZMQ pub
// Build with: cmake -DBUILD_SERVER=ON ..
//
// Endpoints:
//   GET  /health
//   POST /indicators        { closes, highs, lows, volumes }          -> Indicators JSON
//   POST /signals/compute   { symbol, closes, highs, lows, volumes }  -> Signal JSON
//   POST /regime            { closes }                                 -> RegimeAnalysis JSON
//
// ZMQ pub on tcp://*:5555 - broadcasts signals as they're generated.

#include "feature_engine.hpp"

#include <httplib.h>
#include <nlohmann/json.hpp>
#include <zmq.h>

#include <atomic>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>

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
            std::string msg = j.dump();
            zmq_send(zpub, msg.c_str(), msg.size(), ZMQ_DONTWAIT);

            res.set_content(msg, "application/json");
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

    srv.set_pre_routing_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        return httplib::Server::HandlerResponse::Unhandled;
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
