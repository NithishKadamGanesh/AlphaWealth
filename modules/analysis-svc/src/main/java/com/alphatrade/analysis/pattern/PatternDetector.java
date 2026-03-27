package com.alphatrade.analysis.pattern;

import com.alphatrade.analysis.model.Candle;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class PatternDetector {

    public record Pattern(String name, String type, int startIdx, int endIdx, double confidence, String bias, String description) {}

    public List<Pattern> detectAll(List<Candle> candles) {
        if (candles.size() < 30) return Collections.emptyList();
        List<Pattern> p = new ArrayList<>();
        int[] sH = findSwings(candles, 5, true), sL = findSwings(candles, 5, false);
        p.addAll(detectDoubleTop(candles, sH)); p.addAll(detectDoubleBottom(candles, sL));
        p.addAll(detectHeadAndShoulders(candles, sH)); p.addAll(detectTriangles(candles, sH, sL));
        p.addAll(detectEngulfing(candles)); p.addAll(detectDoji(candles)); p.addAll(detectHammer(candles));
        return p;
    }

    private int[] findSwings(List<Candle> c, int lb, boolean high) {
        List<Integer> pts = new ArrayList<>();
        for (int i = lb; i < c.size() - lb; i++) {
            boolean ok = true; double v = high ? c.get(i).high() : c.get(i).low();
            for (int j = i - lb; j <= i + lb; j++) {
                if (j != i && (high ? c.get(j).high() >= v : c.get(j).low() <= v)) { ok = false; break; }
            }
            if (ok) pts.add(i);
        }
        return pts.stream().mapToInt(Integer::intValue).toArray();
    }

    private List<Pattern> detectDoubleTop(List<Candle> c, int[] sH) {
        List<Pattern> r = new ArrayList<>();
        for (int i = 0; i < sH.length - 1; i++) {
            int i1 = sH[i], i2 = sH[i+1]; double h1 = c.get(i1).high(), h2 = c.get(i2).high();
            if (Math.abs(h1 - h2) < h1 * 0.015 && (i2 - i1) >= 10 && (i2 - i1) <= 60) {
                double conf = 1.0 - (Math.abs(h1 - h2) / h1) / 0.015;
                r.add(new Pattern("Double Top", "REVERSAL", i1, i2, Math.min(conf, 0.85), "BEARISH",
                    String.format("Resistance at %.2f tested twice", Math.max(h1, h2))));
            }
        } return r;
    }

    private List<Pattern> detectDoubleBottom(List<Candle> c, int[] sL) {
        List<Pattern> r = new ArrayList<>();
        for (int i = 0; i < sL.length - 1; i++) {
            int i1 = sL[i], i2 = sL[i+1]; double l1 = c.get(i1).low(), l2 = c.get(i2).low();
            if (Math.abs(l1 - l2) < l1 * 0.015 && (i2 - i1) >= 10 && (i2 - i1) <= 60) {
                double conf = 1.0 - (Math.abs(l1 - l2) / l1) / 0.015;
                r.add(new Pattern("Double Bottom", "REVERSAL", i1, i2, Math.min(conf, 0.85), "BULLISH",
                    String.format("Support at %.2f tested twice", Math.min(l1, l2))));
            }
        } return r;
    }

    private List<Pattern> detectHeadAndShoulders(List<Candle> c, int[] h) {
        List<Pattern> r = new ArrayList<>();
        for (int i = 0; i < h.length - 2; i++) {
            double lsH = c.get(h[i]).high(), headH = c.get(h[i+1]).high(), rsH = c.get(h[i+2]).high();
            if (headH > lsH && headH > rsH && Math.abs(lsH - rsH) / lsH < 0.03) {
                double conf = (1.0 - Math.abs(lsH - rsH) / lsH / 0.03) * 0.8;
                r.add(new Pattern("Head and Shoulders", "REVERSAL", h[i], h[i+2], conf, "BEARISH",
                    String.format("Head at %.2f, neckline ~%.2f", headH, (lsH + rsH) / 2)));
            }
        } return r;
    }

    private List<Pattern> detectTriangles(List<Candle> c, int[] hi, int[] lo) {
        List<Pattern> r = new ArrayList<>();
        if (hi.length < 2 || lo.length < 2) return r;
        int lb = Math.min(4, Math.min(hi.length, lo.length));
        int lh1 = hi[hi.length-lb], lh2 = hi[hi.length-1], ll1 = lo[lo.length-lb], ll2 = lo[lo.length-1];
        double hs = (c.get(lh2).high()-c.get(lh1).high())/(lh2-lh1), ls = (c.get(ll2).low()-c.get(ll1).low())/(ll2-ll1);
        int s = Math.min(lh1, ll1);
        if (hs < -0.01 && ls > 0.01) r.add(new Pattern("Symmetrical Triangle","CONTINUATION",s,c.size()-1,0.6,"NEUTRAL","Converging highs and lows"));
        else if (Math.abs(hs) < 0.005 && ls > 0.01) r.add(new Pattern("Ascending Triangle","CONTINUATION",s,c.size()-1,0.65,"BULLISH","Flat resistance with rising lows"));
        else if (hs < -0.01 && Math.abs(ls) < 0.005) r.add(new Pattern("Descending Triangle","CONTINUATION",s,c.size()-1,0.65,"BEARISH","Falling highs with flat support"));
        return r;
    }

    private List<Pattern> detectEngulfing(List<Candle> c) {
        List<Pattern> r = new ArrayList<>();
        for (int i = 1; i < c.size(); i++) {
            Candle p = c.get(i-1), cu = c.get(i);
            if (p.isBearish() && cu.isBullish() && cu.open() <= p.close() && cu.close() >= p.open())
                r.add(new Pattern("Bullish Engulfing","CANDLESTICK",i-1,i,0.7,"BULLISH","Bullish reversal candle"));
            if (p.isBullish() && cu.isBearish() && cu.open() >= p.close() && cu.close() <= p.open())
                r.add(new Pattern("Bearish Engulfing","CANDLESTICK",i-1,i,0.7,"BEARISH","Bearish reversal candle"));
        } return r;
    }

    private List<Pattern> detectDoji(List<Candle> c) {
        List<Pattern> r = new ArrayList<>();
        for (int i = 0; i < c.size(); i++) { if (c.get(i).body() < c.get(i).range() * 0.1 && c.get(i).range() > 0)
            r.add(new Pattern("Doji","CANDLESTICK",i,i,0.5,"NEUTRAL","Indecision")); } return r;
    }

    private List<Pattern> detectHammer(List<Candle> c) {
        List<Pattern> r = new ArrayList<>();
        for (int i = 1; i < c.size(); i++) {
            Candle cu = c.get(i); boolean lw = cu.lowerWick() > cu.body()*2, su = cu.upperWick() < cu.body()*0.5;
            boolean dt = cu.close() < c.get(Math.max(0,i-5)).close();
            if (lw && su && cu.body() > 0) { String nm = dt ? "Hammer" : "Hanging Man";
                r.add(new Pattern(nm,"CANDLESTICK",i,i,0.6,dt?"BULLISH":"BEARISH",nm+" pattern")); }
        } return r;
    }
}
