package com.alphatrade.common.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;

@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Order(
    String orderId,
    String clientId,
    String symbol,
    OrderSide side,
    OrderType type,
    int qty,
    BigDecimal price,
    Instant ts,
    TimeInForce timeInForce,
    OrderStatus status,
    String rejectReason,
    int filledQty,
    BigDecimal avgFillPrice
) {
    /** Builder-style copy methods for immutable record pattern */
    public Order withStatus(OrderStatus newStatus) {
        return new Order(orderId, clientId, symbol, side, type, qty, price, ts, timeInForce, newStatus, rejectReason, filledQty, avgFillPrice);
    }

    public Order withReject(String reason) {
        return new Order(orderId, clientId, symbol, side, type, qty, price, ts, timeInForce, OrderStatus.REJECTED, reason, filledQty, avgFillPrice);
    }

    public Order withFill(int newFilledQty, BigDecimal newAvgPx) {
        OrderStatus newStatus = (newFilledQty >= qty) ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED;
        return new Order(orderId, clientId, symbol, side, type, qty, price, ts, timeInForce, newStatus, rejectReason, newFilledQty, newAvgPx);
    }
}
