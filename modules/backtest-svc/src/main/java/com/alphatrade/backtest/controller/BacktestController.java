package com.alphatrade.backtest.controller;

import com.alphatrade.backtest.engine.BacktestEngine;
import com.alphatrade.backtest.model.*;
import com.alphatrade.backtest.strategy.Strategy;
import com.alphatrade.backtest.strategy.StrategyDSL;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

/**
 * Backtest API with input validation, stop-loss/take-profit,
 * walk-forward analysis, and strategy comparison.
 */
@RestController
@RequestMapping("/api/backtest")
@CrossOrigin(origins = "*")
public class BacktestController {

    private static final Logger log = LoggerFactory.getLogger(BacktestController.class);
    private static final ObjectMapper mapper = new ObjectMapper();
    private final BacktestEngine engine;
    private final HttpClient httpClient;
    private final String marketDataUrl;

    public BacktestController(BacktestEngine engine, @Value("${marketdata.url:http://localhost:8087}") String mdUrl) {
        this.engine = engine; this.httpClient = HttpClient.newHttpClient(); this.marketDataUrl = mdUrl;
    }

    /**
     * Run a single backtest with full parameter support.
     * Now includes: stopLossPct, takeProfitPct, and short selling.
     */
    @PostMapping("/run")
    public ResponseEntity<?> runBacktest(@RequestBody Map<String, Object> req) {
        // ── Input validation ────────────────────────────────────────
        String symbol = strParam(req, "symbol", "AAPL").toUpperCase();
        String stratName = strParam(req, "strategy", "SMA_CROSSOVER");
        double capital = dblParam(req, "capital", 100000);
        if (capital <= 0) return badRequest("capital must be positive");
        double posPct = dblParam(req, "positionPct", 0.95);
        if (posPct <= 0 || posPct > 1) return badRequest("positionPct must be between 0 and 1");
        double comm = dblParam(req, "commission", 1.0);
        double slip = dblParam(req, "slippage", 5);
        double stopLoss = dblParam(req, "stopLossPct", 0);
        double takeProfit = dblParam(req, "takeProfitPct", 0);

        Object rawParams = req.getOrDefault("params", Map.of());
        Map<String, Object> params;
        if (rawParams instanceof Map) {
            params = (Map<String, Object>) rawParams;
        } else {
            return badRequest("params must be a JSON object, got: " + rawParams.getClass().getSimpleName());
        }

        List<Bar> bars = fetchBars(symbol);
        if (bars.isEmpty()) return badRequest("No data for " + symbol + ". POST /api/marketdata/ingest/" + symbol + " first");

        Strategy s = resolve(stratName, params);
        if (s == null) return badRequest("Unknown strategy: " + stratName + ". Available: " + stratNames());

        BacktestResult result = engine.run(bars, s, symbol, capital, posPct, comm, slip, stopLoss, takeProfit);
        return ResponseEntity.ok(result);
    }

    /** Compare multiple strategies head-to-head */
    @PostMapping("/compare")
    public ResponseEntity<?> compare(@RequestBody Map<String, Object> req) {
        String symbol = strParam(req, "symbol", "AAPL").toUpperCase();
        List<String> names = (List<String>) req.getOrDefault("strategies",
            List.of("SMA_CROSSOVER", "RSI_MEAN_REVERSION", "MACD_CROSSOVER", "BUY_AND_HOLD"));
        double capital = dblParam(req, "capital", 100000);

        List<Bar> bars = fetchBars(symbol);
        if (bars.isEmpty()) return badRequest("No data for " + symbol);

        List<Map<String, Object>> results = new ArrayList<>();
        for (String n : names) {
            Strategy s = resolve(n, Map.of());
            if (s != null) {
                BacktestResult r = engine.run(bars, s, symbol, capital, 0.95, 1.0, 5);
                Map<String, Object> sm = new LinkedHashMap<>();
                sm.put("strategy", r.strategy()); sm.put("totalReturn", r.totalPnlPct());
                sm.put("sharpe", r.sharpeRatio()); sm.put("maxDrawdown", r.maxDrawdownPct());
                sm.put("winRate", r.winRate()); sm.put("trades", r.totalTrades());
                sm.put("profitFactor", r.profitFactor()); sm.put("endingCapital", r.endingCapital());
                results.add(sm);
            }
        }
        return ResponseEntity.ok(Map.of("symbol", symbol, "bars", bars.size(), "comparisons", results));
    }

    /** Walk-forward analysis */
    @PostMapping("/walkforward")
    public ResponseEntity<?> walkForward(@RequestBody Map<String, Object> req) {
        String symbol = strParam(req, "symbol", "AAPL").toUpperCase();
        String stratName = strParam(req, "strategy", "SMA_CROSSOVER");
        double capital = dblParam(req, "capital", 100000);
        int inSample = intParam(req, "inSampleBars", 252);   // 1 year default
        int outSample = intParam(req, "outOfSampleBars", 63); // 3 months default

        List<Bar> bars = fetchBars(symbol);
        if (bars.isEmpty()) return badRequest("No data for " + symbol);

        Strategy s = resolve(stratName, Map.of());
        if (s == null) return badRequest("Unknown strategy: " + stratName);

        List<BacktestResult> windows = engine.walkForward(bars, s, symbol, capital, inSample, outSample);

        double totalReturn = 0;
        for (BacktestResult w : windows) totalReturn += w.totalPnlPct();
        double avgReturn = windows.isEmpty() ? 0 : totalReturn / windows.size();

        return ResponseEntity.ok(Map.of(
            "symbol", symbol, "strategy", stratName,
            "windows", windows.size(), "avgReturnPerWindow", Math.round(avgReturn * 100.0) / 100.0,
            "results", windows.stream().map(w -> Map.of(
                "period", w.period(), "return", w.totalPnlPct(), "sharpe", w.sharpeRatio(),
                "trades", w.totalTrades(), "winRate", w.winRate()
            )).toList()
        ));
    }

    /**
     * Run a custom DSL-defined strategy.
     * Body: { "symbol": "AAPL", "capital": 100000,
     *         "strategy": { "name": "my_strat", "logic": "ALL",
     *           "entry": [{"indicator":"rsi","period":14,"operator":"<","value":30},
     *                     {"indicator":"price","operator":">","reference":"sma","period":200}],
     *           "exit":  [{"indicator":"rsi","period":14,"operator":">","value":70}]
     *         }
     *       }
     */
    @PostMapping("/run/custom")
    public ResponseEntity<?> runCustomStrategy(@RequestBody Map<String, Object> req) {
        String symbol = strParam(req, "symbol", "AAPL").toUpperCase();
        double capital = dblParam(req, "capital", 100000);
        double stopLoss = dblParam(req, "stopLossPct", 0);
        double takeProfit = dblParam(req, "takeProfitPct", 0);

        Object stratDef = req.get("strategy");
        if (!(stratDef instanceof Map)) return badRequest("strategy must be a JSON object with name, entry, exit, logic");

        Strategy strategy;
        try {
            strategy = StrategyDSL.fromMap((Map<String, Object>) stratDef);
        } catch (Exception e) {
            return badRequest("Invalid strategy definition: " + e.getMessage());
        }

        List<Bar> bars = fetchBars(symbol);
        if (bars.isEmpty()) return badRequest("No data for " + symbol);

        BacktestResult result = engine.run(bars, strategy, symbol, capital, 0.95, 1.0, 5, stopLoss, takeProfit);
        return ResponseEntity.ok(result);
    }

    /** List available strategies */
    @GetMapping("/strategies")
    public ResponseEntity<?> listStrategies() {
        return ResponseEntity.ok(List.of(
            Map.of("id", "SMA_CROSSOVER", "name", "SMA Crossover", "params", "fast(10),slow(50)"),
            Map.of("id", "RSI_MEAN_REVERSION", "name", "RSI Mean Reversion", "params", "period(14),oversold(30),overbought(70)"),
            Map.of("id", "MACD_CROSSOVER", "name", "MACD Crossover", "params", "fast(12),slow(26),signal(9)"),
            Map.of("id", "BOLLINGER_BOUNCE", "name", "Bollinger Bounce", "params", "period(20),mult(2.0)"),
            Map.of("id", "MEAN_REVERSION", "name", "Mean Reversion", "params", "period(20),threshold(0.02)"),
            Map.of("id", "BREAKOUT", "name", "Donchian Breakout", "params", "period(20)"),
            Map.of("id", "BUY_AND_HOLD", "name", "Buy and Hold", "params", "none")
        ));
    }

    private Strategy resolve(String name, Map<String, Object> p) {
        return switch (name.toUpperCase()) {
            case "SMA_CROSSOVER" -> Strategy.smaCrossover(iP(p, "fast", 10), iP(p, "slow", 50));
            case "RSI_MEAN_REVERSION" -> Strategy.rsiMeanReversion(iP(p, "period", 14), dP(p, "oversold", 30), dP(p, "overbought", 70));
            case "MACD_CROSSOVER" -> Strategy.macdCrossover(iP(p, "fast", 12), iP(p, "slow", 26), iP(p, "signal", 9));
            case "BOLLINGER_BOUNCE" -> Strategy.bollingerBounce(iP(p, "period", 20), dP(p, "mult", 2.0));
            case "MEAN_REVERSION" -> Strategy.meanReversion(iP(p, "period", 20), dP(p, "threshold", 0.02));
            case "BREAKOUT" -> Strategy.breakout(iP(p, "period", 20));
            case "BUY_AND_HOLD" -> Strategy.buyAndHold();
            default -> null;
        };
    }

    private List<String> stratNames() {
        return List.of("SMA_CROSSOVER", "RSI_MEAN_REVERSION", "MACD_CROSSOVER", "BOLLINGER_BOUNCE", "MEAN_REVERSION", "BREAKOUT", "BUY_AND_HOLD");
    }

    private List<Bar> fetchBars(String symbol) {
        try {
            HttpRequest req = HttpRequest.newBuilder().uri(URI.create(marketDataUrl + "/api/marketdata/candles/" + symbol)).GET().build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return Collections.emptyList();
            JsonNode arr = mapper.readTree(res.body()); List<Bar> bars = new ArrayList<>();
            for (JsonNode n : arr) bars.add(new Bar(n.get("date").asText(), n.get("open").asDouble(),
                n.get("high").asDouble(), n.get("low").asDouble(), n.get("close").asDouble(), n.get("volume").asLong()));
            return bars;
        } catch (Exception e) { log.error("Fetch bars failed: {}", e.getMessage()); return Collections.emptyList(); }
    }

    private ResponseEntity<?> badRequest(String msg) {
        return ResponseEntity.badRequest().body(Map.of("error", msg));
    }

    private String strParam(Map<String, Object> m, String k, String d) {
        Object v = m.get(k); return v != null ? v.toString() : d;
    }
    private int intParam(Map<String, Object> m, String k, int d) {
        Object v = m.get(k); return v instanceof Number n ? n.intValue() : d;
    }
    private double dblParam(Map<String, Object> m, String k, double d) {
        Object v = m.get(k); return v instanceof Number n ? n.doubleValue() : d;
    }
    private int iP(Map<String, Object> p, String k, int d) { return intParam(p, k, d); }
    private double dP(Map<String, Object> p, String k, double d) { return dblParam(p, k, d); }
}
