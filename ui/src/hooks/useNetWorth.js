// ui/src/hooks/useNetWorth.js
// Fetches real net worth from net-worth-svc:8093.
//
// dataMode: "live" backend reachable / "stale" last fetch failed, showing cached /
//           "simulated" never reached backend, showing seed mock data.
//
// UI components MUST surface non-"live" states. Silent fallback hides outages.

import { useState, useEffect, useCallback, useRef } from "react";
import { ASSETS, LIABILITIES, netWorthHistory as mockHistory } from "../lib/mockData";

const URL = import.meta.env.VITE_NET_WORTH_URL || "http://localhost:8093";
const TIMEOUT_MS = 4000;

const tf = (ms) => AbortSignal.timeout(ms);

const computeMockSnapshot = () => {
  const totalAssets = ASSETS.reduce((s, a) => s + a.value, 0);
  const totalLiabilities = LIABILITIES.reduce((s, l) => s + l.value, 0);
  return {
    totalAssets, totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    cash:        ASSETS.filter(a => a.type === "Cash").reduce((s, a) => s + a.value, 0),
    investments: ASSETS.filter(a => a.type === "Investment").reduce((s, a) => s + a.value, 0),
    property:    ASSETS.filter(a => a.type === "Property").reduce((s, a) => s + a.value, 0),
    retirement:  ASSETS.filter(a => a.type === "Retirement").reduce((s, a) => s + a.value, 0),
    crypto: 0, otherAssets: 0,
    timestamp: new Date().toISOString(),
  };
};

export function useNetWorth() {
  const [snapshot, setSnapshot] = useState(computeMockSnapshot());
  const [history, setHistory] = useState(mockHistory);
  const [breakdown, setBreakdown] = useState({ manualAssets: ASSETS, manualLiabilities: LIABILITIES });
  const [dataMode, setDataMode] = useState("simulated"); // start pessimistic
  const [lastError, setLastError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const failsRef = useRef(0);
  const warnedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [curRes, histRes, brkRes] = await Promise.all([
        fetch(`${URL}/networth/current`, { signal: tf(TIMEOUT_MS) }),
        fetch(`${URL}/networth/history?days=730`, { signal: tf(TIMEOUT_MS) }),
        fetch(`${URL}/networth/breakdown`, { signal: tf(TIMEOUT_MS) }),
      ]);

      if (!curRes.ok) throw new Error(`HTTP ${curRes.status} from net-worth-svc`);
      const cur = await curRes.json();

      setSnapshot({
        totalAssets:      Number(cur.totalAssets) || 0,
        totalLiabilities: Number(cur.totalLiabilities) || 0,
        netWorth:         Number(cur.netWorth) || 0,
        cash:             Number(cur.cash) || 0,
        investments:      Number(cur.investments) || 0,
        property:         Number(cur.property) || 0,
        retirement:       Number(cur.retirement) || 0,
        crypto:           Number(cur.crypto) || 0,
        otherAssets:      Number(cur.otherAssets) || 0,
        timestamp:        cur.timestamp,
      });

      if (histRes.ok) {
        const arr = await histRes.json();
        if (Array.isArray(arr) && arr.length > 0) {
          setHistory(arr.reverse().map(s => ({
            month: new Date(s.timestamp).toLocaleString("default", { month: "short", day: "numeric" }),
            v: Number(s.netWorth) || 0,
          })));
        }
      }

      if (brkRes.ok) {
        const b = await brkRes.json();
        setBreakdown({
          manualAssets: b.manualAssets || [],
          manualLiabilities: b.manualLiabilities || [],
        });
      }

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
          console.warn(`[useNetWorth] net-worth-svc unreachable after ${failsRef.current} attempts. ` +
            `Showing seed values. Reason: ${msg}`);
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
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    snapshot, history, breakdown,
    dataMode,
    isReal: dataMode === "live", // legacy compat
    lastError, lastUpdate, loading,
    refresh,
  };
}
