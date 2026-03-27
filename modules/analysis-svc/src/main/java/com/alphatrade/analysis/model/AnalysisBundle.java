package com.alphatrade.analysis.model;

import com.alphatrade.analysis.signal.SignalGenerator.TradeSignal;

import java.util.List;
import java.util.Optional;

public record AnalysisBundle(
    String symbol,
    List<Candle> candles,
    TradeSignal ruleSignal,
    Optional<ModelSuggestion> modelSuggestion,
    BlendedSuggestion blendedSuggestion
) {}
