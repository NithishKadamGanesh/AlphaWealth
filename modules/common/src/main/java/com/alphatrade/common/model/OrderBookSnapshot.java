package com.alphatrade.common.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record OrderBookSnapshot(
    String symbol,
    List<PriceLevel> bids,
    List<PriceLevel> asks,
    Instant ts
) {
    public record PriceLevel(BigDecimal price, int qty, int orderCount) {}
}
