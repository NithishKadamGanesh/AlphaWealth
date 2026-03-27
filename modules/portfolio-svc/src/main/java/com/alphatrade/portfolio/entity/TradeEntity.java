package com.alphatrade.portfolio.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "trades", indexes = {
    @Index(name = "idx_trades_account_symbol_ts", columnList = "account_id, symbol, ts")
})
public class TradeEntity {

    @Id
    @Column(name = "trade_id")
    private String tradeId;

    @Column(name = "order_id", nullable = false)
    private String orderId;

    @Column(name = "account_id", nullable = false)
    private String accountId;

    @Column(name = "symbol", nullable = false)
    private String symbol;

    @Column(name = "side", nullable = false)
    private String side;

    @Column(name = "qty", nullable = false)
    private int qty;

    @Column(name = "price", precision = 18, scale = 6, nullable = false)
    private BigDecimal price;

    @Column(name = "ts", nullable = false)
    private Instant ts;

    public TradeEntity() {}

    public TradeEntity(String tradeId, String orderId, String accountId, String symbol,
                       String side, int qty, BigDecimal price, Instant ts) {
        this.tradeId = tradeId;
        this.orderId = orderId;
        this.accountId = accountId;
        this.symbol = symbol;
        this.side = side;
        this.qty = qty;
        this.price = price;
        this.ts = ts;
    }

    public String getTradeId() { return tradeId; }
    public void setTradeId(String tradeId) { this.tradeId = tradeId; }
    public String getOrderId() { return orderId; }
    public void setOrderId(String orderId) { this.orderId = orderId; }
    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public String getSide() { return side; }
    public void setSide(String side) { this.side = side; }
    public int getQty() { return qty; }
    public void setQty(int qty) { this.qty = qty; }
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    public Instant getTs() { return ts; }
    public void setTs(Instant ts) { this.ts = ts; }
}
