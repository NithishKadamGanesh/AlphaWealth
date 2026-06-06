package com.alphatrade.backtest.engine;

import com.alphatrade.backtest.model.Bar;
import com.alphatrade.backtest.model.BacktestResult;
import com.alphatrade.backtest.strategy.Strategy;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class BacktestEngineTest {

    private final BacktestEngine engine = new BacktestEngine();

    /** Build a simple bar series from a list of closes (OHLC flat = close). */
    private List<Bar> barsFromCloses(double... closes) {
        List<Bar> bars = new ArrayList<>();
        for (int i = 0; i < closes.length; i++) {
            double c = closes[i];
            bars.add(new Bar(String.format("2024-01-%02d", (i % 28) + 1), c, c, c, c, 1_000_000));
        }
        return bars;
    }

    @Test
    void buyAndHoldProfitsInRisingMarket() {
        // Steady climb 100 → 150
        double[] closes = new double[51];
        for (int i = 0; i < closes.length; i++) closes[i] = 100 + i;
        BacktestResult r = engine.run(barsFromCloses(closes), Strategy.buyAndHold(),
                "TEST", 10000, 0.95, 0, 0);
        assertThat(r.totalPnl()).isPositive();
        assertThat(r.endingCapital()).isGreaterThan(r.startingCapital());
        assertThat(r.totalTrades()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void noTradesLeavesCapitalUnchanged() {
        // A strategy that never signals → capital unchanged, no trades.
        Strategy noop = new Strategy() {
            public String name() { return "NOOP"; }
            public int signal(List<Bar> bars, int idx, java.util.Map<String, Object> state) { return 0; }
        };
        BacktestResult r = engine.run(barsFromCloses(100, 101, 102, 103, 104, 105),
                noop, "TEST", 10000, 0.95, 0, 0);
        assertThat(r.totalTrades()).isZero();
        assertThat(r.endingCapital()).isCloseTo(10000.0, within(0.001));
    }

    @Test
    void positionPctIsClampedAndNeverGoesNegativeCash() {
        // positionPct > 1 must be clamped so we never spend more than we have.
        double[] closes = new double[60];
        for (int i = 0; i < closes.length; i++) closes[i] = 100 + (i % 5); // choppy
        BacktestResult r = engine.run(barsFromCloses(closes), Strategy.smaCrossover(3, 5),
                "TEST", 10000, 5.0 /* absurd */, 1.0, 5);
        // Equity should never be wildly negative; ending capital stays finite and sane.
        assertThat(r.endingCapital()).isGreaterThan(-1.0);
        assertThat(r.equityCurve()).allSatisfy(eq -> assertThat(eq).isGreaterThan(-1.0));
    }

    @Test
    void stopLossExitsLongOnIntrabarLow() {
        // Enter long via buy-and-hold, then a bar with a deep low should trigger stop.
        List<Bar> bars = new ArrayList<>();
        bars.add(new Bar("2024-01-01", 100, 101, 99, 100, 1_000_000)); // entry bar (buyAndHold buys idx0)
        // subsequent bar gaps down: low pierces 5% stop (95)
        for (int i = 1; i < 10; i++) {
            bars.add(new Bar(String.format("2024-01-%02d", i + 1), 100, 100, 90, 92, 1_000_000));
        }
        BacktestResult r = engine.run(bars, Strategy.buyAndHold(), "TEST", 10000, 0.95, 0, 0,
                5.0 /* stopLossPct */, 0);
        assertThat(r.trades()).isNotEmpty();
        assertThat(r.trades().get(0).exitReason()).isEqualTo("STOP_LOSS");
    }

    @Test
    void drawdownIsNonNegative() {
        double[] closes = {100, 110, 90, 120, 80, 130};
        BacktestResult r = engine.run(barsFromCloses(closes), Strategy.buyAndHold(),
                "TEST", 10000, 0.95, 0, 0);
        assertThat(r.maxDrawdown()).isGreaterThanOrEqualTo(0.0);
        assertThat(r.maxDrawdownPct()).isGreaterThanOrEqualTo(0.0);
    }

    @Test
    void winRateWithinBounds() {
        double[] closes = new double[80];
        for (int i = 0; i < closes.length; i++) closes[i] = 100 + 10 * Math.sin(i / 3.0);
        BacktestResult r = engine.run(barsFromCloses(closes), Strategy.smaCrossover(3, 8),
                "TEST", 10000, 0.5, 0.5, 5);
        assertThat(r.winRate()).isBetween(0.0, 100.0);
    }
}
