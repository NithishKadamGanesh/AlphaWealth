package com.alphatrade.marketdata.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * Binance public API client for crypto market data.
 * No API key required for public endpoints.
 *
 * Endpoints:
 *   GET /api/v3/klines - historical OHLCV candles
 *   GET /api/v3/ticker/24hr - 24h ticker stats
 */
@Component
public class CryptoClient {

    private static final Logger log = LoggerFactory.getLogger(CryptoClient.class);
    private static final String BASE_URL = "https://api.binance.com";
    private static final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient httpClient;

    public static final Map<String, String> CRYPTO_SYMBOLS = Map.of(
        "BTC", "BTCUSDT", "ETH", "ETHUSDT", "SOL", "SOLUSDT",
        "BNB", "BNBUSDT", "ADA", "ADAUSDT", "DOGE", "DOGEUSDT",
        "XRP", "XRPUSDT", "DOT", "DOTUSDT"
    );

    public CryptoClient() {
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    /**
     * Fetch daily OHLCV candles from Binance.
     * @param symbol Internal symbol (e.g. "BTC")
     * @param days Number of days of history (max 1000)
     */
    public List<Map<String, Object>> fetchDaily(String symbol, int days) {
        String pair = CRYPTO_SYMBOLS.getOrDefault(symbol.toUpperCase(), symbol.toUpperCase() + "USDT");
        String url = String.format("%s/api/v3/klines?symbol=%s&interval=1d&limit=%d", BASE_URL, pair, Math.min(days, 1000));
        return fetchKlines(url, symbol);
    }

    /** Fetch full available daily history (1000 days) */
    public List<Map<String, Object>> fetchDailyFull(String symbol) {
        return fetchDaily(symbol, 1000);
    }

    /** Fetch hourly candles for intraday analysis */
    public List<Map<String, Object>> fetchHourly(String symbol, int hours) {
        String pair = CRYPTO_SYMBOLS.getOrDefault(symbol.toUpperCase(), symbol.toUpperCase() + "USDT");
        String url = String.format("%s/api/v3/klines?symbol=%s&interval=1h&limit=%d", BASE_URL, pair, Math.min(hours, 1000));
        return fetchKlines(url, symbol);
    }

    /** Get 24h ticker for a crypto symbol */
    public Map<String, Object> get24hTicker(String symbol) {
        String pair = CRYPTO_SYMBOLS.getOrDefault(symbol.toUpperCase(), symbol.toUpperCase() + "USDT");
        try {
            String url = BASE_URL + "/api/v3/ticker/24hr?symbol=" + pair;
            HttpRequest req = HttpRequest.newBuilder().uri(URI.create(url))
                .timeout(Duration.ofSeconds(10)).GET().build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return Map.of();
            JsonNode n = mapper.readTree(res.body());
            return Map.of(
                "symbol", symbol, "pair", pair,
                "last", n.get("lastPrice").asDouble(),
                "bid", n.get("bidPrice").asDouble(),
                "ask", n.get("askPrice").asDouble(),
                "high24h", n.get("highPrice").asDouble(),
                "low24h", n.get("lowPrice").asDouble(),
                "volume24h", n.get("volume").asDouble(),
                "change24h", n.get("priceChange").asDouble(),
                "changePct24h", n.get("priceChangePercent").asDouble()
            );
        } catch (Exception e) {
            log.error("Failed to fetch 24h ticker for {}: {}", symbol, e.getMessage());
            return Map.of();
        }
    }

    private List<Map<String, Object>> fetchKlines(String url, String symbol) {
        try {
            log.info("Fetching crypto candles for {} from Binance", symbol);
            HttpRequest req = HttpRequest.newBuilder().uri(URI.create(url))
                .timeout(Duration.ofSeconds(15)).GET().build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                log.error("Binance returned HTTP {} for {}", res.statusCode(), symbol);
                return Collections.emptyList();
            }

            JsonNode arr = mapper.readTree(res.body());
            List<Map<String, Object>> candles = new ArrayList<>();
            for (JsonNode k : arr) {
                // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
                long openTimeMs = k.get(0).asLong();
                LocalDate date = Instant.ofEpochMilli(openTimeMs).atZone(ZoneId.of("UTC")).toLocalDate();
                candles.add(Map.of(
                    "date", date,
                    "open", new BigDecimal(k.get(1).asText()),
                    "high", new BigDecimal(k.get(2).asText()),
                    "low", new BigDecimal(k.get(3).asText()),
                    "close", new BigDecimal(k.get(4).asText()),
                    "adjClose", new BigDecimal(k.get(4).asText()),
                    "volume", (long) Double.parseDouble(k.get(5).asText())
                ));
            }
            log.info("Fetched {} crypto candles for {}", candles.size(), symbol);
            return candles;
        } catch (Exception e) {
            log.error("Failed to fetch crypto data for {}: {}", symbol, e.getMessage());
            return Collections.emptyList();
        }
    }

    /** Check if a symbol is a known crypto symbol */
    public static boolean isCrypto(String symbol) {
        return CRYPTO_SYMBOLS.containsKey(symbol.toUpperCase());
    }
}
