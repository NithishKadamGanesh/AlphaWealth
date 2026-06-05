// ui/src/hooks/useIbkrPositions.js
// Reads normalized positions from ibkr-sync-svc and decorates them with live quotes.
//
// dataMode:
//   "live"         gateway authenticated and backend snapshot is current
//   "stale"        showing the last-known IBKR snapshot while auth/sync recovers
//   "disconnected" ibkr-sync-svc is reachable but no broker snapshot exists yet
//   "error"        ibkr-sync-svc itself is unreachable

import { useState, useEffect, useCallback, useRef } from "react";

const IBKR_URL = import.meta.env.VITE_IBKR_URL || "http://localhost:8091";
const LIVE_URL = import.meta.env.VITE_LIVE_DATA_URL || "http://localhost:8096";
const TIMEOUT_MS = 4000;

const SECTOR_MAP = {
  AAPL: "Tech", MSFT: "Tech", NVDA: "Tech", AMD: "Tech", GOOG: "Tech", GOOGL: "Tech", META: "Tech",
  AMZN: "Cons", TSLA: "Cons", "BRK.B": "Fin", JPM: "Fin", BAC: "Fin",
  VOO: "ETF", SPY: "ETF", QQQ: "ETF", VTI: "ETF",
  XOM: "Energy", CVX: "Energy", JNJ: "Health", PFE: "Health",
};

export function useIbkrPositions() {
  const [positions, setPositions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState({ connected: false });
  const [dataMode, setDataMode] = useState("disconnected");
  const [lastError, setLastError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const positionsRef = useRef([]);
  const statusRef = useRef(null);

  const commitPositions = (next) => {
    positionsRef.current = next;
    setPositions(next);
  };

  const resolveMode = (stat, positionCount) => {
    const state = stat?.state;
    if (state === "CONNECTED" || state === "SYNCING") return "live";
    if (["AUTH_REQUIRED", "DEGRADED", "LAST_SYNC_FAILED"].includes(state)) {
      return (stat?.hasSnapshot || positionCount > 0 || stat?.lastSyncAt) ? "stale" : "disconnected";
    }
    if (state === "DISCONNECTED") return "disconnected";
    return (stat?.hasSnapshot || positionCount > 0) ? "stale" : "disconnected";
  };

  const refresh = useCallback(async () => {
    try {
      const statusRes = await fetch(`${IBKR_URL}/ibkr/status`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status} from ibkr-sync-svc`);
      const stat = await statusRes.json();
      statusRef.current = stat;
      setStatus(stat);

      const posRes = await fetch(`${IBKR_URL}/ibkr/positions`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!posRes.ok) throw new Error("Positions fetch failed");
      const posArr = await posRes.json();
      const normalizedPositions = Array.isArray(posArr) ? posArr : [];

      try {
        const accRes = await fetch(`${IBKR_URL}/ibkr/accounts`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (accRes.ok) {
          const accountSummaries = await accRes.json();
          setAccounts(accountSummaries);
          const primarySummary = Array.isArray(accountSummaries)
            ? accountSummaries.find(a => a.account === stat?.primaryAccount) || accountSummaries[0] || null
            : null;
          setSummary(primarySummary);
        }
      } catch { /* accounts is best-effort */ }

      // Get live prices via yfinance for each symbol
      let livePrices = {};
      const symbols = normalizedPositions.map(p => p.symbol).filter(Boolean);
      if (symbols.length > 0) {
        try {
          const liveRes = await fetch(`${LIVE_URL}/quotes?symbols=${symbols.join(",")}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (liveRes.ok) {
            const data = await liveRes.json();
            for (const [sym, q] of Object.entries(data)) {
              if (q && !q.error) livePrices[sym] = q;
            }
          }
        } catch { /* prices fall back to avgCost */ }
      }

      const totalValue = normalizedPositions.reduce((s, p) => {
        const live = livePrices[p.symbol];
        const shares = Number(p.position || 0);
        const cost = Number(p.avgCost) || 0;
        const ibkrPrice = Number(p.marketPrice) || 0;
        const ibkrValue = Number(p.marketValue) || ibkrPrice * shares;
        const price = live?.price || ibkrPrice || cost;
        const value = live?.price ? shares * live.price : ibkrValue || shares * cost;
        return s + (value || price * shares);
      }, 0);

      const merged = normalizedPositions.map(p => {
        const sym = p.symbol;
        const live = livePrices[sym];
        const shares = Number(p.position) || 0;
        const cost = Number(p.avgCost) || 0;
        const ibkrPrice = Number(p.marketPrice) || 0;
        const ibkrValue = Number(p.marketValue) || ibkrPrice * shares;
        const price = live?.price || ibkrPrice || cost;
        const change = live?.change_pct || 0;
        const value = live?.price ? shares * live.price : ibkrValue || shares * cost;
        const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;
        return {
          ticker: sym, symbol: sym, name: sym,
          shares, price, cost,
          avgCost: cost,
          currentPrice: price,
          ibkrPrice,
          weight: +weight.toFixed(1),
          sector: SECTOR_MAP[sym] || "Other",
          change, change_pct: change,
          value, marketValue: value,
          ibkrMarketValue: ibkrValue,
          unrealizedPnl: Number(p.unrealizedPnl) || (value - shares * cost),
          currency: p.currency || "USD",
        };
      });

      commitPositions(merged);
      setDataMode(resolveMode(stat, merged.length));
      setLastError(stat.lastError || null);
      setLastUpdate(stat.lastSyncAt ? new Date(stat.lastSyncAt).getTime() : null);
    } catch (e) {
      const msg = String(e.message || e);
      const hadSnapshot = positionsRef.current.length > 0 || statusRef.current?.lastSyncAt;
      setLastError(msg);
      if (hadSnapshot) {
        setDataMode("stale");
      } else {
        setDataMode("error");
        commitPositions([]);
        setAccounts([]);
        setSummary(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    positions, accounts, summary, status,
    dataMode,
    isReal: dataMode === "live",
    lastError, lastUpdate, loading,
    refresh,
  };
}
