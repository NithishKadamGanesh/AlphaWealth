package com.alphatrade.analysis.model;

public record PriceZone(
    String kind,
    String label,
    double low,
    double high,
    double confidence
) {}
