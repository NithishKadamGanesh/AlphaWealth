const ANALYSIS_BASE = import.meta.env.VITE_ANALYSIS_BASE || 'http://localhost:8088';
const MARKET_DATA_BASE = import.meta.env.VITE_MARKET_DATA_BASE || 'http://localhost:8087';
const BACKTEST_BASE = import.meta.env.VITE_BACKTEST_BASE || 'http://localhost:8089';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// MARKET DATA
// ═══════════════════════════════════════════════════════════════

export function getCandles(symbol, params = {}) {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search}` : '';
  return fetchJson(`${MARKET_DATA_BASE}/api/marketdata/candles/${symbol}${suffix}`);
}

export function getWeeklyCandles(symbol) {
  return fetchJson(`${MARKET_DATA_BASE}/api/marketdata/candles/${symbol}/weekly`);
}

export function ingestCandles(symbol, size = 'compact') {
  return fetchJson(`${MARKET_DATA_BASE}/api/marketdata/ingest/${symbol}?size=${size}`, { method: 'POST' });
}

export function ingestCrypto(symbol) {
  return fetchJson(`${MARKET_DATA_BASE}/api/marketdata/ingest/${symbol}/crypto`, { method: 'POST' });
}

export function getMarketDataStatus(symbol) {
  return fetchJson(`${MARKET_DATA_BASE}/api/marketdata/status/${symbol}`);
}

export function getAvailableSymbols() {
  return fetchJson(`${MARKET_DATA_BASE}/api/marketdata/symbols`);
}

// ═══════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════

export function getAnalysisFull(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/full`);
}

export function getAnalysisSignal(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/signal`);
}

export function getAnalysisIndicators(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/indicators`);
}

export function getAnalysisPatterns(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/patterns`);
}

export function getAnalysisLevels(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/levels`);
}

export function getAnalysisSeasonality(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/seasonality`);
}

export function getMultiTimeframe(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/multitimeframe`);
}

export async function getAnalysisHistory(symbol) {
  try {
    return await fetchJson(`${ANALYSIS_BASE}/api/analysis/alerts/recent?limit=50`);
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════

export function scanAlerts(symbol) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/${symbol}/alerts`);
}

export function getAlertRules() {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/alerts/rules`);
}

export function addAlertRule(rule) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/alerts/rules`, {
    method: 'POST', body: JSON.stringify(rule),
  });
}

export function deleteAlertRule(ruleId) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/alerts/rules/${ruleId}`, { method: 'DELETE' });
}

export function getRecentAlerts(limit = 50) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/alerts/recent?limit=${limit}`);
}

// ═══════════════════════════════════════════════════════════════
// OPTIONS
// ═══════════════════════════════════════════════════════════════

export function priceOption(params) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/options/price`, {
    method: 'POST', body: JSON.stringify(params),
  });
}

export function getOptionsChain(params) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/options/chain`, {
    method: 'POST', body: JSON.stringify(params),
  });
}

export function getImpliedVolatility(params) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/options/iv`, {
    method: 'POST', body: JSON.stringify(params),
  });
}

export function analyzeOptionsStrategy(params) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/options/strategy`, {
    method: 'POST', body: JSON.stringify(params),
  });
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO OPTIMIZATION
// ═══════════════════════════════════════════════════════════════

export function optimizePortfolio(symbols) {
  return fetchJson(`${ANALYSIS_BASE}/api/analysis/portfolio/optimize`, {
    method: 'POST', body: JSON.stringify({ symbols }),
  });
}

// ═══════════════════════════════════════════════════════════════
// BACKTEST
// ═══════════════════════════════════════════════════════════════

export function getBacktestStrategies() {
  return fetchJson(`${BACKTEST_BASE}/api/backtest/strategies`);
}

export function runBacktest(payload) {
  return fetchJson(`${BACKTEST_BASE}/api/backtest/run`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function runCustomBacktest(payload) {
  return fetchJson(`${BACKTEST_BASE}/api/backtest/run/custom`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function compareBacktests(payload) {
  return fetchJson(`${BACKTEST_BASE}/api/backtest/compare`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function runWalkForward(payload) {
  return fetchJson(`${BACKTEST_BASE}/api/backtest/walkforward`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export async function runModelReplay(payload) {
  // Model replay uses the standard backtest engine with signal-based strategy
  try {
    return await fetchJson(`${BACKTEST_BASE}/api/backtest/run`, {
      method: 'POST', body: JSON.stringify({
        symbol: payload.symbol, strategy: 'SMA_CROSSOVER',
        capital: payload.capital || 100000,
        positionPct: payload.positionPct || 0.95,
        commission: payload.commission || 1.0,
        slippage: payload.slippage || 5,
        stopLossPct: 5, takeProfitPct: 10,
      }),
    });
  } catch { return null; }
}
