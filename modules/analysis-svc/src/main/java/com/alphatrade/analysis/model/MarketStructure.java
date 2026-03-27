package com.alphatrade.analysis.model;

import java.util.List;

public record MarketStructure(
    String trendState,
    String swingSequence,
    boolean higherHighs,
    boolean higherLows,
    boolean lowerHighs,
    boolean lowerLows,
    Double lastSwingHigh,
    Double lastSwingLow,
    List<SwingPoint> swingHighs,
    List<SwingPoint> swingLows
) {}
