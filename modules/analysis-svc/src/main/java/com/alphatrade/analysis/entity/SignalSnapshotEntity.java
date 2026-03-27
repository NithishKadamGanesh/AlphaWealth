package com.alphatrade.analysis.entity;

import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "analysis_signal_snapshots", indexes = {
    @Index(name = "idx_signal_snapshots_symbol_ts", columnList = "symbol, createdAt"),
    @Index(name = "idx_signal_snapshots_created_at", columnList = "createdAt")
})
public class SignalSnapshotEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 16)
    private String symbol;

    @Column(nullable = false, length = 16)
    private String ruleAction;

    @Column(nullable = false)
    private double ruleConfidence;

    @Column(length = 16)
    private String modelAction;

    private Double modelConfidence;

    @Column(length = 16, nullable = false)
    private String blendedAction;

    @Column(nullable = false)
    private double blendedConfidence;

    @Column(length = 24, nullable = false)
    private String alignment;

    @Column(length = 24)
    private String regime;

    private Double expectedMovePct;

    private Double closePrice;

    @Column(length = 64)
    private String modelName;

    @Column(length = 64)
    private String provider;

    @Column(length = 64)
    private String featureVersion;

    private Boolean nativeBackendUsed;

    private Integer candleCount;

    private Double inferenceLatencyMs;

    @Column(length = 1024)
    private String ruleRationale;

    @Lob
    private String ruleBullFactorsJson;

    @Lob
    private String ruleBearFactorsJson;

    @Lob
    private String modelReasonsJson;

    @Lob
    private String modelFeaturesJson;

    @Lob
    private String modelStructureJson;

    @Lob
    private String modelTrendLinesJson;

    @Lob
    private String modelProjectionJson;

    @Lob
    private String blendedReasonsJson;

    @Column(length = 32)
    private String generationSource;

    @Column(length = 512)
    private String summary;

    @Column(nullable = false)
    private Instant createdAt;

    public SignalSnapshotEntity() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public String getRuleAction() { return ruleAction; }
    public void setRuleAction(String ruleAction) { this.ruleAction = ruleAction; }
    public double getRuleConfidence() { return ruleConfidence; }
    public void setRuleConfidence(double ruleConfidence) { this.ruleConfidence = ruleConfidence; }
    public String getModelAction() { return modelAction; }
    public void setModelAction(String modelAction) { this.modelAction = modelAction; }
    public Double getModelConfidence() { return modelConfidence; }
    public void setModelConfidence(Double modelConfidence) { this.modelConfidence = modelConfidence; }
    public String getBlendedAction() { return blendedAction; }
    public void setBlendedAction(String blendedAction) { this.blendedAction = blendedAction; }
    public double getBlendedConfidence() { return blendedConfidence; }
    public void setBlendedConfidence(double blendedConfidence) { this.blendedConfidence = blendedConfidence; }
    public String getAlignment() { return alignment; }
    public void setAlignment(String alignment) { this.alignment = alignment; }
    public String getRegime() { return regime; }
    public void setRegime(String regime) { this.regime = regime; }
    public Double getExpectedMovePct() { return expectedMovePct; }
    public void setExpectedMovePct(Double expectedMovePct) { this.expectedMovePct = expectedMovePct; }
    public Double getClosePrice() { return closePrice; }
    public void setClosePrice(Double closePrice) { this.closePrice = closePrice; }
    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }
    public String getModelName() { return modelName; }
    public void setModelName(String modelName) { this.modelName = modelName; }
    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }
    public String getFeatureVersion() { return featureVersion; }
    public void setFeatureVersion(String featureVersion) { this.featureVersion = featureVersion; }
    public Boolean getNativeBackendUsed() { return nativeBackendUsed; }
    public void setNativeBackendUsed(Boolean nativeBackendUsed) { this.nativeBackendUsed = nativeBackendUsed; }
    public Integer getCandleCount() { return candleCount; }
    public void setCandleCount(Integer candleCount) { this.candleCount = candleCount; }
    public Double getInferenceLatencyMs() { return inferenceLatencyMs; }
    public void setInferenceLatencyMs(Double inferenceLatencyMs) { this.inferenceLatencyMs = inferenceLatencyMs; }
    public String getRuleRationale() { return ruleRationale; }
    public void setRuleRationale(String ruleRationale) { this.ruleRationale = ruleRationale; }
    public String getRuleBullFactorsJson() { return ruleBullFactorsJson; }
    public void setRuleBullFactorsJson(String ruleBullFactorsJson) { this.ruleBullFactorsJson = ruleBullFactorsJson; }
    public String getRuleBearFactorsJson() { return ruleBearFactorsJson; }
    public void setRuleBearFactorsJson(String ruleBearFactorsJson) { this.ruleBearFactorsJson = ruleBearFactorsJson; }
    public String getModelReasonsJson() { return modelReasonsJson; }
    public void setModelReasonsJson(String modelReasonsJson) { this.modelReasonsJson = modelReasonsJson; }
    public String getModelFeaturesJson() { return modelFeaturesJson; }
    public void setModelFeaturesJson(String modelFeaturesJson) { this.modelFeaturesJson = modelFeaturesJson; }
    public String getModelStructureJson() { return modelStructureJson; }
    public void setModelStructureJson(String modelStructureJson) { this.modelStructureJson = modelStructureJson; }
    public String getModelTrendLinesJson() { return modelTrendLinesJson; }
    public void setModelTrendLinesJson(String modelTrendLinesJson) { this.modelTrendLinesJson = modelTrendLinesJson; }
    public String getModelProjectionJson() { return modelProjectionJson; }
    public void setModelProjectionJson(String modelProjectionJson) { this.modelProjectionJson = modelProjectionJson; }
    public String getBlendedReasonsJson() { return blendedReasonsJson; }
    public void setBlendedReasonsJson(String blendedReasonsJson) { this.blendedReasonsJson = blendedReasonsJson; }
    public String getGenerationSource() { return generationSource; }
    public void setGenerationSource(String generationSource) { this.generationSource = generationSource; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
