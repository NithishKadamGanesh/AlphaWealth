package com.alphatrade.analysis.controller;

import com.alphatrade.analysis.alert.AlertEngine;
import com.alphatrade.analysis.finance.FinanceEngine;
import com.alphatrade.analysis.options.OptionsEngine;
import com.alphatrade.analysis.indicator.IndicatorEngine;
import com.alphatrade.analysis.indicator.SupportResistanceDetector;
import com.alphatrade.analysis.model.Candle;
import com.alphatrade.analysis.pattern.PatternDetector;
import com.alphatrade.analysis.portfolio.PortfolioOptimizer;
import com.alphatrade.analysis.seasonality.SeasonalityEngine;
import com.alphatrade.analysis.signal.SignalGenerator;
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
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Analysis API with caching, alerts, multi-timeframe, and portfolio optimization.
 *
 * FIXES:
 *   - Candle fetches are cached with 60s TTL (was re-fetching on every call)
 *   - Added alert management endpoints
 *   - Added multi-timeframe convergence analysis
 *   - Added portfolio optimization endpoint
 */
@RestController
@RequestMapping("/api/analysis")
@CrossOrigin(origins = "*")
public class AnalysisController {

    private static final Logger log = LoggerFactory.getLogger(AnalysisController.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    private final IndicatorEngine indicatorEngine;
    private final PatternDetector patternDetector;
    private final SupportResistanceDetector srDetector;
    private final SeasonalityEngine seasonalityEngine;
    private final SignalGenerator signalGenerator;
    private final AlertEngine alertEngine;
    private final PortfolioOptimizer portfolioOptimizer;
    private final OptionsEngine optionsEngine;
    private final FinanceEngine financeEngine;
    private final HttpClient httpClient;
    private final String marketDataUrl;
    private final String cppEngineUrl;

    // ── Candle cache (symbol → (timestamp, candles)) ────────────
    private final ConcurrentHashMap<String, CacheEntry> candleCache = new ConcurrentHashMap<>();
    private static final long CACHE_TTL_MS = 60_000; // 60 seconds

    private record CacheEntry(long ts, List<Candle> candles) {}

    public AnalysisController(IndicatorEngine ie, PatternDetector pd, SupportResistanceDetector sr,
            SeasonalityEngine se, SignalGenerator sg, AlertEngine ae, PortfolioOptimizer po,
            OptionsEngine oe, FinanceEngine fe,
            @Value("${marketdata.url:http://localhost:8087}") String mdUrl,
            @Value("${services.cpp-engine:http://cpp-signal-engine:9000}") String cppUrl) {
        this.indicatorEngine = ie; this.patternDetector = pd; this.srDetector = sr;
        this.seasonalityEngine = se; this.signalGenerator = sg; this.alertEngine = ae;
        this.portfolioOptimizer = po;
        this.optionsEngine = oe;
        this.financeEngine = fe;
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        this.marketDataUrl = mdUrl;
        this.cppEngineUrl = cppUrl;
    }

    // ═══════════════════════════════════════════════════════════════
    // EXISTING ENDPOINTS (now with caching)
    // ═══════════════════════════════════════════════════════════════

    @GetMapping("/{symbol}/indicators")
    public ResponseEntity<?> indicators(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        return ResponseEntity.ok(indicatorEngine.computeAll(c));
    }

    @GetMapping("/{symbol}/patterns")
    public ResponseEntity<?> patterns(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        return ResponseEntity.ok(patternDetector.detectAll(c));
    }

    @GetMapping("/{symbol}/levels")
    public ResponseEntity<?> levels(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        return ResponseEntity.ok(srDetector.detect(c));
    }

    @GetMapping("/{symbol}/seasonality")
    public ResponseEntity<?> seasonality(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        return ResponseEntity.ok(seasonalityEngine.analyze(c));
    }

    @GetMapping("/{symbol}/signal")
    public ResponseEntity<?> signal(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        return ResponseEntity.ok(signalGenerator.generate(symbol.toUpperCase(), c));
    }

    @GetMapping("/{symbol}/full")
    public ResponseEntity<?> full(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        String sym = symbol.toUpperCase();
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("symbol", sym); r.put("candles", c.size());
        r.put("signal", signalGenerator.generate(sym, c));
        r.put("patterns", patternDetector.detectAll(c));
        r.put("levels", srDetector.detect(c));
        r.put("seasonality", seasonalityEngine.analyze(c));
        r.put("alerts", alertEngine.scan(sym, c));
        return ResponseEntity.ok(r);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: ALERT ENDPOINTS
    // ═══════════════════════════════════════════════════════════════

    /** Scan a symbol for alerts right now */
    @GetMapping("/{symbol}/alerts")
    public ResponseEntity<?> scanAlerts(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        return ResponseEntity.ok(alertEngine.scan(symbol.toUpperCase(), c));
    }

    /** Add a custom alert rule */
    @PostMapping("/alerts/rules")
    public ResponseEntity<?> addRule(@RequestBody Map<String, Object> body) {
        String id = (String) body.getOrDefault("id", UUID.randomUUID().toString().substring(0, 8));
        String sym = ((String) body.getOrDefault("symbol", "AAPL")).toUpperCase();
        String condition = (String) body.getOrDefault("condition", "price_above");
        double threshold = body.containsKey("threshold") ? ((Number) body.get("threshold")).doubleValue() : 0;
        String webhook = (String) body.get("webhookUrl");

        alertEngine.addRule(new AlertEngine.AlertRule(id, sym, condition, threshold, true, webhook));
        return ResponseEntity.ok(Map.of("status", "OK", "ruleId", id));
    }

    /** List all alert rules */
    @GetMapping("/alerts/rules")
    public ResponseEntity<?> listRules() { return ResponseEntity.ok(alertEngine.getRules()); }

    /** Delete a rule */
    @DeleteMapping("/alerts/rules/{ruleId}")
    public ResponseEntity<?> deleteRule(@PathVariable String ruleId) {
        alertEngine.removeRule(ruleId);
        return ResponseEntity.ok(Map.of("status", "deleted", "ruleId", ruleId));
    }

    /** Get recent alerts */
    @GetMapping("/alerts/recent")
    public ResponseEntity<?> recentAlerts(@RequestParam(defaultValue = "50") int limit) {
        return ResponseEntity.ok(alertEngine.getRecentAlerts(limit));
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: MULTI-TIMEFRAME ANALYSIS
    // ═══════════════════════════════════════════════════════════════

    /** Multi-timeframe convergence: daily + weekly signals combined */
    @GetMapping("/{symbol}/multitimeframe")
    public ResponseEntity<?> multiTimeframe(@PathVariable String symbol) {
        String sym = symbol.toUpperCase();
        List<Candle> daily = getCachedCandles(sym);
        List<Candle> weekly = fetchCandlesFromUrl(marketDataUrl + "/api/marketdata/candles/" + sym + "/weekly");

        if (daily.isEmpty()) return noData(sym);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("symbol", sym);

        // Daily signal
        var dailySignal = signalGenerator.generate(sym, daily);
        result.put("daily", dailySignal);

        // Weekly signal (if available)
        if (!weekly.isEmpty() && weekly.size() >= 50) {
            var weeklySignal = signalGenerator.generate(sym, weekly);
            result.put("weekly", weeklySignal);

            // Convergence score: both timeframes agree = high confidence
            boolean dailyBull = "BUY".equals(dailySignal.action());
            boolean weeklyBull = "BUY".equals(weeklySignal.action());
            boolean dailyBear = "SELL".equals(dailySignal.action());
            boolean weeklyBear = "SELL".equals(weeklySignal.action());

            String convergence;
            double convergenceScore;
            if (dailyBull && weeklyBull) { convergence = "STRONG_BUY"; convergenceScore = 0.9; }
            else if (dailyBear && weeklyBear) { convergence = "STRONG_SELL"; convergenceScore = 0.9; }
            else if (dailyBull && !weeklyBear) { convergence = "MODERATE_BUY"; convergenceScore = 0.65; }
            else if (dailyBear && !weeklyBull) { convergence = "MODERATE_SELL"; convergenceScore = 0.65; }
            else { convergence = "CONFLICTING"; convergenceScore = 0.3; }

            result.put("convergence", convergence);
            result.put("convergenceScore", convergenceScore);
            result.put("recommendation", convergence.contains("BUY")
                ? "Daily and weekly trends align bullish — higher probability setup"
                : convergence.contains("SELL")
                    ? "Daily and weekly trends align bearish — caution"
                    : "Timeframes disagree — wait for alignment or reduce position size");
        } else {
            result.put("weekly", "Insufficient weekly data");
            result.put("convergence", "DAILY_ONLY");
        }

        return ResponseEntity.ok(result);
    }

    // ═══════════════════════════════════════════════════════════════
    // MARKET REGIME (C++ native engine proxy)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Classify market regime (BULL_TREND / BEAR_TREND / RANGING / HIGH_VOL) for a symbol
     * by sending recent closes to the C++ technical-signal-engine. Returns
     * {@code {regime, direction, confidence, snapshot, available: true}} when the engine
     * answers, or {@code {available: false, reason: ...}} when it's offline so the UI can
     * degrade gracefully instead of showing a broken widget.
     */
    @GetMapping("/{symbol}/regime")
    public ResponseEntity<?> regime(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        if (c.size() < 25) {
            return ResponseEntity.ok(Map.of(
                    "available", false,
                    "reason", "need at least 25 candles for regime classification (got " + c.size() + ")"
            ));
        }
        try {
            // Build JSON payload of close prices
            StringBuilder closes = new StringBuilder("[");
            for (int i = 0; i < c.size(); i++) {
                if (i > 0) closes.append(",");
                closes.append(c.get(i).close());
            }
            closes.append("]");
            String body = "{\"closes\":" + closes + "}";

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(cppEngineUrl + "/regime"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(3))
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                return ResponseEntity.ok(Map.of(
                        "available", false,
                        "reason", "cpp-engine returned HTTP " + res.statusCode()
                ));
            }
            JsonNode tree = mapper.readTree(res.body());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("available", true);
            out.put("symbol", symbol.toUpperCase());
            out.put("regime", tree.path("regime").asText("UNKNOWN"));
            out.put("direction", tree.path("direction").asText("UNKNOWN"));
            out.put("confidence", tree.path("confidence").asDouble(0.0));
            out.put("snapshot", mapper.convertValue(tree.path("snapshot"), Map.class));
            out.put("source", "cpp-signal-engine");
            return ResponseEntity.ok(out);
        } catch (java.net.ConnectException ce) {
            return ResponseEntity.ok(Map.of(
                    "available", false,
                    "reason", "cpp-signal-engine offline (start it for regime classification)"
            ));
        } catch (Exception e) {
            log.warn("Regime classification for {} failed: {}", symbol, e.getMessage());
            return ResponseEntity.ok(Map.of(
                    "available", false,
                    "reason", "engine error: " + e.getMessage()
            ));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: PORTFOLIO OPTIMIZATION
    // ═══════════════════════════════════════════════════════════════

    /** Optimize a portfolio of symbols */
    @PostMapping("/portfolio/optimize")
    public ResponseEntity<?> optimizePortfolio(@RequestBody Map<String, Object> body) {
        List<String> symbols = (List<String>) body.getOrDefault("symbols", List.of("AAPL", "MSFT", "GOOGL"));
        Map<String, List<Candle>> data = new LinkedHashMap<>();
        for (String sym : symbols) {
            List<Candle> candles = getCachedCandles(sym.toUpperCase());
            if (!candles.isEmpty()) data.put(sym.toUpperCase(), candles);
        }
        if (data.size() < 2) return ResponseEntity.badRequest().body(Map.of("error", "Need at least 2 symbols with data"));
        return ResponseEntity.ok(portfolioOptimizer.optimize(data));
    }

    // ═══════════════════════════════════════════════════════════════
    // FINANCE: REBALANCING / CAPITAL GAINS / DIVIDENDS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Rebalancing plan. Body:
     *   { "current": {"AAPL": 12000, "VOO": 8000}, "target": {"AAPL": 0.4, "VOO": 0.6},
     *     "cashToAdd": 0, "bandPct": 5 }
     */
    @PostMapping("/portfolio/rebalance")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> rebalance(@RequestBody Map<String, Object> body) {
        Map<String, Double> current = toDoubleMap((Map<String, Object>) body.getOrDefault("current", Map.of()));
        Map<String, Double> target  = toDoubleMap((Map<String, Object>) body.getOrDefault("target", Map.of()));
        if (target.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "target weights required"));
        }
        double cash = dbl(body, "cashToAdd", 0);
        double band = dbl(body, "bandPct", 0);
        return ResponseEntity.ok(financeEngine.rebalance(current, target, cash, band));
    }

    /**
     * Realized capital gains (FIFO). Body:
     *   { "symbol": "AAPL", "sellQty": 50, "salePrice": 190, "saleDate": "2026-01-15",
     *     "lots": [ {"acquired":"2023-02-01","qty":30,"costPerShare":140}, ... ] }
     */
    @PostMapping("/tax/capital-gains")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> capitalGains(@RequestBody Map<String, Object> body) {
        String symbol = String.valueOf(body.getOrDefault("symbol", "UNKNOWN")).toUpperCase();
        double sellQty = dbl(body, "sellQty", 0);
        double salePrice = dbl(body, "salePrice", 0);
        String saleDate = (String) body.get("saleDate");
        List<Map<String, Object>> rawLots = (List<Map<String, Object>>) body.getOrDefault("lots", List.of());
        if (sellQty <= 0 || salePrice <= 0 || rawLots.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "sellQty, salePrice and non-empty lots required"));
        }
        List<FinanceEngine.TaxLot> lots = rawLots.stream().map(l -> new FinanceEngine.TaxLot(
                (String) l.get("acquired"), dbl(l, "qty", 0), dbl(l, "costPerShare", 0))).toList();
        return ResponseEntity.ok(financeEngine.capitalGains(symbol, lots, sellQty, salePrice, saleDate));
    }

    /**
     * Dividend income projection. Body:
     *   { "holdings": [ {"symbol":"VOO","shares":40,"annualDividendPerShare":6.2,"price":510}, ... ] }
     */
    @PostMapping("/dividends/projection")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> dividendProjection(@RequestBody Map<String, Object> body) {
        List<Map<String, Object>> raw = (List<Map<String, Object>>) body.getOrDefault("holdings", List.of());
        if (raw.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "holdings required"));
        }
        List<FinanceEngine.DividendHolding> holdings = raw.stream().map(h -> new FinanceEngine.DividendHolding(
                String.valueOf(h.getOrDefault("symbol", "?")).toUpperCase(),
                dbl(h, "shares", 0), dbl(h, "annualDividendPerShare", 0), dbl(h, "price", 0))).toList();
        return ResponseEntity.ok(financeEngine.dividendProjection(holdings));
    }

    private Map<String, Double> toDoubleMap(Map<String, Object> in) {
        Map<String, Double> out = new LinkedHashMap<>();
        for (var e : in.entrySet()) {
            if (e.getValue() instanceof Number n) out.put(e.getKey().toUpperCase(), n.doubleValue());
        }
        return out;
    }

    // ═══════════════════════════════════════════════════════════════
    // CACHE + FETCH
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    // NEW: OPTIONS PRICING & GREEKS
    // ═══════════════════════════════════════════════════════════════

    /** Price a single option with Black-Scholes */
    @PostMapping("/options/price")
    public ResponseEntity<?> priceOption(@RequestBody Map<String, Object> body) {
        String type = (String) body.getOrDefault("type", "CALL");
        double spot = ((Number) body.getOrDefault("spot", 150)).doubleValue();
        double strike = ((Number) body.getOrDefault("strike", 155)).doubleValue();
        double days = optionDays(body, 30);
        double rate = ((Number) body.getOrDefault("riskFreeRate", 0.05)).doubleValue();
        double vol = ((Number) body.getOrDefault("volatility", 0.3)).doubleValue();
        return ResponseEntity.ok(optionsEngine.price(type, spot, strike, days, vol, rate));
    }

    /** Generate full options chain */
    @GetMapping("/options/chain")
    public ResponseEntity<?> optionsChain(
            @RequestParam double spot,
            @RequestParam(defaultValue = "30") double days,
            @RequestParam(defaultValue = "0.25") double vol,
            @RequestParam(defaultValue = "0.05") double rate,
            @RequestParam(defaultValue = "5") int strikes) {
        double step = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
        double base = Math.round(spot / step) * step;
        List<Map<String, Object>> chain = new ArrayList<>();
        for (int i = -strikes; i <= strikes; i++) {
            double strike = base + i * step;
            var call = optionsEngine.price("CALL", spot, strike, days, vol, rate);
            var put = optionsEngine.price("PUT", spot, strike, days, vol, rate);
            chain.add(Map.of("strike", strike, "call", call, "put", put));
        }
        return ResponseEntity.ok(Map.of("spot", spot, "days", days, "vol", vol, "chain", chain));
    }

    /** Compute implied volatility */
    @PostMapping("/options/iv")
    public ResponseEntity<?> impliedVol(@RequestBody Map<String, Object> body) {
        String type = (String) body.getOrDefault("type", "CALL");
        double spot = dbl(body, "spot", 150);
        double strike = dbl(body, "strike", 150);
        double days = optionDays(body, 30);
        double rate = dbl(body, "rate", 0.05);
        double marketPrice = dbl(body, "marketPrice", 5.0);
        double iv = optionsEngine.impliedVolatility(type, marketPrice, spot, strike, days, rate);
        return ResponseEntity.ok(Map.of("days", days, "impliedVolatility", iv, "ivPercent", Math.round(iv * 10000.0) / 100.0));
    }

    /** Analyze an options strategy payoff */
    @PostMapping("/options/strategy")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> optionsStrategy(@RequestBody Map<String, Object> body) {
        String name = (String) body.getOrDefault("name", "Custom");
        double spot = dbl(body, "spot", 150);
        List<Map<String, Object>> rawLegs = (List<Map<String, Object>>) body.getOrDefault("legs", List.of());
        List<OptionsEngine.StrategyLeg> legs = rawLegs.stream().map(l -> new OptionsEngine.StrategyLeg(
            (String) l.getOrDefault("type", "CALL"),
            dbl(l, "strike", 150), intVal(l, "qty", 1), dbl(l, "premium", 5)
        )).toList();
        return ResponseEntity.ok(optionsEngine.analyzeStrategy(name, spot, legs));
    }

    private double dbl(Map<String, Object> m, String k, double d) {
        Object v = m.get(k); return v instanceof Number n ? n.doubleValue() : d;
    }
    private int intVal(Map<String, Object> m, String k, int d) {
        Object v = m.get(k); return v instanceof Number n ? n.intValue() : d;
    }

    private double optionDays(Map<String, Object> body, double defaultDays) {
        Object daysToExpiry = body.get("daysToExpiry");
        if (daysToExpiry instanceof Number n) return n.doubleValue();
        Object days = body.get("days");
        if (days instanceof Number n) return n.doubleValue();
        return defaultDays;
    }

    // ═══════════════════════════════════════════════════════════════
    // CACHE + FETCH
    // ═══════════════════════════════════════════════════════════════

    private List<Candle> getCachedCandles(String symbol) {
        String key = symbol.toUpperCase();
        CacheEntry entry = candleCache.get(key);
        if (entry != null && (System.currentTimeMillis() - entry.ts) < CACHE_TTL_MS) {
            return entry.candles;
        }
        List<Candle> fresh = fetchCandlesFromUrl(marketDataUrl + "/api/marketdata/candles/" + key);
        if (!fresh.isEmpty()) {
            candleCache.put(key, new CacheEntry(System.currentTimeMillis(), fresh));
        }
        return fresh;
    }

    private List<Candle> fetchCandlesFromUrl(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder().uri(URI.create(url)).GET()
                .timeout(Duration.ofSeconds(10)).build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return Collections.emptyList();
            JsonNode arr = mapper.readTree(res.body()); List<Candle> candles = new ArrayList<>();
            for (JsonNode n : arr) candles.add(new Candle(n.get("date").asText(), n.get("open").asDouble(),
                n.get("high").asDouble(), n.get("low").asDouble(), n.get("close").asDouble(), n.get("volume").asLong()));
            return candles;
        } catch (Exception e) { log.error("Fetch candles failed from {}: {}", url, e.getMessage()); return Collections.emptyList(); }
    }

    private ResponseEntity<?> noData(String sym) {
        return ResponseEntity.ok(Map.of("error", "No data for " + sym + ". POST /api/marketdata/ingest/" + sym + " first"));
    }
}
