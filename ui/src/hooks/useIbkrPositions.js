// ui/src/hooks/useIbkrPositions.js
// Fetches IBKR positions from ibkr-sync-svc:8091 and merges with live yfinance prices.
//
// dataMode: "live" IBKR connected and returning positions /
//           "stale" connected but last fetch failed /
//           "simulated" not connected, showing mock holdings /
//           "disconnected" reachable but TWS Gateway is offline

import { useState, useEffect, useCallback, useRef } from "react";
import { portfolioHoldings as mockHoldings } from "../lib/mockData";

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
  const [positions, setPositions] = useState(mockHoldings);
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState({ connected: false });
  const [dataMode, setDataMode] = useState("simulated");
  const [lastError, setLastError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const failsRef = useRef(0);
  const warnedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const statusRes = await fetch(`${IBKR_URL}/ibkr/status`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status} from ibkr-sync-svc`);
      const stat = await statusRes.json();
      setStatus(stat);

      // Service is reachable, but TWS Gateway not running -> "disconnected" is honest
      if (!stat.connected) {
        setDataMode("disconnected");
        setLastError(null);
        setLoading(false);
        return;
      }

      const posRes = await fetch(`${IBKR_URL}/ibkr/positions`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!posRes.ok) throw new Error("Positions fetch failed");
      const posArr = await posRes.json();

      if (!Array.isArray(posArr) || posArr.length === 0) {
        setDataMode("disconnected");
        setLoading(false);
        return;
      }

      try {
        const accRes = await fetch(`${IBKR_URL}/ibkr/accounts`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (accRes.ok) setAccounts(await accRes.json());
      } catch { /* accounts is best-effort */ }

      // Get live prices via yfinance for each symbol
      const symbols = posArr.map(p => p.symbol).join(",");
      let livePrices = {};
      try {
        const liveRes = await fetch(`${LIVE_URL}/quotes?symbols=${symbols}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (liveRes.ok) {
          const data = await liveRes.json();
          for (const [sym, q] of Object.entries(data)) {
            if (q && !q.error) livePrices[sym] = q;
          }
        }
      } catch { /* prices fall back to avgCost */ }

      const totalValue = posArr.reduce((s, p) => {
        const live = livePrices[p.symbol];
        const price = live?.price || Number(p.avgCost) || 0;
        return s + price * Number(p.position || 0);
      }, 0);

      const merged = posArr.map(p => {
        const sym = p.symbol;
        const live = livePrices[sym];
        const shares = Number(p.position) || 0;
        const cost = Number(p.avgCost) || 0;
        const price = live?.price || cost;
        const change = live?.change_pct || 0;
        const value = shares * price;
        const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;
        return {
          ticker: sym, symbol: sym, name: sym,
          shares, price, cost,
          weight: +weight.toFixed(1),
          sector: SECTOR_MAP[sym] || "Other",
          change, change_pct: change,
          value, marketValue: value,
          currency: p.currency || "USD",
        };
      });

      setPositions(merged);
      setDataMode("live");
      setLastError(null);
      setLastUpdate(Date.now());
      failsRef.current = 0;
      warnedRef.current = false;
    } catch (e) {
      failsRef.current++;
      const msg = String(e.message || e);
      setLastError(msg);
      if (failsRef.current === 1) {
        setDataMode("stale");
      } else if (failsRef.current >= 2) {
        if (!warnedRef.current) {
          console.warn(`[useIbkrPositions] ibkr-sync-svc unreachable. Showing demo. Reason: ${msg}`);
          warnedRef.current = true;
        }
        setDataMode("simulated");
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
    positions, accounts, status,
    dataMode,
    isReal: dataMode === "live",
    lastError, lastUpdate, loading,
    refresh,
  };
}
