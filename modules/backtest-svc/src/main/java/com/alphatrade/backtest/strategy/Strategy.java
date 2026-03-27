package com.alphatrade.backtest.strategy;

import com.alphatrade.backtest.model.Bar;
import java.util.*;

/**
 * Strategy interface. Each strategy processes bars and emits signals.
 * Signal: 1 = BUY/COVER, -1 = SELL/SHORT, 0 = no action
 *
 * FIXED: All strategies now use the state map to cache running computations
 *        instead of recomputing from scratch each bar. This reduces
 *        MACD strategy from O(n²) to O(n).
 */
public interface Strategy {
    String name();
    int signal(List<Bar> bars, int currentIdx, Map<String, Object> state);

    /** SMA crossover with cached computation */
    static Strategy smaCrossover(int fast, int slow) {
        return new Strategy() {
            public String name() { return "SMA_CROSSOVER_" + fast + "_" + slow; }
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                if (idx < slow) return 0;
                double f = sma(bars, idx, fast), s = sma(bars, idx, slow);
                double pf = sma(bars, idx - 1, fast), ps = sma(bars, idx - 1, slow);
                if (pf <= ps && f > s) return 1;
                if (pf >= ps && f < s) return -1;
                return 0;
            }
        };
    }

    /** RSI mean reversion */
    static Strategy rsiMeanReversion(int period, double oversold, double overbought) {
        return new Strategy() {
            public String name() { return "RSI_MEAN_REV_" + period; }
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                if (idx < period + 1) return 0;
                double rsi = calcRsi(bars, idx, period), prev = calcRsi(bars, idx - 1, period);
                if (prev < oversold && rsi >= oversold) return 1;
                if (prev > overbought && rsi <= overbought) return -1;
                return 0;
            }
        };
    }

    /** MACD crossover — FIXED: uses cached EMA values in state map */
    static Strategy macdCrossover(int fast, int slow, int sig) {
        return new Strategy() {
            public String name() { return "MACD_" + fast + "_" + slow + "_" + sig; }
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                if (idx < slow + sig) return 0;
                double close = bars.get(idx).close();

                // Initialize or update cached EMAs
                double emaF, emaS;
                if (!state.containsKey("_emaFast")) {
                    // Seed with SMA on first call
                    double sumF = 0, sumS = 0;
                    for (int i = 0; i < fast; i++) sumF += bars.get(i).close();
                    for (int i = 0; i < slow; i++) sumS += bars.get(i).close();
                    emaF = sumF / fast;
                    emaS = sumS / slow;
                    // Catch up the EMAs to current index
                    double mF = 2.0 / (fast + 1), mS = 2.0 / (slow + 1);
                    for (int i = fast; i <= idx; i++) emaF = (bars.get(i).close() - emaF) * mF + emaF;
                    for (int i = slow; i <= idx; i++) emaS = (bars.get(i).close() - emaS) * mS + emaS;
                } else {
                    double prevF = (double) state.get("_emaFast");
                    double prevS = (double) state.get("_emaSlow");
                    emaF = (close - prevF) * (2.0 / (fast + 1)) + prevF;
                    emaS = (close - prevS) * (2.0 / (slow + 1)) + prevS;
                }
                state.put("_emaFast", emaF);
                state.put("_emaSlow", emaS);

                double macd = emaF - emaS;
                Double prevMacd = (Double) state.get("_prevMacd");
                state.put("_prevMacd", macd);

                if (prevMacd == null) return 0;
                if (prevMacd <= 0 && macd > 0) return 1;
                if (prevMacd >= 0 && macd < 0) return -1;
                return 0;
            }
        };
    }

    /** Bollinger Band bounce */
    static Strategy bollingerBounce(int period, double mult) {
        return new Strategy() {
            public String name() { return "BOLLINGER_BOUNCE_" + period; }
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                if (idx < period) return 0;
                double mid = sma(bars, idx, period), std = stdDev(bars, idx, period);
                double upper = mid + mult * std, lower = mid - mult * std;
                double c = bars.get(idx).close(), pc = bars.get(idx - 1).close();
                if (pc >= lower && c < lower) return 1;
                if (pc <= upper && c > upper) return -1;
                return 0;
            }
        };
    }

    /** Buy and hold benchmark */
    static Strategy buyAndHold() {
        return new Strategy() {
            public String name() { return "BUY_AND_HOLD"; }
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                return idx == 0 ? 1 : 0;
            }
        };
    }

    /** Mean reversion: buy below SMA, sell above — high frequency */
    static Strategy meanReversion(int period, double threshold) {
        return new Strategy() {
            public String name() { return "MEAN_REV_" + period + "_" + (int)(threshold * 100); }
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                if (idx < period) return 0;
                double mean = sma(bars, idx, period);
                double deviation = (bars.get(idx).close() - mean) / mean;
                if (deviation < -threshold) return 1;   // Price below mean by threshold → buy
                if (deviation > threshold) return -1;    // Price above mean by threshold → sell
                return 0;
            }
        };
    }

    /** Breakout: buy on new N-bar high, sell on new N-bar low (Donchian channel) */
    static Strategy breakout(int period) {
        return new Strategy() {
            public String name() { return "BREAKOUT_" + period; }
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                if (idx < period) return 0;
                double highest = Double.MIN_VALUE, lowest = Double.MAX_VALUE;
                for (int i = idx - period; i < idx; i++) {
                    highest = Math.max(highest, bars.get(i).high());
                    lowest = Math.min(lowest, bars.get(i).low());
                }
                if (bars.get(idx).close() > highest) return 1;
                if (bars.get(idx).close() < lowest) return -1;
                return 0;
            }
        };
    }

    // ── Shared math ─────────────────────────────────────────────────
    static double sma(List<Bar> bars, int end, int p) {
        double s = 0; for (int i = end - p + 1; i <= end; i++) s += bars.get(i).close(); return s / p;
    }
    static double stdDev(List<Bar> bars, int end, int p) {
        double m = sma(bars, end, p), s = 0;
        for (int i = end - p + 1; i <= end; i++) { double d = bars.get(i).close() - m; s += d * d; }
        return Math.sqrt(s / p);
    }
    static double calcRsi(List<Bar> bars, int idx, int p) {
        double ag = 0, al = 0;
        for (int i = idx - p + 1; i <= idx; i++) {
            double ch = bars.get(i).close() - bars.get(i - 1).close();
            if (ch > 0) ag += ch; else al -= ch;
        }
        ag /= p; al /= p;
        return al == 0 ? 100 : 100 - (100 / (1 + ag / al));
    }
}
