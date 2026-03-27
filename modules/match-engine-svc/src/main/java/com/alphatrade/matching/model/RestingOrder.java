package com.alphatrade.matching.model;

import com.alphatrade.common.model.Order;
import com.alphatrade.common.model.OrderSide;
import com.alphatrade.common.model.OrderType;
import com.alphatrade.common.model.TimeInForce;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Mutable order sitting on the book. Separated from the immutable
 * wire-format Order record so that the matching engine can efficiently
 * decrement remaining quantity without allocating new objects per fill.
 */
public class RestingOrder {
    private final String orderId;
    private final String clientId;
    private final String symbol;
    private final OrderSide side;
    private final OrderType type;
    private final BigDecimal price;
    private final TimeInForce timeInForce;
    private final Instant ts;
    private final int originalQty;
    private int remainingQty;
    private BigDecimal avgFillPrice;
    private int filledQty;

    public RestingOrder(Order order) {
        this.orderId = order.orderId();
        this.clientId = order.clientId();
        this.symbol = order.symbol();
        this.side = order.side();
        this.type = order.type();
        this.price = order.price();
        this.timeInForce = order.timeInForce();
        this.ts = order.ts();
        this.originalQty = order.qty();
        this.remainingQty = order.qty();
        this.filledQty = 0;
        this.avgFillPrice = BigDecimal.ZERO;
    }

    /** Apply a fill and recalculate running average fill price */
    public void applyFill(int fillQty, BigDecimal fillPrice) {
        BigDecimal totalCost = avgFillPrice.multiply(BigDecimal.valueOf(filledQty))
                .add(fillPrice.multiply(BigDecimal.valueOf(fillQty)));
        filledQty += fillQty;
        remainingQty -= fillQty;
        avgFillPrice = totalCost.divide(BigDecimal.valueOf(filledQty), 6, java.math.RoundingMode.HALF_UP);
    }

    public boolean isFilled() { return remainingQty <= 0; }

    public String getOrderId()       { return orderId; }
    public String getClientId()      { return clientId; }
    public String getSymbol()        { return symbol; }
    public OrderSide getSide()       { return side; }
    public OrderType getType()       { return type; }
    public BigDecimal getPrice()     { return price; }
    public TimeInForce getTimeInForce() { return timeInForce; }
    public Instant getTs()           { return ts; }
    public int getOriginalQty()      { return originalQty; }
    public int getRemainingQty()     { return remainingQty; }
    public int getFilledQty()        { return filledQty; }
    public BigDecimal getAvgFillPrice() { return avgFillPrice; }
}
