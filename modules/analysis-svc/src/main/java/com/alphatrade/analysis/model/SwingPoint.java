package com.alphatrade.analysis.model;

public record SwingPoint(
    String type,
    String date,
    int index,
    double price,
    double strength
) {}
