package com.alphatrade.analysis.alert;

import com.alphatrade.analysis.indicator.IndicatorEngine;
import com.alphatrade.analysis.model.Candle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Alert engine. Monitors indicator thresholds and price levels,
 * fires alerts when conditions are met. Supports:
 *   - RSI overbought/oversold
 *   - MACD crossovers
 *   - Bollinger Band breakouts
 *   - Custom threshold alerts
 *   - Webhook delivery (Discord, Slack, generic URL)
 */
@Component
public class AlertEngine {

    private static final Logger log = LoggerFactory.getLogger(AlertEngine.class);
    private static final long DEDUP_WINDOW_SECONDS = 300;

    public record Alert(String id, String symbol, String type, String message,
                        String severity, double price, Instant ts, Map<String, Object> context) {}

    public record AlertRule(String id, String symbol, String condition, double threshold,
                            boolean enabled, String webhookUrl) {}

    private final IndicatorEngine indicators;
    private final Map<String, AlertRule> rules = new ConcurrentHashMap<>();
    private final List<Alert> recentAlerts = Collections.synchronizedList(new ArrayList<>());
    private final Map<String, Instant> firedAlerts = new ConcurrentHashMap<>();

    public AlertEngine(IndicatorEngine indicators) {
        this.indicators = indicators;
    }

    /** Scan candles and fire alerts for any triggered rules. */
    public List<Alert> scan(String symbol, List<Candle> candles) {
        if (candles.size() < 30) {
            return Collections.emptyList();
        }

        List<Alert> fired = new ArrayList<>();
        int last = candles.size() - 1;
        double price = candles.get(last).close();

        double[] rsi = indicators.rsi(candles, 14);
        Map<String, double[]> macd = indicators.macd(candles);
        Map<String, double[]> boll = indicators.bollinger(candles);

        double rsiNow = safe(rsi, last);
        double rsiPrev = safe(rsi, last - 1);
        double macdHist = safe(macd.get("histogram"), last);
        double macdHistPrev = safe(macd.get("histogram"), last - 1);
        double bollUpper = safe(boll.get("upper"), last);
        double bollLower = safe(boll.get("lower"), last);

        if (rsiPrev >= 30 && rsiNow < 30) {
            fired.add(alert(symbol, "RSI_OVERSOLD", "RSI dropped below 30 (%.1f)".formatted(rsiNow), "HIGH", price, Map.of("rsi", rsiNow)));
        }
        if (rsiPrev <= 70 && rsiNow > 70) {
            fired.add(alert(symbol, "RSI_OVERBOUGHT", "RSI rose above 70 (%.1f)".formatted(rsiNow), "HIGH", price, Map.of("rsi", rsiNow)));
        }

        if (!Double.isNaN(macdHist) && !Double.isNaN(macdHistPrev)) {
            if (macdHistPrev <= 0 && macdHist > 0) {
                fired.add(alert(symbol, "MACD_BULL_CROSS", "MACD bullish crossover", "MEDIUM", price, Map.of("histogram", macdHist)));
            }
            if (macdHistPrev >= 0 && macdHist < 0) {
                fired.add(alert(symbol, "MACD_BEAR_CROSS", "MACD bearish crossover", "MEDIUM", price, Map.of("histogram", macdHist)));
            }
        }

        if (price < bollLower && !Double.isNaN(bollLower)) {
            fired.add(alert(symbol, "BOLL_LOWER_BREAK", "Price broke below lower Bollinger Band (%.2f)".formatted(bollLower), "HIGH", price, Map.of("lowerBand", bollLower)));
        }
        if (price > bollUpper && !Double.isNaN(bollUpper)) {
            fired.add(alert(symbol, "BOLL_UPPER_BREAK", "Price broke above upper Bollinger Band (%.2f)".formatted(bollUpper), "HIGH", price, Map.of("upperBand", bollUpper)));
        }

        for (AlertRule rule : rules.values()) {
            if (!rule.enabled() || !rule.symbol().equals(symbol)) {
                continue;
            }
            if (evaluateRule(rule, price, rsiNow, macdHist)) {
                fired.add(alert(symbol, "CUSTOM_" + rule.condition().toUpperCase(),
                    "Custom alert: " + rule.condition() + " threshold " + rule.threshold(),
                    "MEDIUM", price, Map.of("rule", rule.id())));
                if (rule.webhookUrl() != null && !rule.webhookUrl().isBlank()) {
                    fireWebhook(rule.webhookUrl(), symbol, rule.condition(), price);
                }
            }
        }

        List<Alert> deduped = new ArrayList<>();
        Instant now = Instant.now();
        for (Alert alert : fired) {
            String key = alert.symbol() + "|" + alert.type();
            Instant lastFired = firedAlerts.get(key);
            if (lastFired == null || lastFired.isBefore(now.minusSeconds(DEDUP_WINDOW_SECONDS))) {
                firedAlerts.put(key, now);
                deduped.add(alert);
                recentAlerts.add(alert);
                log.info("ALERT: [{}] {} - {} @ {}", alert.severity(), alert.symbol(), alert.message(), alert.price());
            }
        }

        if (recentAlerts.size() > 500) {
            recentAlerts.subList(0, recentAlerts.size() - 500).clear();
        }

        return deduped;
    }

    /** Add or update an alert rule. */
    public void addRule(AlertRule rule) {
        rules.put(rule.id(), rule);
        log.info("Alert rule added: {} for {} condition={} threshold={}", rule.id(), rule.symbol(), rule.condition(), rule.threshold());
    }

    public void removeRule(String ruleId) {
        rules.remove(ruleId);
    }

    public List<AlertRule> getRules() {
        return new ArrayList<>(rules.values());
    }

    public List<Alert> getRecentAlerts(int limit) {
        int start = Math.max(0, recentAlerts.size() - limit);
        return new ArrayList<>(recentAlerts.subList(start, recentAlerts.size()));
    }

    /** Clear dedup cache (allows re-firing of alerts). */
    public void clearDedupCache() {
        firedAlerts.clear();
    }

    @Scheduled(fixedDelayString = "${alerts.dedup-cleanup-ms:300000}", initialDelayString = "${alerts.dedup-cleanup-initial-ms:60000}")
    public void cleanupDedupCache() {
        Instant cutoff = Instant.now().minus(DEDUP_WINDOW_SECONDS, ChronoUnit.SECONDS);
        firedAlerts.entrySet().removeIf(entry -> entry.getValue().isBefore(cutoff));
    }

    private boolean evaluateRule(AlertRule rule, double price, double rsi, double macdHist) {
        return switch (rule.condition().toLowerCase()) {
            case "price_above" -> price > rule.threshold();
            case "price_below" -> price < rule.threshold();
            case "rsi_above" -> rsi > rule.threshold();
            case "rsi_below" -> rsi < rule.threshold();
            case "macd_positive" -> macdHist > rule.threshold();
            case "macd_negative" -> macdHist < -rule.threshold();
            default -> false;
        };
    }

    private void fireWebhook(String url, String symbol, String condition, double price) {
        try {
            String payload = """
                {"content":"AlphaTrade Alert - %s: %s @ $%.2f"}
                """.formatted(symbol, condition, price);

            java.net.http.HttpClient.newHttpClient().sendAsync(
                java.net.http.HttpRequest.newBuilder()
                    .uri(java.net.URI.create(url))
                    .header("Content-Type", "application/json")
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString(payload))
                    .build(),
                java.net.http.HttpResponse.BodyHandlers.discarding()
            ).thenAccept(response -> log.debug("Webhook sent to {}: status {}", url, response.statusCode()));
        } catch (Exception e) {
            log.warn("Webhook failed for {}: {}", url, e.getMessage());
        }
    }

    private Alert alert(String symbol, String type, String message, String severity, double price, Map<String, Object> context) {
        return new Alert(UUID.randomUUID().toString().substring(0, 8), symbol, type, message, severity, price, Instant.now(), context);
    }

    private double safe(double[] values, int idx) {
        return values != null && idx >= 0 && idx < values.length ? values[idx] : Double.NaN;
    }
}
