package com.alphatrade.analysis.finance;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class FinanceEngineTest {

    private final FinanceEngine engine = new FinanceEngine();

    // ── Rebalancing ──────────────────────────────────────────────

    @Test
    void rebalanceSuggestsBuyAndSellToHitTargets() {
        // Current: 12k AAPL / 8k VOO (60/40). Target 40/60 → sell AAPL, buy VOO.
        var plan = engine.rebalance(
                Map.of("AAPL", 12000.0, "VOO", 8000.0),
                Map.of("AAPL", 0.40, "VOO", 0.60),
                0, 0);
        assertThat(plan.totalValue()).isCloseTo(20000.0, within(0.01));

        var aapl = plan.trades().stream().filter(t -> t.symbol().equals("AAPL")).findFirst().orElseThrow();
        var voo = plan.trades().stream().filter(t -> t.symbol().equals("VOO")).findFirst().orElseThrow();
        assertThat(aapl.action()).isEqualTo("SELL");
        assertThat(aapl.tradeValue()).isCloseTo(-4000.0, within(0.01)); // 12k → 8k
        assertThat(voo.action()).isEqualTo("BUY");
        assertThat(voo.tradeValue()).isCloseTo(4000.0, within(0.01));   // 8k → 12k
    }

    @Test
    void rebalanceNormalizesUnnormalizedWeights() {
        var plan = engine.rebalance(
                Map.of("A", 5000.0, "B", 5000.0),
                Map.of("A", 1.0, "B", 1.0), // sums to 2 → 50/50
                0, 0);
        assertThat(plan.notes()).anyMatch(n -> n.contains("normalized"));
        assertThat(plan.trades()).allMatch(t -> t.action().equals("HOLD"));
    }

    @Test
    void rebalanceRespectsNoTradeBand() {
        // Slightly off target but within a 10% band → all HOLD.
        var plan = engine.rebalance(
                Map.of("A", 5200.0, "B", 4800.0),
                Map.of("A", 0.5, "B", 0.5),
                0, 10.0);
        assertThat(plan.trades()).allMatch(t -> t.action().equals("HOLD"));
    }

    @Test
    void rebalanceDeploysAddedCash() {
        var plan = engine.rebalance(
                Map.of("A", 10000.0),
                Map.of("A", 1.0),
                5000.0, 0);
        assertThat(plan.totalValue()).isCloseTo(15000.0, within(0.01));
        var a = plan.trades().get(0);
        assertThat(a.action()).isEqualTo("BUY");
        assertThat(a.tradeValue()).isCloseTo(5000.0, within(0.01));
    }

    // ── Capital gains (FIFO) ─────────────────────────────────────

    @Test
    void capitalGainsFifoSplitsShortAndLongTerm() {
        // Two lots: old (long-term) + recent (short-term). Sell 40 shares @ $150.
        var lots = List.of(
                new FinanceEngine.TaxLot("2022-01-01", 30, 100), // long-term
                new FinanceEngine.TaxLot("2026-03-01", 30, 120)   // short-term (sale 2026-06-01)
        );
        var res = engine.capitalGains("AAPL", lots, 40, 150, "2026-06-01");

        // FIFO: 30 from old lot (LT), 10 from new lot (ST)
        assertThat(res.soldQty()).isCloseTo(40.0, within(0.001));
        // LT gain: 30 * (150-100) = 1500
        assertThat(res.longTermGain()).isCloseTo(1500.0, within(0.01));
        // ST gain: 10 * (150-120) = 300
        assertThat(res.shortTermGain()).isCloseTo(300.0, within(0.01));
        assertThat(res.totalGain()).isCloseTo(1800.0, within(0.01));
        // Remaining: 20 shares of the recent lot
        assertThat(res.remainingLots()).hasSize(1);
        assertThat(res.remainingLots().get(0).qty()).isCloseTo(20.0, within(0.001));
    }

    @Test
    void capitalGainsFlagsOverSell() {
        var lots = List.of(new FinanceEngine.TaxLot("2024-01-01", 10, 50));
        var res = engine.capitalGains("X", lots, 25, 60, "2026-01-01");
        assertThat(res.soldQty()).isCloseTo(10.0, within(0.001)); // only 10 available
        assertThat(res.notes()).anyMatch(n -> n.toLowerCase().contains("only"));
    }

    // ── Dividends ────────────────────────────────────────────────

    @Test
    void dividendProjectionComputesIncomeAndYield() {
        var proj = engine.dividendProjection(List.of(
                new FinanceEngine.DividendHolding("VOO", 40, 6.50, 500),  // $260/yr, value 20000 → 1.3%
                new FinanceEngine.DividendHolding("T", 100, 1.11, 18)     // $111/yr, value 1800 → 6.17%
        ));
        assertThat(proj.totalAnnualIncome()).isCloseTo(371.0, within(0.5));
        assertThat(proj.totalMonthlyAvg()).isCloseTo(371.0 / 12.0, within(0.5));
        // Sorted: VOO ($260) before T ($111)
        assertThat(proj.lines().get(0).symbol()).isEqualTo("VOO");
    }
}
