package com.alphatrade.analysis.model;

public record Candle(String date, double open, double high, double low, double close, long volume) {
    public double hl2() { return (high + low) / 2; }
    public double hlc3() { return (high + low + close) / 3; }
    public double range() { return high - low; }
    public boolean isBullish() { return close > open; }
    public boolean isBearish() { return close < open; }
    public double body() { return Math.abs(close - open); }
    public double upperWick() { return high - Math.max(open, close); }
    public double lowerWick() { return Math.min(open, close) - low; }
}
