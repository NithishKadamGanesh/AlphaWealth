package com.alphatrade.analysis.model;

import java.util.List;

public record BlendedSuggestion(
    String action,
    double confidence,
    String alignment,
    String summary,
    List<String> reasons
) {}
