package com.alphatrade.backtest.strategy;

import com.alphatrade.backtest.model.Bar;
import java.util.*;
import java.util.stream.Stream;

/**
 * JSON/Map-based Strategy Definition Language.
 * Allows users to define custom strategies without writing Java.
 *
 * Example JSON:
 * {
 *   "name": "my_custom_strat",
 *   "entry": [
 *     {"indicator": "rsi", "period": 14, "operator": "<", "value": 35},
 *     {"indicator": "price", "operator": ">", "reference": "sma", "period": 200}
 *   ],
 *   "exit": [
 *     {"indicator": "rsi", "period": 14, "operator": ">", "value": 65}
 *   ],
 *   "logic": "ALL"
 * }
 *
 * Supported indicators: price, sma, ema, rsi, volume, lorentzian
 * Supported operators: >, <, >=, <=, crosses_above, crosses_below
 * Logic: ALL (all conditions must be true) or ANY (at least one)
 */
public class StrategyDSL {

    public record Condition(String indicator, int period, String operator,
                            double value, String reference, int refPeriod) {}

    public record StrategyDef(String name, List<Condition> entry,
                              List<Condition> exit, String logic) {}

    /** Parse a strategy definition from a Map (deserialized JSON) */
    public static Strategy fromMap(Map<String, Object> def) {
        String name = (String) def.getOrDefault("name", "CUSTOM");
        String logic = (String) def.getOrDefault("logic", "ALL");
        List<Condition> entry = parseConditions((List<Map<String, Object>>) def.getOrDefault("entry", List.of()));
        List<Condition> exit = parseConditions((List<Map<String, Object>>) def.getOrDefault("exit", List.of()));

        return new Strategy() {
            @Override
            public String name() { return "DSL_" + name.toUpperCase(); }

            @Override
            public int signal(List<Bar> bars, int idx, Map<String, Object> state) {
                int lookback = requiredLookback(entry, exit);
                if (idx < lookback) return 0;

                boolean inPosition = state.containsKey("_inPosition") && (boolean) state.get("_inPosition");

                if (!inPosition) {
                    boolean entrySignal = evaluateConditions(entry, bars, idx, logic.equals("ALL"));
                    boolean prevEntry = evaluateConditions(entry, bars, idx - 1, logic.equals("ALL"));
                    // Trigger on transition (wasn't true → now true)
                    if (entrySignal && !prevEntry) {
                        state.put("_inPosition", true);
                        return 1;
                    }
                } else {
                    boolean exitSignal = evaluateConditions(exit, bars, idx, logic.equals("ALL"));
                    boolean prevExit = evaluateConditions(exit, bars, idx - 1, logic.equals("ALL"));
                    if (exitSignal && !prevExit) {
                        state.put("_inPosition", false);
                        return -1;
                    }
                }
                return 0;
            }
        };
    }

    private static boolean evaluateConditions(List<Condition> conditions, List<Bar> bars, int idx, boolean requireAll) {
        if (conditions.isEmpty()) return false;
        for (Condition c : conditions) {
            boolean met = evaluateCondition(c, bars, idx);
            if (requireAll && !met) return false;
            if (!requireAll && met) return true;
        }
        return requireAll;
    }

    private static boolean evaluateCondition(Condition c, List<Bar> bars, int idx) {
        double lhs = getIndicatorValue(c, bars, idx);
        double rhs;
        if (c.reference != null && !c.reference.isBlank()) {
            rhs = getIndicatorValue(c.reference, c.refPeriod > 0 ? c.refPeriod : c.period, bars, idx);
        } else {
            rhs = c.value;
        }

        if (Double.isNaN(lhs) || Double.isNaN(rhs)) return false;

        return switch (c.operator) {
            case ">" -> lhs > rhs;
            case "<" -> lhs < rhs;
            case ">=" -> lhs >= rhs;
            case "<=" -> lhs <= rhs;
            case "crosses_above" -> {
                double prevLhs = getIndicatorValue(c, bars, idx - 1);
                double prevRhs = c.reference != null
                    ? getIndicatorValue(c.reference, c.refPeriod > 0 ? c.refPeriod : c.period, bars, idx - 1)
                    : c.value;
                yield prevLhs <= prevRhs && lhs > rhs;
            }
            case "crosses_below" -> {
                double prevLhs = getIndicatorValue(c, bars, idx - 1);
                double prevRhs = c.reference != null
                    ? getIndicatorValue(c.reference, c.refPeriod > 0 ? c.refPeriod : c.period, bars, idx - 1)
                    : c.value;
                yield prevLhs >= prevRhs && lhs < rhs;
            }
            default -> false;
        };
    }

    private static int requiredLookback(List<Condition> entry, List<Condition> exit) {
        return Math.max(1, Stream.concat(entry.stream(), exit.stream())
            .mapToInt(StrategyDSL::requiredLookback)
            .max()
            .orElse(1));
    }

    private static int requiredLookback(Condition c) {
        int period = Math.max(1, c.period());
        int referencePeriod = c.reference() != null && !c.reference().isBlank()
            ? Math.max(1, c.refPeriod() > 0 ? c.refPeriod() : c.period())
            : 1;
        int base = Math.max(indicatorLookback(c.indicator(), period), indicatorLookback(c.reference(), referencePeriod));
        return switch (c.operator()) {
            case "crosses_above", "crosses_below" -> base + 1;
            default -> base;
        };
    }

    private static int indicatorLookback(String indicator, int period) {
        if (indicator == null || indicator.isBlank()) return 1;
        return switch (indicator.toLowerCase()) {
            case "sma", "ema" -> period;
            case "rsi" -> period + 1;
            case "lorentzian" -> Math.max(30, period + 5);
            default -> 1;
        };
    }

    private static double getIndicatorValue(Condition c, List<Bar> bars, int idx) {
        if ("lorentzian".equalsIgnoreCase(c.indicator())) {
            int lookback = Math.max(30, c.period());
            int neighbors = Math.max(3, c.refPeriod() > 0 ? c.refPeriod() : 8);
            return lorentzianScore(bars, idx, lookback, neighbors);
        }
        return getIndicatorValue(c.indicator, c.period, bars, idx);
    }

    private static double getIndicatorValue(String indicator, int period, List<Bar> bars, int idx) {
        if (idx < 0 || idx >= bars.size()) return Double.NaN;
        return switch (indicator.toLowerCase()) {
            case "price", "close" -> bars.get(idx).close();
            case "open" -> bars.get(idx).open();
            case "high" -> bars.get(idx).high();
            case "low" -> bars.get(idx).low();
            case "volume" -> bars.get(idx).volume();
            case "sma" -> {
                if (idx < period - 1) yield Double.NaN;
                double sum = 0;
                for (int i = idx - period + 1; i <= idx; i++) sum += bars.get(i).close();
                yield sum / period;
            }
            case "ema" -> {
                if (idx < period - 1) yield Double.NaN;
                double mult = 2.0 / (period + 1);
                double ema = 0;
                for (int i = 0; i < period; i++) ema += bars.get(i).close();
                ema /= period;
                for (int i = period; i <= idx; i++) ema = (bars.get(i).close() - ema) * mult + ema;
                yield ema;
            }
            case "rsi" -> {
                if (idx < period + 1) yield Double.NaN;
                yield Strategy.calcRsi(bars, idx, period);
            }
            case "lorentzian" -> lorentzianScore(bars, idx, Math.max(30, period), 8);
            default -> Double.NaN;
        };
    }

    /**
     * Lorentzian nearest-neighbor classifier inspired by the popular TradingView
     * indicator family. It returns a score in [-1, 1], where positive values mean
     * similar historical states tended to rise over the next four bars.
     *
     * Leakage guard: at idx, candidate neighbors end at idx - horizon, so the
     * neighbor label is known historically without using future data from idx.
     */
    private static double lorentzianScore(List<Bar> bars, int idx, int lookback, int neighbors) {
        int horizon = 4;
        if (idx < Math.max(lookback, 30) || idx >= bars.size()) return Double.NaN;

        double[] current = lorentzianFeatures(bars, idx);
        if (hasNaN(current)) return Double.NaN;

        PriorityQueue<double[]> best = new PriorityQueue<>(Comparator.comparingDouble(a -> -a[0]));
        int start = Math.max(15, idx - lookback);
        int end = idx - horizon;
        for (int j = start; j <= end; j++) {
            double[] candidate = lorentzianFeatures(bars, j);
            if (hasNaN(candidate)) continue;
            double label = Math.signum(bars.get(j + horizon).close() - bars.get(j).close());
            if (label == 0) continue;
            double distance = 0;
            for (int f = 0; f < current.length; f++) {
                distance += Math.log1p(Math.abs(current[f] - candidate[f]));
            }
            best.offer(new double[] { distance, label });
            if (best.size() > neighbors) best.poll();
        }

        if (best.isEmpty()) return Double.NaN;
        double weighted = 0;
        double weightSum = 0;
        for (double[] item : best) {
            double weight = 1.0 / (1.0 + item[0]);
            weighted += item[1] * weight;
            weightSum += weight;
        }
        return weightSum == 0 ? Double.NaN : weighted / weightSum;
    }

    private static double[] lorentzianFeatures(List<Bar> bars, int idx) {
        if (idx < 15) return new double[] { Double.NaN };
        double close = bars.get(idx).close();
        double prev = bars.get(idx - 1).close();
        double close3 = bars.get(idx - 3).close();
        double close10 = bars.get(idx - 10).close();
        double vol = bars.get(idx).volume();
        double vol5 = 0;
        for (int i = idx - 4; i <= idx; i++) vol5 += bars.get(i).volume();
        vol5 /= 5.0;
        return new double[] {
            prev == 0 ? 0 : (close / prev) - 1.0,
            close3 == 0 ? 0 : (close / close3) - 1.0,
            close10 == 0 ? 0 : (close / close10) - 1.0,
            Strategy.calcRsi(bars, idx, 14) / 100.0,
            vol5 == 0 ? 0 : (vol / vol5) - 1.0,
        };
    }

    private static boolean hasNaN(double[] values) {
        for (double value : values) {
            if (Double.isNaN(value) || Double.isInfinite(value)) return true;
        }
        return false;
    }

    private static List<Condition> parseConditions(List<Map<String, Object>> raw) {
        List<Condition> conditions = new ArrayList<>();
        for (Map<String, Object> m : raw) {
            conditions.add(new Condition(
                (String) m.getOrDefault("indicator", "price"),
                m.containsKey("period") ? ((Number) m.get("period")).intValue() : 14,
                (String) m.getOrDefault("operator", ">"),
                m.containsKey("value") ? ((Number) m.get("value")).doubleValue() : 0,
                (String) m.get("reference"),
                m.containsKey("refPeriod") ? ((Number) m.get("refPeriod")).intValue() : 0
            ));
        }
        return conditions;
    }
}
