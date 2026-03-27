package com.alphatrade.common.model;

import java.math.BigDecimal;

public record OrderRequest(
    String clientId,
    String symbol,
    OrderSide side,
    OrderType type,
    int qty,
    BigDecimal price,
    TimeInForce timeInForce
) {}
