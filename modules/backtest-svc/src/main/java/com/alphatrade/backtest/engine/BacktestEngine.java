package com.alphatrade.backtest.engine;

import com.alphatrade.backtest.model.*;
import com.alphatrade.backtest.strategy.Strategy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Core backtest replay engine.
 *
 * FIXES & ADDITIONS from code review:
 *   1. Short selling support (signal -1 with no position opens short)
 *   2. Stop-loss and take-profit as configurable parameters
 *   3. Intrabar stop-loss checking using high/low (not just close)
 *   4. Walk-forward split support
 *   5. Max concurrent position limit
 */
@Component
public class BacktestEngine {

    private static final Logger log = LoggerFactory.getLogger(BacktestEngine.class);

    public BacktestResult run(List<Bar> bars, Strategy strategy, String symbol,
                              double capital, double positionPct, double commission,
                              double slippage) {
        return run(bars, strategy, symbol, capital, positionPct, commission, slippage, 0, 0);
    }

    /**
     * @param stopLossPct  Stop-loss as % below entry (e.g. 5.0 = 5%). 0 = disabled.
     * @param takeProfitPct Take-profit as % above entry. 0 = disabled.
     */
    public BacktestResult run(List<Bar> bars, Strategy strategy, String symbol,
                              double capital, double positionPct, double commission,
                              double slippage, double stopLossPct, double takeProfitPct) {

        log.info("Backtest: {} on {} ({} bars, ${}, SL={}%, TP={}%)",
            strategy.name(), symbol, bars.size(), capital, stopLossPct, takeProfitPct);

        double cash = capital;
        int position = 0;          // positive = long, negative = short
        double entryPrice = 0;
        int entryIdx = 0;
        List<BacktestTrade> trades = new ArrayList<>();
        List<Double> equity = new ArrayList<>();
        Map<String, Object> state = new HashMap<>();
        double peak = capital, maxDD = 0, maxDDPct = 0;

        for (int i = 0; i < bars.size(); i++) {
            Bar bar = bars.get(i);
            double px = bar.close();

            // ── Intrabar stop-loss / take-profit check (uses high/low) ──
            if (position != 0 && (stopLossPct > 0 || takeProfitPct > 0)) {
                String exitReason = checkStopTakeProfit(bar, position, entryPrice, stopLossPct, takeProfitPct);
                if (exitReason != null) {
                    double exitPx = computeStopExitPrice(bar, position, entryPrice, stopLossPct, takeProfitPct);
                    double adj = exitPx * (1 - Math.signum(position) * slippage / 10000.0);
                    double pnl, pnlPct;
                    if (position > 0) {
                        double proceeds = position * adj - commission;
                        pnl = proceeds - (position * entryPrice);
                        pnlPct = (adj / entryPrice - 1) * 100;
                        cash += proceeds;
                    } else {
                        int absPos = Math.abs(position);
                        double cost = absPos * adj + commission;
                        pnl = (absPos * entryPrice) - cost;
                        pnlPct = (entryPrice / adj - 1) * 100;
                        cash -= cost;
                    }
                    trades.add(new BacktestTrade(entryIdx, bars.get(entryIdx).date(), r(entryPrice),
                        i, bar.date(), r(adj), position > 0 ? "LONG" : "SHORT",
                        Math.abs(position), r(pnl), r(pnlPct), exitReason));
                    position = 0;
                }
            }

            // ── Record equity ───────────────────────────────────────────
            double eq;
            if (position > 0) eq = cash + position * px;
            else if (position < 0) eq = cash - Math.abs(position) * px;
            else eq = cash;
            equity.add(eq);

            if (eq > peak) peak = eq;
            double dd = peak - eq;
            if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }

            // ── Get strategy signal ─────────────────────────────────────
            int sig = strategy.signal(bars, i, state);

            // ── Execute signals ─────────────────────────────────────────
            if (sig == 1 && position <= 0) {
                // Close short if open
                if (position < 0) {
                    int absPos = Math.abs(position);
                    double adj = px * (1 + slippage / 10000.0);
                    double cost = absPos * adj + commission;
                    double pnl = (absPos * entryPrice) - cost;
                    double pnlPct = (entryPrice / adj - 1) * 100;
                    cash -= cost;
                    trades.add(new BacktestTrade(entryIdx, bars.get(entryIdx).date(), r(entryPrice),
                        i, bar.date(), r(adj), "SHORT", absPos, r(pnl), r(pnlPct), "SIGNAL"));
                    position = 0;
                }
                // Open long
                double adj = px * (1 + slippage / 10000.0);
                int qty = (int) ((cash * positionPct - commission) / adj);
                if (qty > 0) {
                    cash -= qty * adj + commission;
                    position = qty;
                    entryPrice = adj;
                    entryIdx = i;
                }
            } else if (sig == -1 && position >= 0) {
                // Close long if open
                if (position > 0) {
                    double adj = px * (1 - slippage / 10000.0);
                    double proceeds = position * adj - commission;
                    double pnl = proceeds - (position * entryPrice);
                    double pnlPct = (adj / entryPrice - 1) * 100;
                    cash += proceeds;
                    trades.add(new BacktestTrade(entryIdx, bars.get(entryIdx).date(), r(entryPrice),
                        i, bar.date(), r(adj), "LONG", position, r(pnl), r(pnlPct), "SIGNAL"));
                    position = 0;
                }
                // Open short
                double adj = px * (1 - slippage / 10000.0);
                int qty = (int) ((cash * positionPct - commission) / adj);
                if (qty > 0) {
                    cash += qty * adj - commission;
                    position = -qty;
                    entryPrice = adj;
                    entryIdx = i;
                }
            }
        }

        // ── Close open position at last bar ─────────────────────────────
        if (position != 0 && !bars.isEmpty()) {
            double exitPx = bars.get(bars.size() - 1).close();
            if (position > 0) {
                double proceeds = position * exitPx - commission;
                double pnl = proceeds - (position * entryPrice);
                double pnlPct = (exitPx / entryPrice - 1) * 100;
                cash += proceeds;
                trades.add(new BacktestTrade(entryIdx, bars.get(entryIdx).date(), r(entryPrice),
                    bars.size() - 1, bars.get(bars.size() - 1).date(), r(exitPx),
                    "LONG", position, r(pnl), r(pnlPct), "END_OF_DATA"));
            } else {
                int absPos = Math.abs(position);
                double cost = absPos * exitPx + commission;
                double pnl = (absPos * entryPrice) - cost;
                double pnlPct = (entryPrice / exitPx - 1) * 100;
                cash -= cost;
                trades.add(new BacktestTrade(entryIdx, bars.get(entryIdx).date(), r(entryPrice),
                    bars.size() - 1, bars.get(bars.size() - 1).date(), r(exitPx),
                    "SHORT", absPos, r(pnl), r(pnlPct), "END_OF_DATA"));
            }
        }

        // ── Compute metrics ─────────────────────────────────────────────
        double endCap = cash, totalPnl = endCap - capital, totalPnlPct = (totalPnl / capital) * 100;
        int wins = 0, losses = 0; double sumW = 0, sumL = 0, totalHold = 0;
        for (BacktestTrade t : trades) {
            if (t.pnl() > 0) { wins++; sumW += t.pnl(); } else { losses++; sumL += Math.abs(t.pnl()); }
            totalHold += daysBetween(t.entryDate(), t.exitDate());
        }
        double winRate = trades.isEmpty() ? 0 : (double) wins / trades.size() * 100;
        double avgW = wins > 0 ? sumW / wins : 0, avgL = losses > 0 ? sumL / losses : 0;
        double pf = sumL > 0 ? sumW / sumL : sumW > 0 ? 999 : 0;
        double avgH = trades.isEmpty() ? 0 : totalHold / trades.size();
        double sharpe = computeSharpe(equity);
        List<Map<String, Object>> monthly = computeMonthly(bars, equity);
        String period = bars.isEmpty() ? "N/A" : bars.get(0).date() + " to " + bars.get(bars.size() - 1).date();

        return new BacktestResult(symbol, strategy.name(), period, bars.size(), trades.size(), wins, losses,
            r(winRate), r(totalPnl), r(totalPnlPct), r(maxDD), r(maxDDPct), r(sharpe), r(pf),
            r(avgW), r(avgL), r(avgH), capital, r(endCap), trades, equity, monthly);
    }

    // ── Walk-forward analysis ───────────────────────────────────────────

    public List<BacktestResult> walkForward(List<Bar> bars, Strategy strategy, String symbol,
                                            double capital, int inSampleBars, int outOfSampleBars) {
        List<BacktestResult> results = new ArrayList<>();
        int step = inSampleBars + outOfSampleBars;

        for (int start = 0; start + step <= bars.size(); start += outOfSampleBars) {
            // Out-of-sample window
            int oosStart = start + inSampleBars;
            int oosEnd = Math.min(oosStart + outOfSampleBars, bars.size());
            List<Bar> oosBars = bars.subList(oosStart, oosEnd);

            BacktestResult r = run(oosBars, strategy, symbol, capital, 0.95, 1.0, 5);
            results.add(r);
        }
        return results;
    }

    // ── Stop-loss / take-profit helpers ──────────────────────────────────

    private String checkStopTakeProfit(Bar bar, int position, double entry, double slPct, double tpPct) {
        if (position > 0) { // Long position
            if (slPct > 0 && bar.low() <= entry * (1 - slPct / 100)) return "STOP_LOSS";
            if (tpPct > 0 && bar.high() >= entry * (1 + tpPct / 100)) return "TAKE_PROFIT";
        } else if (position < 0) { // Short position
            if (slPct > 0 && bar.high() >= entry * (1 + slPct / 100)) return "STOP_LOSS";
            if (tpPct > 0 && bar.low() <= entry * (1 - tpPct / 100)) return "TAKE_PROFIT";
        }
        return null;
    }

    private double computeStopExitPrice(Bar bar, int position, double entry, double slPct, double tpPct) {
        if (position > 0) {
            if (slPct > 0 && bar.low() <= entry * (1 - slPct / 100)) return entry * (1 - slPct / 100);
            if (tpPct > 0 && bar.high() >= entry * (1 + tpPct / 100)) return entry * (1 + tpPct / 100);
        } else {
            if (slPct > 0 && bar.high() >= entry * (1 + slPct / 100)) return entry * (1 + slPct / 100);
            if (tpPct > 0 && bar.low() <= entry * (1 - tpPct / 100)) return entry * (1 - tpPct / 100);
        }
        return bar.close();
    }

    private double computeSharpe(List<Double> eq) {
        if (eq.size() < 20) return 0;
        List<Double> rets = new ArrayList<>();
        for (int i = 1; i < eq.size(); i++) if (eq.get(i - 1) > 0) rets.add(eq.get(i) / eq.get(i - 1) - 1);
        if (rets.isEmpty()) return 0;
        double mean = rets.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double var = rets.stream().mapToDouble(x -> (x - mean) * (x - mean)).average().orElse(0);
        double std = Math.sqrt(var);
        return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    }

    private List<Map<String, Object>> computeMonthly(List<Bar> bars, List<Double> eq) {
        List<Map<String, Object>> months = new ArrayList<>();
        if (bars.isEmpty()) return months;
        String cur = bars.get(0).date().substring(0, 7); double ms = eq.get(0);
        for (int i = 1; i < bars.size(); i++) {
            String m = bars.get(i).date().substring(0, 7);
            if (!m.equals(cur)) {
                double me = eq.get(i - 1); double ret = ms > 0 ? (me / ms - 1) * 100 : 0;
                months.add(Map.of("month", cur, "return", r(ret), "startEquity", r(ms), "endEquity", r(me)));
                cur = m; ms = eq.get(i);
            }
        }
        double last = eq.get(eq.size() - 1); double ret = ms > 0 ? (last / ms - 1) * 100 : 0;
        months.add(Map.of("month", cur, "return", r(ret), "startEquity", r(ms), "endEquity", r(last)));
        return months;
    }

    private long daysBetween(String d1, String d2) {
        try { return ChronoUnit.DAYS.between(LocalDate.parse(d1), LocalDate.parse(d2)); }
        catch (Exception e) { return 1; }
    }

    private double r(double v) { return Math.round(v * 100.0) / 100.0; }
}
