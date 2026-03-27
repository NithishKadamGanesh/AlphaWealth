package com.alphatrade.portfolio.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "positions", indexes = {
    @Index(name = "idx_positions_account", columnList = "account_id")
})
@IdClass(PositionId.class)
public class PositionEntity {

    @Id
    @Column(name = "account_id", nullable = false)
    private String accountId;

    @Id
    @Column(name = "symbol", nullable = false)
    private String symbol;

    @Column(name = "qty", nullable = false)
    private int qty;

    @Column(name = "avg_px", precision = 18, scale = 6)
    private BigDecimal avgPx = BigDecimal.ZERO;

    @Column(name = "realized_pnl", precision = 18, scale = 6)
    private BigDecimal realizedPnl = BigDecimal.ZERO;

    @Column(name = "total_buy_qty")
    private int totalBuyQty = 0;

    @Column(name = "total_sell_qty")
    private int totalSellQty = 0;

    @Column(name = "total_buy_notional", precision = 18, scale = 6)
    private BigDecimal totalBuyNotional = BigDecimal.ZERO;

    @Column(name = "total_sell_notional", precision = 18, scale = 6)
    private BigDecimal totalSellNotional = BigDecimal.ZERO;

    public PositionEntity() {}

    public PositionEntity(String accountId, String symbol) {
        this.accountId = accountId;
        this.symbol = symbol;
    }

    // Getters and setters
    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public int getQty() { return qty; }
    public void setQty(int qty) { this.qty = qty; }
    public BigDecimal getAvgPx() { return avgPx; }
    public void setAvgPx(BigDecimal avgPx) { this.avgPx = avgPx; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
    public void setRealizedPnl(BigDecimal realizedPnl) { this.realizedPnl = realizedPnl; }
    public int getTotalBuyQty() { return totalBuyQty; }
    public void setTotalBuyQty(int totalBuyQty) { this.totalBuyQty = totalBuyQty; }
    public int getTotalSellQty() { return totalSellQty; }
    public void setTotalSellQty(int totalSellQty) { this.totalSellQty = totalSellQty; }
    public BigDecimal getTotalBuyNotional() { return totalBuyNotional; }
    public void setTotalBuyNotional(BigDecimal totalBuyNotional) { this.totalBuyNotional = totalBuyNotional; }
    public BigDecimal getTotalSellNotional() { return totalSellNotional; }
    public void setTotalSellNotional(BigDecimal totalSellNotional) { this.totalSellNotional = totalSellNotional; }
}
