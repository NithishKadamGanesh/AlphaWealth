package com.alphatrade.backtest.model;

public record Bar(String date, double open, double high, double low, double close, long volume) {
    public double mid() { return (high + low) / 2; }
}
