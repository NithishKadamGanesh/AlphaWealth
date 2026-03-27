package com.alphatrade.apigw.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "trades")
public class TradeEntity {

    @Id
    @Column(name = "trade_id")
    private String tradeId;

    @Column(name = "order_id")
    private String orderId;

    @Column(name = "account_id")
    private String accountId;

    @Column(name = "symbol")
    private String symbol;

    @Column(name = "side")
    private String side;

    @Column(name = "qty")
    private int qty;

    @Column(name = "price", precision = 18, scale = 6)
    private BigDecimal price;

    @Column(name = "ts")
    private Instant ts;

    public String getTradeId() { return tradeId; }
    public String getOrderId() { return orderId; }
    public String getAccountId() { return accountId; }
    public String getSymbol() { return symbol; }
    public String getSide() { return side; }
    public int getQty() { return qty; }
    public BigDecimal getPrice() { return price; }
    public Instant getTs() { return ts; }
}
