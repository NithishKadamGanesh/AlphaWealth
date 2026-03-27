package com.alphatrade.analysis.portfolio;

import com.alphatrade.analysis.model.Candle;
import org.springframework.stereotype.Component;
import java.util.*;

/**
 * Portfolio optimization engine.
 *   - Correlation matrix between symbols
 *   - Efficient frontier approximation
 *   - Kelly criterion position sizing
 *   - Risk parity weights
 */
@Component
public class PortfolioOptimizer {

    public record CorrelationEntry(String sym1, String sym2, double correlation) {}
    public record OptimalWeight(String symbol, double weight, double expectedReturn, double volatility) {}
    public record PortfolioStats(double expectedReturn, double volatility, double sharpe,
                                  List<OptimalWeight> weights, List<CorrelationEntry> correlations) {}

    /**
     * Compute correlation matrix and optimal weights for a set of symbols.
     * @param symbolCandles map of symbol → daily candles
     */
    public PortfolioStats optimize(Map<String, List<Candle>> symbolCandles) {
        List<String> symbols = new ArrayList<>(symbolCandles.keySet());
        int n = symbols.size();
        if (n < 2) return null;

        // Compute daily returns for each symbol
        Map<String, double[]> returns = new HashMap<>();
        int minLen = Integer.MAX_VALUE;
        for (String sym : symbols) {
            List<Candle> candles = symbolCandles.get(sym);
            double[] rets = new double[candles.size() - 1];
            for (int i = 1; i < candles.size(); i++) {
                rets[i - 1] = (candles.get(i).close() - candles.get(i - 1).close()) / candles.get(i - 1).close();
            }
            returns.put(sym, rets);
            minLen = Math.min(minLen, rets.length);
        }

        // Trim to common length
        for (String sym : symbols) {
            double[] r = returns.get(sym);
            if (r.length > minLen) returns.put(sym, Arrays.copyOfRange(r, r.length - minLen, r.length));
        }

        // Correlation matrix
        List<CorrelationEntry> correlations = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                double corr = pearsonCorrelation(returns.get(symbols.get(i)), returns.get(symbols.get(j)));
                correlations.add(new CorrelationEntry(symbols.get(i), symbols.get(j), Math.round(corr * 1000.0) / 1000.0));
            }
        }

        // Per-symbol stats
        Map<String, Double> meanRets = new HashMap<>();
        Map<String, Double> vols = new HashMap<>();
        Map<String, Double> dailyMeans = new HashMap<>();
        for (String sym : symbols) {
            double[] r = returns.get(sym);
            double dailyMean = Arrays.stream(r).average().orElse(0);
            double mean = dailyMean * 252; // annualized
            double std = Math.sqrt(Arrays.stream(r).map(x -> (x - dailyMean) * (x - dailyMean)).average().orElse(0)) * Math.sqrt(252);
            dailyMeans.put(sym, dailyMean);
            meanRets.put(sym, mean);
            vols.put(sym, std);
        }

        // Risk parity weights (1/vol normalized)
        double totalInvVol = symbols.stream().mapToDouble(s -> 1.0 / Math.max(vols.get(s), 0.01)).sum();
        List<OptimalWeight> weights = new ArrayList<>();
        for (String sym : symbols) {
            double w = (1.0 / Math.max(vols.get(sym), 0.01)) / totalInvVol;
            weights.add(new OptimalWeight(sym, Math.round(w * 10000.0) / 10000.0,
                Math.round(meanRets.get(sym) * 10000.0) / 10000.0,
                Math.round(vols.get(sym) * 10000.0) / 10000.0));
        }

        // Portfolio expected return and covariance-aware volatility
        double portRet = weights.stream().mapToDouble(w -> w.weight * meanRets.get(w.symbol)).sum();
        double portVarDaily = 0;
        for (OptimalWeight wi : weights) {
            for (OptimalWeight wj : weights) {
                double cov = covariance(returns.get(wi.symbol()), returns.get(wj.symbol()), dailyMeans.get(wi.symbol()), dailyMeans.get(wj.symbol()));
                portVarDaily += wi.weight() * wj.weight() * cov;
            }
        }
        double portVol = Math.sqrt(Math.max(portVarDaily, 0)) * Math.sqrt(252);
        double sharpe = portVol > 0 ? portRet / portVol : 0;

        return new PortfolioStats(
            Math.round(portRet * 10000.0) / 10000.0,
            Math.round(portVol * 10000.0) / 10000.0,
            Math.round(sharpe * 100.0) / 100.0,
            weights, correlations
        );
    }

    /**
     * Kelly criterion: optimal fraction of capital to bet.
     * f* = (p * b - q) / b where p=win rate, q=loss rate, b=avg win/avg loss
     */
    public double kellyCriterion(double winRate, double avgWin, double avgLoss) {
        if (avgLoss == 0 || winRate <= 0 || winRate >= 1) return 0;
        double p = winRate, q = 1 - winRate, b = avgWin / avgLoss;
        double kelly = (p * b - q) / b;
        return Math.max(0, Math.min(kelly, 1.0)); // clamp 0-100%
    }

    private double pearsonCorrelation(double[] x, double[] y) {
        int n = Math.min(x.length, y.length);
        if (n < 10) return 0;
        double mx = 0, my = 0;
        for (int i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
        mx /= n; my /= n;
        double num = 0, dx = 0, dy = 0;
        for (int i = 0; i < n; i++) {
            double a = x[i] - mx, b = y[i] - my;
            num += a * b; dx += a * a; dy += b * b;
        }
        double denom = Math.sqrt(dx * dy);
        return denom > 0 ? num / denom : 0;
    }

    private double covariance(double[] x, double[] y, double meanX, double meanY) {
        int n = Math.min(x.length, y.length);
        if (n < 2) return 0;
        double sum = 0;
        for (int i = 0; i < n; i++) {
            sum += (x[i] - meanX) * (y[i] - meanY);
        }
        return sum / n;
    }
}
