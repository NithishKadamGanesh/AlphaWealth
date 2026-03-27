package com.alphatrade.analysis.model;

import java.util.List;
import java.util.Map;

public record ModelSuggestion(
    String modelName,
    String provider,
    String featureVersion,
    boolean nativeBackendUsed,
    int candleCount,
    double inferenceLatencyMs,
    String generatedAt,
    String action,
    double confidence,
    double expectedMovePct,
    String regime,
    String horizon,
    double support,
    double resistance,
    double stopLoss,
    double target,
    List<String> reasons,
    Map<String, Double> features,
    MarketStructure structure,
    List<TrendLine> trendLines,
    PriceProjection projection
) {}
