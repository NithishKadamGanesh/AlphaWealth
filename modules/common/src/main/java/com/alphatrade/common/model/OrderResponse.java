package com.alphatrade.common.model;

import java.time.Instant;

public record OrderResponse(
    String orderId,
    OrderStatus status,
    Instant ts,
    String message
) {}
