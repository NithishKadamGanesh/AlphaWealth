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
 * Supported indicators: price, sma, ema, rsi, volume
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
        double lhs = getIndicatorValue(c.indicator, c.period, bars, idx);
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
                double prevLhs = getIndicatorValue(c.indicator, c.period, bars, idx - 1);
                double prevRhs = c.reference != null
                    ? getIndicatorValue(c.reference, c.refPeriod > 0 ? c.refPeriod : c.period, bars, idx - 1)
                    : c.value;
                yield prevLhs <= prevRhs && lhs > rhs;
            }
            case "crosses_below" -> {
                double prevLhs = getIndicatorValue(c.indicator, c.period, bars, idx - 1);
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
            default -> 1;
        };
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
            default -> Double.NaN;
        };
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
