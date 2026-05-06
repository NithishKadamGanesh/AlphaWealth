// ui/src/hooks/useLiveQuotes.js
// Connects to live-data-svc (Python yfinance) for real-time quotes.
//
// IMPORTANT: This hook exposes its data source clearly:
//   dataMode = "live"      backend reachable, data is real
//            = "stale"     backend was reachable, last fetch failed (showing last good values)
//            = "simulated" backend unreachable for >= 2 polls (showing synthetic ticks)
//
// UI components MUST surface non-"live" states to the user. Silent fallbacks
// hide outages and misrepresent reality. Use the TickerTape badge or a banner.

import { useState, useEffect, useRef } from "react";

const LIVE_DATA_URL = import.meta.env.VITE_LIVE_DATA_URL || "http://localhost:8096";

const DEFAULT_SYMBOLS = ["AAPL", "NVDA", "MSFT", "AMZN", "TSLA", "GOOGL", "META", "AMD", "VOO"];

// Seed values used ONLY when the backend has never responded. Marked clearly as
// fallback in dataMode so the UI cannot mistake them for live prices.
const SEED_QUOTES = {
  AAPL:  { price: 189.30, change_pct: 0.66 },
  NVDA:  { price: 875.20, change_pct: 2.75 },
  MSFT:  { price: 415.80, change_pct: -0.51 },
  AMZN:  { price: 185.40, change_pct: 1.76 },
  TSLA:  { price: 172.50, change_pct: -3.25 },
  GOOGL: { price: 171.90, change_pct: 0.50 },
  META:  { price: 502.30, change_pct: 1.42 },
  AMD:   { price: 174.20, change_pct: -0.88 },
  VOO:   { price: 498.50, change_pct: 0.42 },
};

export function useLiveQuotes(symbols = DEFAULT_SYMBOLS, intervalMs = 5000) {
  const [quotes, setQuotes] = useState(SEED_QUOTES);
  const [dataMode, setDataMode] = useState("simulated"); // start pessimistic
  const [lastError, setLastError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const failsRef = useRef(0);
  const warnedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function fetchQuotes() {
      try {
        const url = `${LIVE_DATA_URL}/quotes?symbols=${symbols.join(",")}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} from live-data-svc`);
        const data = await res.json();
        if (!mounted) return;

        const cleaned = {};
        for (const [sym, q] of Object.entries(data)) {
          if (q && !q.error && typeof q.price === "number")
            cleaned[sym] = { price: q.price, change_pct: q.change_pct };
        }

        if (Object.keys(cleaned).length === 0)
          throw new Error("live-data-svc returned no usable quotes");

        setQuotes(cleaned);
        setDataMode("live");
        setLastError(null);
        setLastUpdate(Date.now());
        failsRef.current = 0;
        warnedRef.current = false;
      } catch (e) {
        if (!mounted) return;
        failsRef.current++;
        const msg = String(e.message || e);
        setLastError(msg);

        if (failsRef.current === 1) {
          // First failure: show stale data, don't simulate yet
          setDataMode("stale");
        } else if (failsRef.current >= 2) {
          // Sustained failure: now we synthesize. Warn loudly the first time.
          if (!warnedRef.current) {
            console.warn(
              `[useLiveQuotes] live-data-svc unreachable after ${failsRef.current} polls. ` +
              `Falling back to SIMULATED ticks. Reason: ${msg}. ` +
              `Set VITE_LIVE_DATA_URL or start live-data-svc on :8096 to recover.`
            );
            warnedRef.current = true;
          }
          setDataMode("simulated");
          setQuotes(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(s => {
              const tick = (Math.random() - 0.495) * 0.6;
              next[s] = {
                ...next[s],
                price: Math.max(1, +(next[s].price + tick).toFixed(2)),
                change_pct: +(next[s].change_pct + (tick / next[s].price) * 100 * 0.3).toFixed(2),
              };
            });
            return next;
          });
        }
      }
    }

    fetchQuotes();
    const id = setInterval(fetchQuotes, intervalMs);
    return () => { mounted = false; clearInterval(id); };
  }, [symbols.join(","), intervalMs]);

  return {
    quotes,
    dataMode,                    // "live" | "stale" | "simulated"
    isLive: dataMode === "live", // legacy boolean for existing call sites
    lastError,
    lastUpdate,
  };
}

// Hook for fetching historical bars. Returns explicit dataMode instead of
// silently synthesizing a sine wave on failure.
export function useHistory(symbol, period = "1mo", interval = "1d") {
  const [data, setData] = useState([]);
  const [dataMode, setDataMode] = useState("loading"); // loading | live | error
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setDataMode("loading");
    setError(null);

    fetch(`${LIVE_DATA_URL}/history/${symbol}?period=${period}&interval=${interval}`,
          { signal: AbortSignal.timeout(8000) })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(j => {
        if (!mounted) return;
        const bars = j.bars || [];
        setData(bars);
        setDataMode(bars.length > 0 ? "live" : "error");
        if (bars.length === 0) setError("live-data-svc returned no bars");
        setLoading(false);
      })
      .catch(e => {
        if (!mounted) return;
        const msg = String(e.message || e);
        console.warn(`[useHistory] ${symbol} ${period}/${interval} failed: ${msg}`);
        setData([]);
        setDataMode("error");
        setError(msg);
        setLoading(false);
      });

    return () => { mounted = false; };
  }, [symbol, period, interval]);

  return { data, loading, dataMode, error };
}
