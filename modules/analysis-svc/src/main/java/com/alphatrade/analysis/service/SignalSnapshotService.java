package com.alphatrade.analysis.service;

import com.alphatrade.analysis.entity.SignalSnapshotEntity;
import com.alphatrade.analysis.model.BlendedSuggestion;
import com.alphatrade.analysis.model.Candle;
import com.alphatrade.analysis.model.ModelSuggestion;
import com.alphatrade.analysis.repository.SignalSnapshotRepository;
import com.alphatrade.analysis.signal.SignalGenerator.TradeSignal;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Service
public class SignalSnapshotService {

    private final SignalSnapshotRepository repository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SignalSnapshotService(SignalSnapshotRepository repository) {
        this.repository = repository;
    }

    public void store(String symbol, List<Candle> candles, TradeSignal ruleSignal,
                      Optional<ModelSuggestion> modelSignal, BlendedSuggestion blendedSuggestion,
                      String generationSource) {
        SignalSnapshotEntity entity = new SignalSnapshotEntity();
        entity.setSymbol(symbol.toUpperCase());
        entity.setRuleAction(ruleSignal.action());
        entity.setRuleConfidence(ruleSignal.confidence());
        entity.setRuleRationale(ruleSignal.rationale());
        entity.setRuleBullFactorsJson(writeJson(ruleSignal.bullFactors()));
        entity.setRuleBearFactorsJson(writeJson(ruleSignal.bearFactors()));

        entity.setModelAction(modelSignal.map(ModelSuggestion::action).orElse(null));
        entity.setModelConfidence(modelSignal.map(ModelSuggestion::confidence).orElse(null));
        entity.setModelName(modelSignal.map(ModelSuggestion::modelName).orElse(null));
        entity.setProvider(modelSignal.map(ModelSuggestion::provider).orElse(null));
        entity.setFeatureVersion(modelSignal.map(ModelSuggestion::featureVersion).orElse(null));
        entity.setNativeBackendUsed(modelSignal.map(ModelSuggestion::nativeBackendUsed).orElse(null));
        entity.setCandleCount(modelSignal.map(ModelSuggestion::candleCount).orElse(candles.size()));
        entity.setInferenceLatencyMs(modelSignal.map(ModelSuggestion::inferenceLatencyMs).orElse(null));
        entity.setRegime(modelSignal.map(ModelSuggestion::regime).orElse(null));
        entity.setExpectedMovePct(modelSignal.map(ModelSuggestion::expectedMovePct).orElse(null));
        entity.setModelReasonsJson(writeJson(modelSignal.map(ModelSuggestion::reasons).orElse(List.of())));
        entity.setModelFeaturesJson(writeJson(modelSignal.map(ModelSuggestion::features).orElse(null)));
        entity.setModelStructureJson(writeJson(modelSignal.map(ModelSuggestion::structure).orElse(null)));
        entity.setModelTrendLinesJson(writeJson(modelSignal.map(ModelSuggestion::trendLines).orElse(List.of())));
        entity.setModelProjectionJson(writeJson(modelSignal.map(ModelSuggestion::projection).orElse(null)));

        entity.setBlendedAction(blendedSuggestion.action());
        entity.setBlendedConfidence(blendedSuggestion.confidence());
        entity.setAlignment(blendedSuggestion.alignment());
        entity.setBlendedReasonsJson(writeJson(blendedSuggestion.reasons()));

        entity.setClosePrice(candles.isEmpty() ? null : candles.get(candles.size() - 1).close());
        entity.setSummary(blendedSuggestion.summary());
        entity.setGenerationSource(generationSource);
        entity.setCreatedAt(Instant.now());
        repository.save(entity);
    }

    public List<SignalSnapshotEntity> latestBySymbol(String symbol) {
        return repository.findTop50BySymbolOrderByCreatedAtDesc(symbol.toUpperCase());
    }

    public List<SignalSnapshotEntity> latestGlobal() {
        return repository.findTop50ByOrderByCreatedAtDesc();
    }

    private String writeJson(Object value) {
        if (value == null) return null;
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return null;
        }
    }
}
