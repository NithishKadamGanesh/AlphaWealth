package com.alphatrade.analysis.options;

import org.springframework.stereotype.Component;
import java.util.*;

/**
 * Black-Scholes options pricing and Greeks calculator.
 *
 * Supports:
 *   - Call/Put pricing
 *   - Delta, Gamma, Theta, Vega, Rho
 *   - Implied volatility (Newton-Raphson)
 *   - Strategy payoff analysis (covered call, spreads, iron condor, straddle)
 */
@Component
public class OptionsEngine {

    public record OptionPrice(String type, double strike, double expDays, double spot,
                               double vol, double rate, double price, double intrinsic,
                               double timeValue, Greeks greeks) {}

    public record Greeks(double delta, double gamma, double theta, double vega, double rho) {}

    public record StrategyLeg(String type, double strike, int qty, double premium) {}

    public record StrategyPayoff(String name, List<StrategyLeg> legs, double maxProfit,
                                  double maxLoss, double breakeven, List<double[]> payoffCurve) {}

    // ═══════════════════════════════════════════════════════════════
    // BLACK-SCHOLES PRICING
    // ═══════════════════════════════════════════════════════════════

    /**
     * Price a European option using Black-Scholes.
     * @param type   "CALL" or "PUT"
     * @param spot   Current underlying price
     * @param strike Strike price
     * @param days   Days to expiration
     * @param vol    Annualized volatility (e.g. 0.25 = 25%)
     * @param rate   Risk-free rate (e.g. 0.05 = 5%)
     */
    public OptionPrice price(String type, double spot, double strike, double days, double vol, double rate) {
        double t = days / 365.0;
        if (t <= 0 || vol <= 0 || spot <= 0 || strike <= 0) {
            return new OptionPrice(type, strike, days, spot, vol, rate, 0, 0, 0,
                new Greeks(0, 0, 0, 0, 0));
        }

        double d1 = d1(spot, strike, t, vol, rate);
        double d2 = d2(d1, vol, t);

        double price, delta;
        boolean isCall = "CALL".equalsIgnoreCase(type);

        if (isCall) {
            price = spot * cdf(d1) - strike * Math.exp(-rate * t) * cdf(d2);
            delta = cdf(d1);
        } else {
            price = strike * Math.exp(-rate * t) * cdf(-d2) - spot * cdf(-d1);
            delta = cdf(d1) - 1;
        }

        double gamma = pdf(d1) / (spot * vol * Math.sqrt(t));
        double theta = (-spot * pdf(d1) * vol / (2 * Math.sqrt(t))
            - rate * strike * Math.exp(-rate * t) * (isCall ? cdf(d2) : cdf(-d2))) / 365.0;
        double vega = spot * pdf(d1) * Math.sqrt(t) / 100.0;
        double rho = (isCall
            ? strike * t * Math.exp(-rate * t) * cdf(d2)
            : -strike * t * Math.exp(-rate * t) * cdf(-d2)) / 100.0;

        double intrinsic = isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
        double timeVal = Math.max(price - intrinsic, 0);

        return new OptionPrice(type, strike, days, spot, vol, rate,
            r(price), r(intrinsic), r(timeVal),
            new Greeks(r4(delta), r4(gamma), r4(theta), r4(vega), r4(rho)));
    }

    // ═══════════════════════════════════════════════════════════════
    // IMPLIED VOLATILITY (Newton-Raphson)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Calculate implied volatility from market price.
     * Uses Newton-Raphson iteration.
     */
    public double impliedVolatility(String type, double marketPrice, double spot,
                                     double strike, double days, double rate) {
        double t = days / 365.0;
        if (t <= 0 || marketPrice <= 0) return 0;

        double vol = 0.25; // initial guess
        for (int i = 0; i < 100; i++) {
            double d1 = d1(spot, strike, t, vol, rate);
            double d2 = d2(d1, vol, t);

            double bsPrice;
            if ("CALL".equalsIgnoreCase(type)) {
                bsPrice = spot * cdf(d1) - strike * Math.exp(-rate * t) * cdf(d2);
            } else {
                bsPrice = strike * Math.exp(-rate * t) * cdf(-d2) - spot * cdf(-d1);
            }

            double vega = spot * pdf(d1) * Math.sqrt(t);
            if (Math.abs(vega) < 1e-10) break;

            double diff = bsPrice - marketPrice;
            if (Math.abs(diff) < 0.001) break;

            vol -= diff / vega;
            vol = Math.max(0.01, Math.min(vol, 5.0)); // clamp
        }
        return r4(vol);
    }

    // ═══════════════════════════════════════════════════════════════
    // OPTIONS STRATEGY ANALYSIS
    // ═══════════════════════════════════════════════════════════════

    /** Analyze a multi-leg options strategy payoff */
    public StrategyPayoff analyzeStrategy(String name, double spot, List<StrategyLeg> legs) {
        double minStrike = legs.stream().mapToDouble(StrategyLeg::strike).min().orElse(spot);
        double maxStrike = legs.stream().mapToDouble(StrategyLeg::strike).max().orElse(spot);
        double range = Math.max(maxStrike - minStrike, spot * 0.1);

        double priceLow = minStrike - range;
        double priceHigh = maxStrike + range;
        double step = (priceHigh - priceLow) / 100;

        List<double[]> curve = new ArrayList<>();
        double maxProfit = Double.NEGATIVE_INFINITY;
        double maxLoss = Double.POSITIVE_INFINITY;

        for (double px = priceLow; px <= priceHigh; px += step) {
            double pnl = 0;
            for (StrategyLeg leg : legs) {
                double legPnl;
                if ("STOCK".equalsIgnoreCase(leg.type)) {
                    legPnl = px - leg.premium;
                } else if ("CALL".equalsIgnoreCase(leg.type)) {
                    legPnl = Math.max(px - leg.strike, 0) - leg.premium;
                } else {
                    legPnl = Math.max(leg.strike - px, 0) - leg.premium;
                }
                pnl += legPnl * leg.qty; // qty is negative for shorts
            }
            curve.add(new double[]{r(px), r(pnl)});
            maxProfit = Math.max(maxProfit, pnl);
            maxLoss = Math.min(maxLoss, pnl);
        }

        // Find breakeven (where PnL crosses zero)
        double breakeven = spot;
        for (int i = 1; i < curve.size(); i++) {
            if (curve.get(i - 1)[1] * curve.get(i)[1] < 0) {
                breakeven = (curve.get(i - 1)[0] + curve.get(i)[0]) / 2;
                break;
            }
        }

        return new StrategyPayoff(name, legs, r(maxProfit), r(maxLoss), r(breakeven), curve);
    }

    /** Preset: Covered Call */
    public StrategyPayoff coveredCall(double spot, double callStrike, double callPremium) {
        return analyzeStrategy("Covered Call", spot, List.of(
            new StrategyLeg("STOCK", 0, 1, spot),
            new StrategyLeg("CALL", callStrike, -1, callPremium) // short call
        ));
    }

    /** Preset: Bull Call Spread */
    public StrategyPayoff bullCallSpread(double spot, double buyStrike, double sellStrike,
                                          double buyPrem, double sellPrem) {
        return analyzeStrategy("Bull Call Spread", spot, List.of(
            new StrategyLeg("CALL", buyStrike, 1, buyPrem),
            new StrategyLeg("CALL", sellStrike, -1, sellPrem)
        ));
    }

    /** Preset: Iron Condor */
    public StrategyPayoff ironCondor(double spot, double putBuyStrike, double putSellStrike,
                                      double callSellStrike, double callBuyStrike,
                                      double putBuyPrem, double putSellPrem,
                                      double callSellPrem, double callBuyPrem) {
        return analyzeStrategy("Iron Condor", spot, List.of(
            new StrategyLeg("PUT", putBuyStrike, 1, putBuyPrem),
            new StrategyLeg("PUT", putSellStrike, -1, putSellPrem),
            new StrategyLeg("CALL", callSellStrike, -1, callSellPrem),
            new StrategyLeg("CALL", callBuyStrike, 1, callBuyPrem)
        ));
    }

    /** Preset: Straddle */
    public StrategyPayoff straddle(double spot, double strike, double callPrem, double putPrem) {
        return analyzeStrategy("Straddle", spot, List.of(
            new StrategyLeg("CALL", strike, 1, callPrem),
            new StrategyLeg("PUT", strike, 1, putPrem)
        ));
    }

    // ═══════════════════════════════════════════════════════════════
    // MATH HELPERS
    // ═══════════════════════════════════════════════════════════════

    private double d1(double s, double k, double t, double v, double r) {
        return (Math.log(s / k) + (r + v * v / 2) * t) / (v * Math.sqrt(t));
    }

    private double d2(double d1, double v, double t) {
        return d1 - v * Math.sqrt(t);
    }

    /** Standard normal CDF approximation (Abramowitz & Stegun) */
    private double cdf(double x) {
        if (x > 6) return 1; if (x < -6) return 0;
        double b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937, b4 = -1.821255978, b5 = 1.330274429;
        double p = 0.2316419;
        double t = 1.0 / (1.0 + p * Math.abs(x));
        double y = 1.0 - pdf(x) * (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
        return x >= 0 ? y : 1 - y;
    }

    /** Standard normal PDF */
    private double pdf(double x) {
        return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
    }

    private double r(double v) { return Math.round(v * 100.0) / 100.0; }
    private double r4(double v) { return Math.round(v * 10000.0) / 10000.0; }
}
