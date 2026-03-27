package com.alphatrade.common.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.math.BigDecimal;
import java.time.Instant;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Trade(
    String tradeId,
    String buyOrderId,
    String sellOrderId,
    String buyClientId,
    String sellClientId,
    String symbol,
    OrderSide aggressorSide,
    BigDecimal price,
    int qty,
    Instant ts
) {}
