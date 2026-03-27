package com.alphatrade.analysis.indicator;

import com.alphatrade.analysis.model.Candle;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class IndicatorEngine {

    public double[] sma(List<Candle> candles, int period) {
        double[] r = new double[candles.size()]; Arrays.fill(r, Double.NaN);
        for (int i = period - 1; i < candles.size(); i++) {
            double s = 0; for (int j = i - period + 1; j <= i; j++) s += candles.get(j).close();
            r[i] = s / period;
        } return r;
    }

    public double[] ema(List<Candle> candles, int period) {
        double[] r = new double[candles.size()]; Arrays.fill(r, Double.NaN);
        if (candles.size() < period) return r;
        double m = 2.0 / (period + 1), s = 0;
        for (int i = 0; i < period; i++) s += candles.get(i).close();
        r[period - 1] = s / period;
        for (int i = period; i < candles.size(); i++) r[i] = (candles.get(i).close() - r[i-1]) * m + r[i-1];
        return r;
    }

    private double[] emaOfValues(double[] v, int period) {
        double[] r = new double[v.length]; Arrays.fill(r, Double.NaN);
        double m = 2.0 / (period + 1); int start = -1; double s = 0; int c = 0;
        for (int i = 0; i < v.length; i++) { if (!Double.isNaN(v[i])) { s += v[i]; c++; if (c == period) { r[i] = s / period; start = i; break; } } }
        if (start < 0) return r;
        for (int i = start + 1; i < v.length; i++) r[i] = Double.isNaN(v[i]) ? r[i-1] : (v[i] - r[i-1]) * m + r[i-1];
        return r;
    }

    public double[] rsi(List<Candle> candles, int period) {
        double[] r = new double[candles.size()]; Arrays.fill(r, Double.NaN);
        if (candles.size() <= period) return r;
        double ag = 0, al = 0;
        for (int i = 1; i <= period; i++) { double ch = candles.get(i).close() - candles.get(i-1).close(); if (ch > 0) ag += ch; else al -= ch; }
        ag /= period; al /= period;
        r[period] = al == 0 ? 100 : 100 - (100 / (1 + ag / al));
        for (int i = period + 1; i < candles.size(); i++) {
            double ch = candles.get(i).close() - candles.get(i-1).close();
            ag = (ag * (period - 1) + (ch > 0 ? ch : 0)) / period;
            al = (al * (period - 1) + (ch < 0 ? -ch : 0)) / period;
            r[i] = al == 0 ? 100 : 100 - (100 / (1 + ag / al));
        } return r;
    }

    public Map<String, double[]> macd(List<Candle> candles, int fast, int slow, int signal) {
        double[] ef = ema(candles, fast), es = ema(candles, slow);
        double[] ml = new double[candles.size()]; Arrays.fill(ml, Double.NaN);
        for (int i = 0; i < candles.size(); i++) if (!Double.isNaN(ef[i]) && !Double.isNaN(es[i])) ml[i] = ef[i] - es[i];
        double[] sl = emaOfValues(ml, signal);
        double[] h = new double[candles.size()]; Arrays.fill(h, Double.NaN);
        for (int i = 0; i < candles.size(); i++) if (!Double.isNaN(ml[i]) && !Double.isNaN(sl[i])) h[i] = ml[i] - sl[i];
        return Map.of("macd", ml, "signal", sl, "histogram", h);
    }
    public Map<String, double[]> macd(List<Candle> candles) { return macd(candles, 12, 26, 9); }

    public Map<String, double[]> bollinger(List<Candle> candles, int period, double mult) {
        double[] mid = sma(candles, period);
        double[] u = new double[candles.size()], l = new double[candles.size()], bw = new double[candles.size()], pb = new double[candles.size()];
        Arrays.fill(u, Double.NaN); Arrays.fill(l, Double.NaN); Arrays.fill(bw, Double.NaN); Arrays.fill(pb, Double.NaN);
        for (int i = period - 1; i < candles.size(); i++) {
            double sum = 0; for (int j = i - period + 1; j <= i; j++) { double d = candles.get(j).close() - mid[i]; sum += d * d; }
            double sd = Math.sqrt(sum / period);
            u[i] = mid[i] + mult * sd; l[i] = mid[i] - mult * sd;
            bw[i] = sd > 0 ? (u[i] - l[i]) / mid[i] : 0;
            pb[i] = (u[i] - l[i]) > 0 ? (candles.get(i).close() - l[i]) / (u[i] - l[i]) : 0.5;
        } return Map.of("upper", u, "middle", mid, "lower", l, "bandwidth", bw, "pctB", pb);
    }
    public Map<String, double[]> bollinger(List<Candle> candles) { return bollinger(candles, 20, 2.0); }

    public double[] atr(List<Candle> candles, int period) {
        double[] r = new double[candles.size()]; Arrays.fill(r, Double.NaN);
        if (candles.size() <= period) return r;
        double[] tr = new double[candles.size()]; tr[0] = candles.get(0).range();
        for (int i = 1; i < candles.size(); i++) {
            double h = candles.get(i).high(), lo = candles.get(i).low(), pc = candles.get(i-1).close();
            tr[i] = Math.max(h - lo, Math.max(Math.abs(h - pc), Math.abs(lo - pc)));
        }
        double s = 0; for (int i = 0; i < period; i++) s += tr[i]; r[period - 1] = s / period;
        for (int i = period; i < candles.size(); i++) r[i] = (r[i-1] * (period - 1) + tr[i]) / period;
        return r;
    }
    public double[] atr(List<Candle> candles) { return atr(candles, 14); }

    public Map<String, double[]> stochastic(List<Candle> candles, int kP, int dP) {
        double[] k = new double[candles.size()]; Arrays.fill(k, Double.NaN);
        for (int i = kP - 1; i < candles.size(); i++) {
            double hi = Double.MIN_VALUE, lo = Double.MAX_VALUE;
            for (int j = i - kP + 1; j <= i; j++) { hi = Math.max(hi, candles.get(j).high()); lo = Math.min(lo, candles.get(j).low()); }
            k[i] = (hi - lo) > 0 ? ((candles.get(i).close() - lo) / (hi - lo)) * 100 : 50;
        }
        double[] d = new double[candles.size()]; Arrays.fill(d, Double.NaN);
        for (int i = kP + dP - 2; i < candles.size(); i++) { double s = 0; for (int j = i - dP + 1; j <= i; j++) s += k[j]; d[i] = s / dP; }
        return Map.of("k", k, "d", d);
    }
    public Map<String, double[]> stochastic(List<Candle> candles) { return stochastic(candles, 14, 3); }

    public Map<String, double[]> adx(List<Candle> candles, int p) {
        int n = candles.size();
        double[] pDI = new double[n], nDI = new double[n], adxA = new double[n];
        Arrays.fill(pDI, Double.NaN); Arrays.fill(nDI, Double.NaN); Arrays.fill(adxA, Double.NaN);
        if (n <= p * 2) return Map.of("adx", adxA, "plusDI", pDI, "minusDI", nDI);
        double[] tr = new double[n], pDM = new double[n], nDM = new double[n];
        for (int i = 1; i < n; i++) {
            double h = candles.get(i).high(), l = candles.get(i).low(), ph = candles.get(i-1).high(), pl = candles.get(i-1).low(), pc = candles.get(i-1).close();
            tr[i] = Math.max(h-l, Math.max(Math.abs(h-pc), Math.abs(l-pc)));
            double up = h - ph, dn = pl - l;
            pDM[i] = (up > dn && up > 0) ? up : 0; nDM[i] = (dn > up && dn > 0) ? dn : 0;
        }
        double sTR = 0, sPDM = 0, sNDM = 0;
        for (int i = 1; i <= p; i++) { sTR += tr[i]; sPDM += pDM[i]; sNDM += nDM[i]; }
        for (int i = p; i < n; i++) {
            if (i > p) { sTR = sTR - sTR/p + tr[i]; sPDM = sPDM - sPDM/p + pDM[i]; sNDM = sNDM - sNDM/p + nDM[i]; }
            pDI[i] = sTR > 0 ? (sPDM/sTR)*100 : 0; nDI[i] = sTR > 0 ? (sNDM/sTR)*100 : 0;
        }
        double[] dx = new double[n]; Arrays.fill(dx, Double.NaN);
        for (int i = p; i < n; i++) { double sm = pDI[i]+nDI[i]; dx[i] = sm > 0 ? (Math.abs(pDI[i]-nDI[i])/sm)*100 : 0; }
        int as = p*2-1;
        if (as < n) { double s = 0; for (int i = p; i <= as; i++) s += dx[i]; adxA[as] = s/p;
            for (int i = as+1; i < n; i++) adxA[i] = (adxA[i-1]*(p-1)+dx[i])/p; }
        return Map.of("adx", adxA, "plusDI", pDI, "minusDI", nDI);
    }

    public double[] obv(List<Candle> candles) {
        double[] r = new double[candles.size()]; if (candles.isEmpty()) return r;
        r[0] = candles.get(0).volume();
        for (int i = 1; i < candles.size(); i++) {
            double c = candles.get(i).close(), pc = candles.get(i-1).close();
            r[i] = c > pc ? r[i-1]+candles.get(i).volume() : c < pc ? r[i-1]-candles.get(i).volume() : r[i-1];
        } return r;
    }

    public double[] vwap(List<Candle> candles) {
        double[] r = new double[candles.size()]; double cvp = 0, cv = 0;
        for (int i = 0; i < candles.size(); i++) {
            double tp = candles.get(i).hlc3(); cvp += tp * candles.get(i).volume(); cv += candles.get(i).volume();
            r[i] = cv > 0 ? cvp / cv : tp;
        } return r;
    }

    public Map<String, Object> computeAll(List<Candle> candles) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("sma20", sma(candles,20)); r.put("sma50", sma(candles,50)); r.put("sma200", sma(candles,200));
        r.put("ema12", ema(candles,12)); r.put("ema26", ema(candles,26));
        r.put("rsi14", rsi(candles,14)); r.put("macd", macd(candles)); r.put("bollinger", bollinger(candles));
        r.put("atr14", atr(candles)); r.put("stochastic", stochastic(candles));
        r.put("adx14", adx(candles,14)); r.put("obv", obv(candles)); r.put("vwap", vwap(candles));
        return r;
    }
}
