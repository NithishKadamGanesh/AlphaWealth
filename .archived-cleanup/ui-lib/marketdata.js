/**
 * Simulated live market data generator.
 * Provides real-time-feeling price ticks for the symbol bar
 * and for frontend fallback views when backend data is unavailable.
 */

// Seed prices roughly matching real markets
const SEED_PRICES = {
  AAPL: 198.50, GOOGL: 176.30, MSFT: 425.80, AMZN: 192.40,
  TSLA: 255.70, NVDA: 885.20, META: 515.60, JPM: 198.10,
  BAC: 38.90, GS: 475.30, SPY: 525.40, QQQ: 445.20,
};

const state = {};

/** Initialize or get a symbol's simulated price state */
function getState(sym) {
  if (!state[sym]) {
    const base = SEED_PRICES[sym] || 100;
    // Random starting offset so it doesn't look identical every time
    const offset = (Math.random() - 0.5) * base * 0.02;
    state[sym] = {
      price: base + offset,
      open: base + offset,
      high: base + offset,
      low: base + offset,
      prevClose: base,
      volume: Math.floor(Math.random() * 5000000) + 1000000,
    };
  }
  return state[sym];
}

/** Tick a symbol forward with realistic random walk */
export function tickSymbol(sym) {
  const s = getState(sym);
  // Volatility proportional to price (roughly 0.3% per tick)
  const vol = s.price * 0.003;
  const drift = (Math.random() - 0.497) * vol; // slight upward bias
  s.price = Math.max(s.price * 0.95, s.price + drift); // floor at 95% of current
  s.price = +s.price.toFixed(2);
  s.high = Math.max(s.high, s.price);
  s.low = Math.min(s.low, s.price);
  s.volume += Math.floor(Math.random() * 50000);
  return buildQuote(sym, s);
}

/** Build a quote object matching the app's quote shape */
function buildQuote(sym, s) {
  const change = s.price - s.prevClose;
  const changePct = (change / s.prevClose) * 100;
  return {
    symbol: sym,
    last: s.price,
    bid: +(s.price - 0.01).toFixed(2),
    ask: +(s.price + 0.01).toFixed(2),
    change: +change.toFixed(2),
    changePct: +changePct.toFixed(2),
    open: s.open,
    high: s.high,
    low: s.low,
    close: s.prevClose,
    volume: s.volume,
    source: 'sim',
  };
}

/** Get current simulated quote without ticking */
export function getSimQuote(sym) {
  return buildQuote(sym, getState(sym));
}

/** Get all simulated quotes */
export function getAllSimQuotes(symbols) {
  const quotes = {};
  symbols.forEach((sym) => {
    quotes[sym] = tickSymbol(sym);
  });
  return quotes;
}
