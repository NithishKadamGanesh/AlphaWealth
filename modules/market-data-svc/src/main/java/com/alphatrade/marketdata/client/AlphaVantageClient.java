package com.alphatrade.marketdata.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.*;

@Component
public class AlphaVantageClient {

    private static final Logger log = LoggerFactory.getLogger(AlphaVantageClient.class);
    private static final String BASE_URL = "https://www.alphavantage.co/query";
    private static final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient httpClient;
    private final String apiKey;

    public AlphaVantageClient(@Value("${alphavantage.api-key:demo}") String apiKey) {
        this.apiKey = apiKey;
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
    }

    public List<Map<String, Object>> fetchDailyFull(String symbol) {
        String url = String.format("%s?function=TIME_SERIES_DAILY_ADJUSTED&symbol=%s&outputsize=full&apikey=%s", BASE_URL, symbol, apiKey);
        return fetchTimeSeries(url, "Time Series (Daily)", symbol);
    }

    public List<Map<String, Object>> fetchDailyCompact(String symbol) {
        String url = String.format("%s?function=TIME_SERIES_DAILY_ADJUSTED&symbol=%s&outputsize=compact&apikey=%s", BASE_URL, symbol, apiKey);
        return fetchTimeSeries(url, "Time Series (Daily)", symbol);
    }

    public List<Map<String, Object>> fetchWeekly(String symbol) {
        String url = String.format("%s?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=%s&apikey=%s", BASE_URL, symbol, apiKey);
        return fetchTimeSeries(url, "Weekly Adjusted Time Series", symbol);
    }

    private List<Map<String, Object>> fetchTimeSeries(String url, String seriesKey, String symbol) {
        try {
            log.info("Fetching {} from Alpha Vantage: {}", symbol, seriesKey);
            HttpRequest request = HttpRequest.newBuilder().uri(URI.create(url)).timeout(Duration.ofSeconds(30)).GET().build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) { log.error("Alpha Vantage returned HTTP {}", response.statusCode()); return Collections.emptyList(); }

            JsonNode root = mapper.readTree(response.body());
            if (root.has("Note") || root.has("Information")) {
                log.warn("Alpha Vantage rate limit: {}", root.has("Note") ? root.get("Note").asText() : root.get("Information").asText());
                return Collections.emptyList();
            }
            if (root.has("Error Message")) { log.error("Alpha Vantage error: {}", root.get("Error Message").asText()); return Collections.emptyList(); }

            JsonNode series = root.get(seriesKey);
            if (series == null || !series.isObject()) { log.warn("No '{}' in response for {}", seriesKey, symbol); return Collections.emptyList(); }

            List<Map<String, Object>> candles = new ArrayList<>();
            Iterator<String> dates = series.fieldNames();
            while (dates.hasNext()) {
                String dateStr = dates.next();
                JsonNode bar = series.get(dateStr);
                Map<String, Object> candle = new HashMap<>();
                candle.put("date", LocalDate.parse(dateStr));
                candle.put("open", new BigDecimal(bar.get("1. open").asText()));
                candle.put("high", new BigDecimal(bar.get("2. high").asText()));
                candle.put("low", new BigDecimal(bar.get("3. low").asText()));
                candle.put("close", new BigDecimal(bar.get("4. close").asText()));
                String adjKey = bar.has("5. adjusted close") ? "5. adjusted close" : "4. close";
                candle.put("adjClose", new BigDecimal(bar.get(adjKey).asText()));
                String volKey = bar.has("6. volume") ? "6. volume" : "5. volume";
                candle.put("volume", bar.get(volKey).asLong());
                candles.add(candle);
            }
            candles.sort(Comparator.comparing(c -> (LocalDate) c.get("date")));
            log.info("Fetched {} candles for {}", candles.size(), symbol);
            return candles;
        } catch (Exception e) {
            log.error("Failed to fetch {} from Alpha Vantage: {}", symbol, e.getMessage());
            return Collections.emptyList();
        }
    }
}
