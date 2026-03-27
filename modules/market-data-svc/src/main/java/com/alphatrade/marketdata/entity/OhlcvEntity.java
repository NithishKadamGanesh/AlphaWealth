package com.alphatrade.marketdata.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "ohlcv", indexes = {
    @Index(name = "idx_ohlcv_symbol_date", columnList = "symbol, date", unique = true),
    @Index(name = "idx_ohlcv_symbol", columnList = "symbol")
})
public class OhlcvEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 16)
    private String symbol;

    @Column(nullable = false)
    private LocalDate date;

    @Column(name = "open_px", precision = 18, scale = 6)
    private BigDecimal open;

    @Column(name = "high_px", precision = 18, scale = 6)
    private BigDecimal high;

    @Column(name = "low_px", precision = 18, scale = 6)
    private BigDecimal low;

    @Column(name = "close_px", precision = 18, scale = 6)
    private BigDecimal close;

    @Column(name = "adj_close", precision = 18, scale = 6)
    private BigDecimal adjClose;

    @Column
    private Long volume;

    @Column(length = 16)
    private String timeframe;

    public OhlcvEntity() {}

    public OhlcvEntity(String symbol, LocalDate date, BigDecimal open, BigDecimal high,
                       BigDecimal low, BigDecimal close, BigDecimal adjClose, Long volume, String timeframe) {
        this.symbol = symbol; this.date = date; this.open = open; this.high = high;
        this.low = low; this.close = close; this.adjClose = adjClose; this.volume = volume; this.timeframe = timeframe;
    }

    public Long getId() { return id; }
    public String getSymbol() { return symbol; }
    public LocalDate getDate() { return date; }
    public BigDecimal getOpen() { return open; }
    public BigDecimal getHigh() { return high; }
    public BigDecimal getLow() { return low; }
    public BigDecimal getClose() { return close; }
    public BigDecimal getAdjClose() { return adjClose; }
    public Long getVolume() { return volume; }
    public String getTimeframe() { return timeframe; }
    public void setId(Long id) { this.id = id; }
    public void setSymbol(String s) { this.symbol = s; }
    public void setDate(LocalDate d) { this.date = d; }
    public void setOpen(BigDecimal o) { this.open = o; }
    public void setHigh(BigDecimal h) { this.high = h; }
    public void setLow(BigDecimal l) { this.low = l; }
    public void setClose(BigDecimal c) { this.close = c; }
    public void setAdjClose(BigDecimal a) { this.adjClose = a; }
    public void setVolume(Long v) { this.volume = v; }
    public void setTimeframe(String t) { this.timeframe = t; }
}
