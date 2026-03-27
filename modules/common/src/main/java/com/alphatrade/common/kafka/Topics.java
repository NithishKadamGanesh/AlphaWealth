package com.alphatrade.common.kafka;

public final class Topics {
    private Topics() {}

    public static final String ORDERS_RAW     = "orders.raw";
    public static final String ORDERS_VALID   = "orders.valid";
    public static final String ORDERS_REJECT  = "orders.reject";
    public static final String ORDERS_UPDATES = "orders.updates";
    public static final String TRADES_FILLS   = "trades.fills";
    public static final String BOOK_SNAPSHOTS = "book.snapshots";
}
