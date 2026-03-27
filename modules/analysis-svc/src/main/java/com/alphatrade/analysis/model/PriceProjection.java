package com.alphatrade.analysis.model;

import java.util.List;

public record PriceProjection(
    String direction,
    String horizon,
    int horizonBars,
    double expectedMovePct,
    PriceZone buyZone,
    PriceZone sellZone,
    PriceZone targetZone,
    PriceZone stretchZone,
    double invalidationLevel,
    double stopLevel,
    List<String> notes
) {}
