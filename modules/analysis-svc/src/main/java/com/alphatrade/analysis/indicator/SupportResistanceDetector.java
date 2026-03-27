package com.alphatrade.analysis.indicator;

import com.alphatrade.analysis.model.Candle;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class SupportResistanceDetector {

    public record Level(double price, String type, int touches, double strength, String description) {}

    public List<Level> detect(List<Candle> candles, int lookback) {
        if (candles.size() < 20) return Collections.emptyList();
        List<Candle> recent = candles.subList(Math.max(0, candles.size() - lookback), candles.size());
        double cp = recent.get(recent.size()-1).close();
        List<Double> sHP = new ArrayList<>(), sLP = new ArrayList<>();
        int sw = 5;
        for (int i = sw; i < recent.size() - sw; i++) {
            boolean isH = true, isL = true;
            for (int j = i - sw; j <= i + sw; j++) {
                if (j != i) { if (recent.get(j).high() >= recent.get(i).high()) isH = false; if (recent.get(j).low() <= recent.get(i).low()) isL = false; }
            }
            if (isH) sHP.add(recent.get(i).high()); if (isL) sLP.add(recent.get(i).low());
        }
        List<Level> levels = new ArrayList<>();
        levels.addAll(cluster(sHP, cp, "RESISTANCE", 0.005));
        levels.addAll(cluster(sLP, cp, "SUPPORT", 0.005));
        levels.addAll(roundNumbers(cp));
        levels.sort(Comparator.comparingDouble(Level::strength).reversed());
        return dedup(levels, cp * 0.008);
    }

    public List<Level> detect(List<Candle> candles) { return detect(candles, 200); }

    private List<Level> cluster(List<Double> prices, double cp, String type, double tol) {
        if (prices.isEmpty()) return Collections.emptyList();
        Collections.sort(prices); List<Level> levels = new ArrayList<>(); int i = 0;
        while (i < prices.size()) {
            double cs = prices.get(i); double sum = 0; int cnt = 0;
            while (i < prices.size() && (prices.get(i) - cs) / cs < tol) { sum += prices.get(i); cnt++; i++; }
            double avg = sum / cnt; double pf = 1.0 / (1.0 + Math.abs(avg - cp) / cp);
            double str = Math.min(cnt * 0.25 * pf, 1.0);
            if (cnt >= 2) levels.add(new Level(Math.round(avg*100.0)/100.0, type, cnt, str,
                String.format("%s at %.2f (%d touches)", type, avg, cnt)));
        } return levels;
    }

    private List<Level> roundNumbers(double cp) {
        List<Level> r = new ArrayList<>();
        double iv = cp > 500 ? 50 : cp > 100 ? 25 : cp > 50 ? 10 : 5;
        double base = Math.floor(cp / iv) * iv;
        for (double p = base - iv * 2; p <= base + iv * 3; p += iv) {
            if (p > 0 && Math.abs(p - cp) / cp < 0.1) {
                String t = p > cp ? "RESISTANCE" : "SUPPORT";
                r.add(new Level(p, t, 0, 0.3, String.format("Round number %s at %.0f", t.toLowerCase(), p)));
            }
        } return r;
    }

    private List<Level> dedup(List<Level> levels, double minDist) {
        List<Level> r = new ArrayList<>();
        for (Level l : levels) { if (r.stream().noneMatch(x -> Math.abs(x.price()-l.price()) < minDist)) r.add(l); }
        return r;
    }
}
