package com.alphatrade.analysis.finance;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Pure-function finance engine: portfolio rebalancing, FIFO capital-gains, and
 * dividend-income projection. No external service calls — everything is computed
 * from the inputs, which makes it trivially unit-testable.
 */
@Component
public class FinanceEngine {

    // ═══════════════════════════════════════════════════════════════
    // REBALANCING
    // ═══════════════════════════════════════════════════════════════

    public record RebalanceTrade(String symbol, String action, double currentValue,
                                 double targetValue, double tradeValue, double currentWeight,
                                 double targetWeight) {}

    public record RebalancePlan(double totalValue, double cashAdded, double bandPct,
                                List<RebalanceTrade> trades, List<String> notes) {}

    /**
     * Compute the trades needed to move a portfolio from its current dollar
     * allocation to a set of target weights.
     *
     * @param currentValues  symbol → current market value ($)
     * @param targetWeights  symbol → desired weight (need not sum to 1; will be normalized)
     * @param cashToAdd      extra cash to deploy (>=0); included in the target base
     * @param bandPct        no-trade band: positions within this % of target are left alone
     *                       (e.g. 5.0 means "don't bother trading if within 5% of target $")
     */
    public RebalancePlan rebalance(Map<String, Double> currentValues,
                                   Map<String, Double> targetWeights,
                                   double cashToAdd, double bandPct) {
        List<String> notes = new ArrayList<>();
        double currentTotal = currentValues.values().stream()
                .filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum();
        double total = currentTotal + Math.max(0, cashToAdd);

        // Normalize target weights.
        double weightSum = targetWeights.values().stream()
                .filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum();
        if (weightSum <= 0) {
            notes.add("Target weights sum to 0 — nothing to do");
            return new RebalancePlan(round(total), round(cashToAdd), bandPct, List.of(), notes);
        }
        if (Math.abs(weightSum - 1.0) > 0.01) {
            notes.add(String.format("Target weights summed to %.3f; normalized to 1.0", weightSum));
        }

        // Union of symbols (held + targeted).
        Set<String> symbols = new LinkedHashSet<>();
        symbols.addAll(targetWeights.keySet());
        symbols.addAll(currentValues.keySet());

        double band = Math.max(0, bandPct) / 100.0 * total;
        List<RebalanceTrade> trades = new ArrayList<>();
        for (String sym : symbols) {
            double current = currentValues.getOrDefault(sym, 0.0);
            double normWeight = targetWeights.getOrDefault(sym, 0.0) / weightSum;
            double target = normWeight * total;
            double delta = target - current; // +ve = buy, -ve = sell

            String action;
            // At/within the no-trade band (and the exactly-on-target case where
            // delta == 0 and band == 0) → HOLD. The 1e-6 epsilon absorbs FP noise.
            if (Math.abs(delta) <= band + 1e-6) {
                action = "HOLD";
            } else if (delta > 0) {
                action = "BUY";
            } else {
                action = "SELL";
            }
            trades.add(new RebalanceTrade(
                    sym, action,
                    round(current), round(target), round(delta),
                    round(currentTotal > 0 ? current / currentTotal * 100 : 0),
                    round(normWeight * 100)
            ));
        }
        // Surface the biggest moves first.
        trades.sort(Comparator.comparingDouble((RebalanceTrade t) -> -Math.abs(t.tradeValue())));
        return new RebalancePlan(round(total), round(cashToAdd), bandPct, trades, notes);
    }

    // ═══════════════════════════════════════════════════════════════
    // CAPITAL GAINS (FIFO)
    // ═══════════════════════════════════════════════════════════════

    public record TaxLot(String acquired, double qty, double costPerShare) {}

    public record LotMatch(String acquired, double qty, double costBasis, double proceeds,
                           double gain, String term, long holdingDays) {}

    public record CapitalGainsResult(String symbol, double soldQty, double salePrice,
                                     double totalProceeds, double totalCostBasis,
                                     double shortTermGain, double longTermGain, double totalGain,
                                     List<LotMatch> matches, List<TaxLot> remainingLots,
                                     List<String> notes) {}

    /**
     * Compute realized capital gains for a sale using FIFO lot matching, splitting
     * into short-term (held <= 365 days) and long-term (> 365 days).
     */
    public CapitalGainsResult capitalGains(String symbol, List<TaxLot> lotsInput,
                                           double sellQty, double salePrice, String saleDateStr) {
        List<String> notes = new ArrayList<>();
        LocalDate saleDate = parseDate(saleDateStr, LocalDate.now(), notes, "saleDate");

        // FIFO: oldest acquisition first.
        List<TaxLot> lots = new ArrayList<>(lotsInput);
        lots.sort(Comparator.comparing(l -> parseDate(l.acquired(), LocalDate.MIN, notes, "lot")));

        double remainingToSell = sellQty;
        double proceedsTotal = 0, costTotal = 0, shortGain = 0, longGain = 0;
        List<LotMatch> matches = new ArrayList<>();
        List<TaxLot> remaining = new ArrayList<>();

        for (TaxLot lot : lots) {
            if (remainingToSell <= 1e-9) {
                remaining.add(lot);
                continue;
            }
            double take = Math.min(lot.qty(), remainingToSell);
            double proceeds = take * salePrice;
            double cost = take * lot.costPerShare();
            double gain = proceeds - cost;
            long days = ChronoUnit.DAYS.between(
                    parseDate(lot.acquired(), saleDate, notes, "lot"), saleDate);
            String term = days > 365 ? "LONG" : "SHORT";
            if ("LONG".equals(term)) longGain += gain; else shortGain += gain;

            proceedsTotal += proceeds;
            costTotal += cost;
            matches.add(new LotMatch(lot.acquired(), round(take), round(cost), round(proceeds),
                    round(gain), term, days));

            double leftover = lot.qty() - take;
            if (leftover > 1e-9) remaining.add(new TaxLot(lot.acquired(), round(leftover), lot.costPerShare()));
            remainingToSell -= take;
        }

        if (remainingToSell > 1e-9) {
            notes.add(String.format("Requested to sell %.4f shares but only %.4f available in lots",
                    sellQty, sellQty - remainingToSell));
        }

        return new CapitalGainsResult(symbol, round(sellQty - Math.max(0, remainingToSell)), salePrice,
                round(proceedsTotal), round(costTotal), round(shortGain), round(longGain),
                round(shortGain + longGain), matches, remaining, notes);
    }

    // ═══════════════════════════════════════════════════════════════
    // DIVIDEND PROJECTION
    // ═══════════════════════════════════════════════════════════════

    public record DividendHolding(String symbol, double shares, double annualDividendPerShare,
                                  double price) {}

    public record DividendLine(String symbol, double annualIncome, double yieldPct, double monthlyAvg) {}

    public record DividendProjection(double totalAnnualIncome, double totalMonthlyAvg,
                                     double portfolioYieldPct, List<DividendLine> lines) {}

    /** Project annual & monthly dividend income and yield for a set of holdings. */
    public DividendProjection dividendProjection(List<DividendHolding> holdings) {
        List<DividendLine> lines = new ArrayList<>();
        double totalIncome = 0, totalValue = 0;
        for (DividendHolding h : holdings) {
            double income = h.shares() * h.annualDividendPerShare();
            double value = h.shares() * h.price();
            double yield = value > 0 ? income / value * 100 : 0;
            lines.add(new DividendLine(h.symbol(), round(income), round(yield), round(income / 12.0)));
            totalIncome += income;
            totalValue += value;
        }
        lines.sort(Comparator.comparingDouble((DividendLine l) -> -l.annualIncome()));
        double portYield = totalValue > 0 ? totalIncome / totalValue * 100 : 0;
        return new DividendProjection(round(totalIncome), round(totalIncome / 12.0),
                round(portYield), lines);
    }

    // ── helpers ──
    private LocalDate parseDate(String s, LocalDate fallback, List<String> notes, String label) {
        if (s == null || s.isBlank()) return fallback;
        try {
            return LocalDate.parse(s.trim().substring(0, Math.min(10, s.trim().length())));
        } catch (Exception e) {
            notes.add("Could not parse " + label + " date '" + s + "', used " + fallback);
            return fallback;
        }
    }

    private double round(double v) { return Math.round(v * 100.0) / 100.0; }
}
