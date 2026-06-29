package com.alphatrade.analysis.service;

import com.alphatrade.analysis.model.Candle;
import com.alphatrade.analysis.model.ModelSuggestion;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class ModelInferenceClient {

    private static final Logger log = LoggerFactory.getLogger(ModelInferenceClient.class);

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final String modelUrl;

    public ModelInferenceClient(@Value("${model.inference.url:http://localhost:8090}") String modelUrl) {
        this.modelUrl = modelUrl;
    }

    public Optional<ModelSuggestion> score(String symbol, List<Candle> candles) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("symbol", symbol.toUpperCase());
            payload.put("candles", candles.stream().map(this::toModelCandle).toList());
            String json = mapper.writeValueAsString(payload);

            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(modelUrl + "/score"))
                .timeout(Duration.ofSeconds(8))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.warn("Model service returned {} for {}", response.statusCode(), symbol);
                return Optional.empty();
            }
            return Optional.of(mapper.readValue(response.body(), ModelSuggestion.class));
        } catch (Exception e) {
            log.warn("Model inference failed for {}: {}", symbol, e.getMessage());
            return Optional.empty();
        }
    }

    private Map<String, Object> toModelCandle(Candle candle) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("date", candle.date());
        out.put("open", candle.open());
        out.put("high", candle.high());
        out.put("low", candle.low());
        out.put("close", candle.close());
        out.put("volume", candle.volume());
        return out;
    }
}
