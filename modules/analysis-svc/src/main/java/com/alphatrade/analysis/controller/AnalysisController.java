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
        Map<String, Object> nativeIndicators = fetchNativeIndicators(symbol.toUpperCase(), c);
        if (nativeIndicators != null) return ResponseEntity.ok(nativeIndicators);
        Map<String, Object> fallback = new LinkedHashMap<>(indicatorEngine.computeAll(c));
        fallback.put("source", "java-analysis-svc");
        return ResponseEntity.ok(fallback);
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
        Map<String, Object> nativeSignal = fetchNativeSignal(symbol.toUpperCase(), c);
        if (nativeSignal != null) return ResponseEntity.ok(nativeSignal);
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
        r.put("nativeSignal", fetchNativeSignal(sym, c));
        r.put("lorentzian", fetchLorentzian(sym, c));
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
        Map<String, Object> nativeRisk = fetchNativePortfolioRisk(data);
        if (nativeRisk != null) return ResponseEntity.ok(nativeRisk);
        return ResponseEntity.ok(portfolioOptimizer.optimize(data));
    }

    /** Native C++ portfolio risk endpoint. Body: { "symbols":["AAPL","MSFT"], "weights":{"AAPL":0.5,"MSFT":0.5} } */
    @PostMapping("/portfolio/risk-native")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> nativePortfolioRisk(@RequestBody Map<String, Object> body) {
        List<String> symbols = (List<String>) body.getOrDefault("symbols", List.of("AAPL", "MSFT", "GOOGL"));
        Map<String, Object> weights = (Map<String, Object>) body.getOrDefault("weights", Map.of());
        Map<String, List<Candle>> data = new LinkedHashMap<>();
        for (String sym : symbols) {
            List<Candle> candles = getCachedCandles(sym.toUpperCase());
            if (!candles.isEmpty()) data.put(sym.toUpperCase(), candles);
        }
        if (data.size() < 2) return ResponseEntity.badRequest().body(Map.of("error", "Need at least 2 symbols with data"));
        Map<String, Object> nativeRisk = fetchNativePortfolioRisk(data, weights);
        return nativeRisk != null
            ? ResponseEntity.ok(nativeRisk)
            : ResponseEntity.status(503).body(Map.of("error", "cpp-signal-engine unavailable"));
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
        Map<String, Object> nativePrice = cppPostMap("/options/price", Map.of(
            "type", type, "spot", spot, "strike", strike, "days", days, "rate", rate, "volatility", vol
        ), 3);
        if (nativePrice != null) return ResponseEntity.ok(nativePrice);
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

    /**
     * Aggregated research brief for a symbol.
     * Combines signal, patterns, levels, seasonality, multi-timeframe, and regime into one response.
     * Frontend uses this to populate the Stock Research Brief view.
     */
    @GetMapping("/research-brief/{symbol}")
    public ResponseEntity<?> researchBrief(@PathVariable String symbol) {
        try {
            String sym = symbol.toUpperCase();
            List<Candle> candles = getCachedCandles(sym);
            if (candles.isEmpty()) return noData(sym);

            // Gather all evidence concurrently (best-effort: fail fast per module)
            Map<String, Object> brief = new java.util.LinkedHashMap<>();
            brief.put("symbol", sym);
            brief.put("generatedAt", Instant.now().toString());

            try {
                Map<String, Object> nativeSignal = fetchNativeSignal(sym, candles);
                brief.put("signal", nativeSignal != null ? nativeSignal : signalGenerator.generate(sym, candles));
                brief.put("nativeSignal", nativeSignal);
            } catch (Exception e) { brief.put("signal", null); }
            try { brief.put("lorentzian", fetchLorentzian(sym, candles));                  } catch (Exception e) { brief.put("lorentzian", null); }
            try { brief.put("patterns",    patternDetector.detectAll(candles));             } catch (Exception e) { brief.put("patterns", List.of()); }
            try { brief.put("levels",      srDetector.detect(candles));                     } catch (Exception e) { brief.put("levels", Map.of()); }
            try { brief.put("seasonality", seasonalityEngine.analyze(candles));             } catch (Exception e) { brief.put("seasonality", Map.of()); }

            // Multi-timeframe (weekly)
            try {
                List<Candle> weekly = fetchCandlesFromUrl(marketDataUrl + "/api/marketdata/candles/" + sym + "/weekly");
                if (weekly != null && !weekly.isEmpty()) {
                    brief.put("weeklySignal", signalGenerator.generate(sym, weekly));
                }
            } catch (Exception e) { brief.put("weeklySignal", null); }

            // Regime via C++ proxy
            try {
                Map<String, Object> regimeDetail = fetchRegimeDetail(candles);
                brief.put("regimeDetail", regimeDetail);
                brief.put("regime", regimeDetail != null ? regimeDetail.get("regime") : null);
            } catch (Exception e) { brief.put("regime", null); }

            // Verdict based on aggregated signals
            brief.put("verdict", deriveVerdict(brief));

            return ResponseEntity.ok(brief);
        } catch (Exception e) {
            log.error("research-brief failed for {}: {}", symbol, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage(), "symbol", symbol));
        }
    }

    private String deriveVerdict(Map<String, Object> brief) {
        Object signalObj = brief.get("signal");
        String bias = "NEUTRAL";
        double conf = 50.0;

        if (signalObj instanceof SignalGenerator.TradeSignal sig) {
            bias = String.valueOf(sig.action()).toUpperCase();
            conf = sig.confidence() <= 1 ? sig.confidence() * 100 : sig.confidence();
        } else if (signalObj instanceof Map<?, ?> sig) {
            Object biasObj = sig.get("bias");
            if (biasObj == null) biasObj = sig.get("direction");
            if (biasObj == null) biasObj = sig.get("action");
            bias = biasObj != null ? biasObj.toString().toUpperCase() : "NEUTRAL";
            Object confObj = sig.get("confidence");
            conf = confObj instanceof Number n ? n.doubleValue() : 50.0;
            if (conf <= 1) conf *= 100;
        } else {
            return "Wait";
        }

        boolean bullish = bias.contains("BULL") || bias.equals("BUY") || bias.equals("STRONG_BUY");
        boolean bearish = bias.contains("BEAR") || bias.equals("SELL") || bias.equals("STRONG_SELL");
        if (bullish && conf >= 70) return "Strong Watch";
        if (bullish && conf >= 50) return "Possible Entry";
        if (bearish) return "Avoid";
        return "Wait";
    }

    private String fetchRegime(List<Candle> candles) {
        Map<String, Object> detail = fetchRegimeDetail(candles);
        return detail != null ? String.valueOf(detail.get("regime")) : null;
    }

    private Map<String, Object> fetchRegimeDetail(List<Candle> candles) {
        if (candles.size() < 25) return null;
        return cppPostMap("/regime", Map.of("closes", closes(candles)), 3);
    }

    private Map<String, Object> fetchNativeIndicators(String symbol, List<Candle> candles) {
        Map<String, Object> out = cppPostMap("/indicators", candlePayload(symbol, candles), 3);
        if (out == null) return null;
        out.put("symbol", symbol.toUpperCase());
        out.put("source", "cpp-signal-engine");
        out.put("rsi", out.get("rsi_14"));
        out.put("macdSummary", Map.of(
            "macd", out.getOrDefault("macd", 0),
            "signal", out.getOrDefault("macd_signal", 0),
            "histogram", out.getOrDefault("macd_histogram", 0)
        ));
        return out;
    }

    private Map<String, Object> fetchNativeSignal(String symbol, List<Candle> candles) {
        Map<String, Object> out = cppPostMap("/signals/compute", candlePayload(symbol, candles), 4);
        if (out == null) return null;
        out.put("source", "cpp-signal-engine");
        return out;
    }

    private Map<String, Object> fetchLorentzian(String symbol, List<Candle> candles) {
        Map<String, Object> payload = candlePayload(symbol, candles);
        payload.put("k", 8);
        payload.put("horizon", 4);
        Map<String, Object> out = cppPostMap("/classifiers/lorentzian", payload, 5);
        if (out == null) return null;
        out.put("source", "cpp-signal-engine");
        return out;
    }

    private Map<String, Object> fetchNativePortfolioRisk(Map<String, List<Candle>> data) {
        return fetchNativePortfolioRisk(data, Map.of());
    }

    private Map<String, Object> fetchNativePortfolioRisk(Map<String, List<Candle>> data, Map<String, Object> weights) {
        List<Map<String, Object>> assets = new ArrayList<>();
        for (var e : data.entrySet()) {
            Map<String, Object> asset = new LinkedHashMap<>();
            asset.put("symbol", e.getKey().toUpperCase());
            asset.put("closes", closes(e.getValue()));
            Object w = weights.get(e.getKey());
            if (w instanceof Number n) asset.put("weight", n.doubleValue());
            assets.add(asset);
        }
        Map<String, Object> nativeRisk = cppPostMap("/risk/portfolio", Map.of("assets", assets), 8);
        if (nativeRisk == null) return null;
        nativeRisk.put("source", "cpp-signal-engine");

        Object nativeAssets = nativeRisk.get("assets");
        if (nativeAssets instanceof List<?> list) {
            List<Map<String, Object>> uiWeights = new ArrayList<>();
            for (Object item : list) {
                if (!(item instanceof Map<?, ?> a)) continue;
                Map<String, Object> row = new LinkedHashMap<>();
                Object symbolObj = a.get("symbol");
                Object suggestedWeight = a.get("suggestedWeight") != null ? a.get("suggestedWeight") : a.get("weight");
                row.put("symbol", symbolObj == null ? "?" : String.valueOf(symbolObj));
                row.put("weight", asDouble(suggestedWeight));
                row.put("expectedReturn", asDouble(a.get("expectedReturn")));
                row.put("volatility", asDouble(a.get("volatility")));
                row.put("riskContribution", asDouble(a.get("riskContribution")));
                uiWeights.add(row);
            }
            nativeRisk.put("weights", uiWeights);
            nativeRisk.put("nativeAssets", nativeAssets);
        }
        return nativeRisk;
    }

    private Map<String, Object> cppPostMap(String path, Map<String, Object> payload, int timeoutSeconds) {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(cppEngineUrl + path))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
                .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                return mapper.convertValue(mapper.readTree(resp.body()), Map.class);
            }
        } catch (Exception e) {
            log.debug("C++ POST {} failed: {}", path, e.getMessage());
        }
        return null;
    }

    private Map<String, Object> candlePayload(String symbol, List<Candle> candles) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("symbol", symbol.toUpperCase());
        payload.put("dates", candles.stream().map(Candle::date).toList());
        payload.put("opens", candles.stream().map(Candle::open).toList());
        payload.put("highs", candles.stream().map(Candle::high).toList());
        payload.put("lows", candles.stream().map(Candle::low).toList());
        payload.put("closes", closes(candles));
        payload.put("volumes", candles.stream().map(c -> (double) c.volume()).toList());
        return payload;
    }

    private List<Double> closes(List<Candle> candles) {
        return candles.stream().map(Candle::close).toList();
    }

    private List<String> symbolsFrom(Object raw) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (raw instanceof List<?> list) {
            for (Object item : list) addSymbol(out, item);
        } else if (raw instanceof String s) {
            for (String item : s.split("[,\\s]+")) addSymbol(out, item);
        } else {
            addSymbol(out, raw);
        }
        return out.stream().limit(100).toList();
    }

    private void addSymbol(Set<String> symbols, Object raw) {
        String sym = String.valueOf(raw == null ? "" : raw).trim().toUpperCase();
        if (sym.matches("[A-Z0-9.\\-]{1,10}")) symbols.add(sym);
    }

    private double asDouble(Object value) {
        return value instanceof Number n ? n.doubleValue() : 0.0;
    }

    /**
     * Generate actionable options trade ideas for a symbol.
     * Uses Black-Scholes pricing with heuristic liquidity scoring.
     * Real option chain integration can replace this when a market data subscription is available.
     */
    @GetMapping("/options/ideas/{symbol}")
    public ResponseEntity<?> optionsIdeas(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "150") double spot,
            @RequestParam(defaultValue = "0.3")  double vol,
            @RequestParam(defaultValue = "0.05") double rate,
            @RequestParam(defaultValue = "35")   double dte) {

        Map<String, Object> nativeIdeas = cppPostMap("/options/strategies", Map.of(
            "symbol", symbol.toUpperCase(), "spot", spot, "volatility", vol, "rate", rate, "dte", dte
        ), 3);
        if (nativeIdeas != null && nativeIdeas.get("ideas") instanceof List<?> ideas && !ideas.isEmpty()) {
            return ResponseEntity.ok(ideas);
        }

        double step = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
        double atm  = Math.round(spot / step) * step;

        // Liquidity heuristic: higher-priced, liquid names score higher
        double liqBase = spot > 100 ? 8.0 : spot > 30 ? 6.0 : 4.0;

        List<Map<String, Object>> ideas = new ArrayList<>();

        // 1. Long call (directional, 0.40 delta target)
        double callStrike = atm + step;
        var call = optionsEngine.price("CALL", spot, callStrike, dte, vol, rate);
        double callPrem = extractPrice(call);
        if (callPrem > 0.5) {
            ideas.add(Map.of(
                "structure",     "Long Call",
                "direction",     "Bullish",
                "legs",          symbol + " $" + fmt(callStrike) + "C exp ~" + (int) dte + "d",
                "dte",           (int) dte,
                "maxLoss",       fmt(callPrem * 100),
                "maxProfit",     "Unlimited",
                "breakeven",     fmt(callStrike + callPrem),
                "liquidityScore", fmt1(liqBase),
                "rationale",     "Defined-risk bullish play. Profits if " + symbol + " rises above $" + fmt(callStrike + callPrem) + " at expiry.",
                "invalidation",  "Close below $" + fmt(callStrike - spot * 0.05) + " or implied vol collapse before expiry."
            ));
        }

        // 2. Call debit spread (directional, capped risk/reward)
        double longCallK  = atm + step;
        double shortCallK = atm + step * 4;
        var longCall  = optionsEngine.price("CALL", spot, longCallK,  dte, vol, rate);
        var shortCall = optionsEngine.price("CALL", spot, shortCallK, dte, vol, rate);
        double netDebit = extractPrice(longCall) - extractPrice(shortCall);
        double maxProfit = (shortCallK - longCallK) - netDebit;
        if (netDebit > 0.3 && maxProfit > netDebit) {
            ideas.add(Map.of(
                "structure",     "Call Debit Spread",
                "direction",     "Bullish",
                "legs",          "Buy $" + fmt(longCallK) + "C / Sell $" + fmt(shortCallK) + "C exp ~" + (int) dte + "d",
                "dte",           (int) dte,
                "maxLoss",       fmt(netDebit * 100),
                "maxProfit",     fmt(maxProfit * 100),
                "breakeven",     fmt(longCallK + netDebit),
                "liquidityScore", fmt1(liqBase + 0.5),
                "rationale",     "Controlled cost bullish play. Risk-reward " + fmt1(maxProfit / netDebit) + ":1. Max profit above $" + fmt(shortCallK) + ".",
                "invalidation",  "Close below $" + fmt(longCallK - step) + " or time decay erodes position before move materialises."
            ));
        }

        // 3. Covered call (income on existing shares)
        double ccStrike = atm + step * 2;
        var ccCall = optionsEngine.price("CALL", spot, ccStrike, dte, vol, rate);
        double ccPrem = extractPrice(ccCall);
        if (ccPrem > 0.3) {
            ideas.add(Map.of(
                "structure",     "Covered Call",
                "direction",     "Neutral/Income",
                "legs",          "Sell $" + fmt(ccStrike) + "C exp ~" + (int) dte + "d (requires 100 shares)",
                "dte",           (int) dte,
                "maxLoss",       "Cost basis of shares minus premium",
                "maxProfit",     fmt(ccPrem * 100),
                "breakeven",     fmt(spot - ccPrem),
                "liquidityScore", fmt1(liqBase),
                "rationale",     "Collect $" + fmt(ccPrem * 100) + " premium. Shares called away above $" + fmt(ccStrike) + ". Fits flat-to-slightly-bullish outlook.",
                "invalidation",  "Sharp move above $" + fmt(ccStrike) + " before expiry — caps upside. Consider rolling if stock approaches strike."
            ));
        }

        // 4. Cash-secured put (income/acquisition)
        double cspStrike = atm - step * 2;
        var cspPut = optionsEngine.price("PUT", spot, cspStrike, dte, vol, rate);
        double cspPrem = extractPrice(cspPut);
        if (cspPrem > 0.2) {
            ideas.add(Map.of(
                "structure",     "Cash-Secured Put",
                "direction",     "Neutral/Acquisition",
                "legs",          "Sell $" + fmt(cspStrike) + "P exp ~" + (int) dte + "d (requires $" + fmt(cspStrike * 100) + " cash)",
                "dte",           (int) dte,
                "maxLoss",       fmt((cspStrike - cspPrem) * 100),
                "maxProfit",     fmt(cspPrem * 100),
                "breakeven",     fmt(cspStrike - cspPrem),
                "liquidityScore", fmt1(liqBase),
                "rationale",     "Collect $" + fmt(cspPrem * 100) + " premium. Acquire shares at $" + fmt(cspStrike) + " effective cost if assigned.",
                "invalidation",  "Earnings or news event causes a gap below $" + fmt(cspStrike - cspPrem) + ". Avoid if catalyst is within DTE window."
            ));
        }

        // 5. Put debit spread (bearish, defined risk)
        double longPutK  = atm - step;
        double shortPutK = atm - step * 4;
        var longPut  = optionsEngine.price("PUT", spot, longPutK,  dte, vol, rate);
        var shortPut = optionsEngine.price("PUT", spot, shortPutK, dte, vol, rate);
        double putDebit = extractPrice(longPut) - extractPrice(shortPut);
        double putMaxProfit = (longPutK - shortPutK) - putDebit;
        if (putDebit > 0.2 && putMaxProfit > putDebit) {
            ideas.add(Map.of(
                "structure",     "Put Debit Spread",
                "direction",     "Bearish",
                "legs",          "Buy $" + fmt(longPutK) + "P / Sell $" + fmt(shortPutK) + "P exp ~" + (int) dte + "d",
                "dte",           (int) dte,
                "maxLoss",       fmt(putDebit * 100),
                "maxProfit",     fmt(putMaxProfit * 100),
                "breakeven",     fmt(longPutK - putDebit),
                "liquidityScore", fmt1(liqBase + 0.5),
                "rationale",     "Defined-risk bearish hedge. Risk-reward " + fmt1(putMaxProfit / putDebit) + ":1."
            ));
        }

        if (ideas.isEmpty()) {
            return ResponseEntity.ok(Map.of("ideas", List.of(), "message", "No high-quality ideas at current vol/price parameters."));
        }
        return ResponseEntity.ok(ideas);
    }

    private double extractPrice(Object priced) {
        if (priced instanceof OptionsEngine.OptionPrice p) {
            return p.price();
        }
        if (priced instanceof Map<?, ?> m) {
            Object p = m.get("price"); if (p instanceof Number n) return n.doubleValue();
            Object v = m.get("value"); if (v instanceof Number n) return n.doubleValue();
        }
        return 0;
    }

    private String fmt(double v)  { return String.format("%.2f", v); }
    private String fmt1(double v) { return String.format("%.1f", v); }

    /** Compute implied volatility */
    @PostMapping("/options/iv")
    public ResponseEntity<?> impliedVol(@RequestBody Map<String, Object> body) {
        String type = (String) body.getOrDefault("type", "CALL");
        double spot = dbl(body, "spot", 150);
        double strike = dbl(body, "strike", 150);
        double days = optionDays(body, 30);
        double rate = dbl(body, "rate", 0.05);
        double marketPrice = dbl(body, "marketPrice", 5.0);
        Map<String, Object> nativeIv = cppPostMap("/options/iv", Map.of(
            "type", type, "spot", spot, "strike", strike, "days", days, "rate", rate, "marketPrice", marketPrice
        ), 3);
        if (nativeIv != null) return ResponseEntity.ok(nativeIv);
        double iv = optionsEngine.impliedVolatility(type, marketPrice, spot, strike, days, rate);
        return ResponseEntity.ok(Map.of("days", days, "impliedVolatility", iv, "ivPercent", Math.round(iv * 10000.0) / 100.0));
    }

    /** Native Lorentzian classification for a symbol. */
    @GetMapping("/{symbol}/lorentzian")
    public ResponseEntity<?> lorentzian(@PathVariable String symbol) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        Map<String, Object> nativeLorentzian = fetchLorentzian(symbol.toUpperCase(), c);
        return nativeLorentzian != null
            ? ResponseEntity.ok(nativeLorentzian)
            : ResponseEntity.status(503).body(Map.of("error", "cpp-signal-engine unavailable"));
    }

    /** Native C++ scanner for a watchlist. Body: { "symbols":["AAPL","NVDA"] } */
    @PostMapping("/opportunities/native-scan")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> nativeOpportunityScan(@RequestBody Map<String, Object> body) {
        List<String> symbols = symbolsFrom(body.getOrDefault("symbols", List.of("AAPL", "MSFT", "NVDA", "AMZN", "TSLA")));
        List<Map<String, Object>> items = new ArrayList<>();
        for (String sym : symbols) {
            List<Candle> candles = getCachedCandles(sym);
            if (!candles.isEmpty()) items.add(candlePayload(sym, candles));
        }
        if (items.isEmpty()) return ResponseEntity.badRequest().body(Map.of("error", "No symbols had candle data"));
        Map<String, Object> nativeScan = cppPostMap("/scan/batch", Map.of("items", items), 15);
        return nativeScan != null
            ? ResponseEntity.ok(nativeScan)
            : ResponseEntity.status(503).body(Map.of("error", "cpp-signal-engine unavailable"));
    }

    /** Native C++ backtest. */
    @GetMapping("/{symbol}/backtest/native")
    public ResponseEntity<?> nativeBacktest(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "LORENTZIAN") String strategy,
            @RequestParam(defaultValue = "10000") double capital,
            @RequestParam(defaultValue = "0.95") double positionPct,
            @RequestParam(defaultValue = "1.0") double commission,
            @RequestParam(defaultValue = "5.0") double slippageBps) {
        List<Candle> c = getCachedCandles(symbol);
        if (c.isEmpty()) return noData(symbol);
        Map<String, Object> payload = candlePayload(symbol.toUpperCase(), c);
        payload.put("strategy", strategy);
        payload.put("capital", capital);
        payload.put("positionPct", positionPct);
        payload.put("commission", commission);
        payload.put("slippageBps", slippageBps);
        Map<String, Object> nativeBacktest = cppPostMap("/backtest", payload, 10);
        return nativeBacktest != null
            ? ResponseEntity.ok(nativeBacktest)
            : ResponseEntity.status(503).body(Map.of("error", "cpp-signal-engine unavailable"));
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
