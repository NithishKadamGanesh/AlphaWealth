package com.alphatrade.analysis.options;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * Unit tests for Black-Scholes pricing, Greeks, and the implied-volatility solver.
 * Reference values computed against standard BS formulas.
 */
class OptionsEngineTest {

    private final OptionsEngine engine = new OptionsEngine();

    @Test
    void atmCallPriceIsReasonable() {
        // S=100, K=100, 1 year, vol=20%, r=5% → BS call ≈ 10.45
        var p = engine.price("CALL", 100, 100, 365, 0.20, 0.05);
        assertThat(p.price()).isCloseTo(10.45, within(0.10));
    }

    @Test
    void atmPutPriceIsReasonable() {
        // Same params → BS put ≈ 5.57
        var p = engine.price("PUT", 100, 100, 365, 0.20, 0.05);
        assertThat(p.price()).isCloseTo(5.57, within(0.10));
    }

    @Test
    void putCallParityHolds() {
        // C - P = S - K*e^(-rT)
        double s = 100, k = 100, r = 0.05, tYears = 1.0;
        var call = engine.price("CALL", s, k, 365, 0.25, r);
        var put = engine.price("PUT", s, k, 365, 0.25, r);
        double lhs = call.price() - put.price();
        double rhs = s - k * Math.exp(-r * tYears);
        assertThat(lhs).isCloseTo(rhs, within(0.10));
    }

    @Test
    void callDeltaBetweenZeroAndOne() {
        var p = engine.price("CALL", 100, 100, 365, 0.20, 0.05);
        assertThat(p.greeks().delta()).isBetween(0.0, 1.0);
    }

    @Test
    void putDeltaBetweenMinusOneAndZero() {
        var p = engine.price("PUT", 100, 100, 365, 0.20, 0.05);
        assertThat(p.greeks().delta()).isBetween(-1.0, 0.0);
    }

    @Test
    void deepInTheMoneyCallIsMostlyIntrinsic() {
        var p = engine.price("CALL", 200, 100, 30, 0.20, 0.05);
        assertThat(p.intrinsic()).isGreaterThan(99.0);
        assertThat(p.price()).isGreaterThanOrEqualTo(p.intrinsic());
    }

    @Test
    void impliedVolRecoversInputVol() {
        // Price an option at a known vol, then solve IV from that price.
        double trueVol = 0.30;
        var priced = engine.price("CALL", 100, 105, 90, trueVol, 0.05);
        double iv = engine.impliedVolatility("CALL", priced.price(), 100, 105, 90, 0.05);
        assertThat(iv).isCloseTo(trueVol, within(0.01));
    }

    @Test
    void impliedVolRecoversInputVolForPut() {
        double trueVol = 0.45;
        var priced = engine.price("PUT", 100, 95, 180, trueVol, 0.03);
        double iv = engine.impliedVolatility("PUT", priced.price(), 100, 95, 180, 0.03);
        assertThat(iv).isCloseTo(trueVol, within(0.01));
    }

    @Test
    void impliedVolReturnsZeroForImpossiblePrice() {
        // A price above the underlying is arbitrage-impossible for a call → no root.
        double iv = engine.impliedVolatility("CALL", 500, 100, 100, 30, 0.05);
        assertThat(iv).isZero();
    }

    @Test
    void impliedVolTerminatesForExpiredOption() {
        // t<=0 short-circuits; must not loop.
        double iv = engine.impliedVolatility("CALL", 5.0, 100, 100, 0, 0.05);
        assertThat(iv).isZero();
    }

    @Test
    void zeroVolReturnsZeroPriceGracefully() {
        var p = engine.price("CALL", 100, 100, 30, 0.0, 0.05);
        assertThat(p.price()).isZero();
    }

    @Test
    void bullCallSpreadHasBoundedProfitAndLoss() {
        var payoff = engine.bullCallSpread(100, 100, 110, 5, 2);
        // Net debit = 3; max profit = width(10) - debit(3) = 7; max loss = debit = 3
        assertThat(payoff.maxProfit()).isCloseTo(7.0, within(0.5));
        assertThat(payoff.maxLoss()).isCloseTo(-3.0, within(0.5));
    }
}
