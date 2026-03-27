package com.alphatrade.backtest.model;

import java.util.List;
import java.util.Map;

public record BacktestResult(
    String symbol, String strategy, String period,
    int totalBars, int totalTrades, int wins, int losses,
    double winRate, double totalPnl, double totalPnlPct,
    double maxDrawdown, double maxDrawdownPct,
    double sharpeRatio, double profitFactor,
    double avgWin, double avgLoss, double avgHoldDays,
    double startingCapital, double endingCapital,
    List<BacktestTrade> trades,
    List<Double> equityCurve,
    List<Map<String, Object>> monthlySummary
) {}
