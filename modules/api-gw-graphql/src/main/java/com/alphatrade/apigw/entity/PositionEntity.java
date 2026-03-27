package com.alphatrade.apigw.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "positions")
@IdClass(PositionId.class)
public class PositionEntity {

    @Id
    @Column(name = "account_id")
    private String accountId;

    @Id
    @Column(name = "symbol")
    private String symbol;

    @Column(name = "qty")
    private int qty;

    @Column(name = "avg_px", precision = 18, scale = 6)
    private BigDecimal avgPx;

    @Column(name = "realized_pnl", precision = 18, scale = 6)
    private BigDecimal realizedPnl;

    @Column(name = "total_buy_qty")
    private int totalBuyQty;

    @Column(name = "total_sell_qty")
    private int totalSellQty;

    @Column(name = "total_buy_notional", precision = 18, scale = 6)
    private BigDecimal totalBuyNotional;

    @Column(name = "total_sell_notional", precision = 18, scale = 6)
    private BigDecimal totalSellNotional;

    public String getAccountId() { return accountId; }
    public String getSymbol() { return symbol; }
    public int getQty() { return qty; }
    public BigDecimal getAvgPx() { return avgPx; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
    public int getTotalBuyQty() { return totalBuyQty; }
    public int getTotalSellQty() { return totalSellQty; }
    public BigDecimal getTotalBuyNotional() { return totalBuyNotional; }
    public BigDecimal getTotalSellNotional() { return totalSellNotional; }
}
