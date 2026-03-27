package com.alphatrade.backtest.model;

public record BacktestTrade(
    int entryIdx, String entryDate, double entryPrice,
    int exitIdx, String exitDate, double exitPrice,
    String side, int qty, double pnl, double pnlPct, String exitReason
) {}
