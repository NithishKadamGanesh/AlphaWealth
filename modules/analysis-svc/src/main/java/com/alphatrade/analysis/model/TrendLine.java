package com.alphatrade.analysis.model;

public record TrendLine(
    String kind,
    String startDate,
    String endDate,
    int startIndex,
    int endIndex,
    double startPrice,
    double endPrice,
    double slope
) {}
