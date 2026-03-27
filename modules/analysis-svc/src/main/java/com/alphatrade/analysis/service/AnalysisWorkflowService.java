package com.alphatrade.analysis.service;

import com.alphatrade.analysis.model.AnalysisBundle;
import com.alphatrade.analysis.model.BlendedSuggestion;
import com.alphatrade.analysis.model.Candle;
import com.alphatrade.analysis.model.ModelSuggestion;
import com.alphatrade.analysis.signal.SignalGenerator;
import com.alphatrade.analysis.signal.SignalGenerator.TradeSignal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

@Service
public class AnalysisWorkflowService {

    private static final Logger log = LoggerFactory.getLogger(AnalysisWorkflowService.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    private final SignalGenerator signalGenerator;
    private final ModelInferenceClient modelInferenceClient;
    private final SuggestionBlendService suggestionBlendService;
    private final SignalSnapshotService signalSnapshotService;
    private final HttpClient httpClient;
    private final String marketDataUrl;

    public AnalysisWorkflowService(
        SignalGenerator signalGenerator,
        ModelInferenceClient modelInferenceClient,
        SuggestionBlendService suggestionBlendService,
        SignalSnapshotService signalSnapshotService,
        @Value("${marketdata.url:http://localhost:8087}") String marketDataUrl
    ) {
        this.signalGenerator = signalGenerator;
        this.modelInferenceClient = modelInferenceClient;
        this.suggestionBlendService = suggestionBlendService;
        this.signalSnapshotService = signalSnapshotService;
        this.marketDataUrl = marketDataUrl;
        this.httpClient = HttpClient.newHttpClient();
    }

    public List<Candle> fetchCandles(String symbol) {
        try {
            HttpRequest req = HttpRequest.newBuilder().uri(URI.create(marketDataUrl + "/api/marketdata/candles/" + symbol.toUpperCase())).GET().build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return Collections.emptyList();
            JsonNode arr = mapper.readTree(res.body());
            List<Candle> candles = new ArrayList<>();
            for (JsonNode n : arr) {
                candles.add(new Candle(
                    n.get("date").asText(),
                    n.get("open").asDouble(),
                    n.get("high").asDouble(),
                    n.get("low").asDouble(),
                    n.get("close").asDouble(),
                    n.get("volume").asLong()
                ));
            }
            return candles;
        } catch (Exception e) {
            log.error("Failed to fetch candles for {}: {}", symbol, e.getMessage());
            return Collections.emptyList();
        }
    }

    public List<String> fetchSymbols() {
        try {
            HttpRequest req = HttpRequest.newBuilder().uri(URI.create(marketDataUrl + "/api/marketdata/symbols")).GET().build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return Collections.emptyList();
            JsonNode arr = mapper.readTree(res.body());
            List<String> symbols = new ArrayList<>();
            for (JsonNode symbol : arr) symbols.add(symbol.asText());
            return symbols;
        } catch (Exception e) {
            log.warn("Failed to fetch symbol list: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    public Optional<AnalysisBundle> generateBundle(String symbol, String generationSource) {
        List<Candle> candles = fetchCandles(symbol);
        if (candles.isEmpty()) {
          return Optional.empty();
        }
        TradeSignal ruleSignal = signalGenerator.generate(symbol.toUpperCase(), candles);
        Optional<ModelSuggestion> modelSuggestion = modelInferenceClient.score(symbol.toUpperCase(), candles);
        BlendedSuggestion blendedSuggestion = suggestionBlendService.blend(ruleSignal, modelSuggestion);
        signalSnapshotService.store(symbol.toUpperCase(), candles, ruleSignal, modelSuggestion, blendedSuggestion, generationSource);
        return Optional.of(new AnalysisBundle(symbol.toUpperCase(), candles, ruleSignal, modelSuggestion, blendedSuggestion));
    }
}
