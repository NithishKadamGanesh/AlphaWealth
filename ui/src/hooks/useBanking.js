// ui/src/hooks/useBanking.js
// Fetches Plaid data from plaid-banking-svc:8092.
//
// dataMode: "live" / "stale" / "simulated"

import { useState, useEffect, useCallback, useRef } from "react";
import { transactions as mockTx, spendingByCategory as mockCats } from "../lib/mockData";

const URL = import.meta.env.VITE_PLAID_URL || "http://localhost:8092";
const TIMEOUT_MS = 4000;

const mockAccounts = [
  { id: "chk-1", name: "Chase Checking", type: "depository", subtype: "checking", balance: 8450, available: 8450, currency: "USD" },
  { id: "sav-1", name: "Chase Savings",  type: "depository", subtype: "savings",  balance: 24000, available: 24000, currency: "USD" },
];

const computeCategories = (txs) => {
  const totals = {};
  for (const t of txs) {
    const amt = Number(t.amount);
    if (amt < 0) {
      const cat = t.category || "Other";
      totals[cat] = (totals[cat] || 0) + Math.abs(amt);
    }
  }
  const palette = ["#7c3aed", "#06b6d4", "#a3e635", "#ef4444", "#f59e0b", "#2563eb", "#ec4899", "#10b981"];
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], i) => ({
      name, value: Math.round(value),
      budget: Math.round(value * 1.2),
      color: palette[i % palette.length],
    }));
};

export function useBanking() {
  const [accounts, setAccounts] = useState(mockAccounts);
  const [transactions, setTransactions] = useState(mockTx);
  const [categories, setCategories] = useState(mockCats);
  const [dataMode, setDataMode] = useState("simulated");
  const [lastError, setLastError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const failsRef = useRef(0);
  const warnedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [accRes, txRes] = await Promise.all([
        fetch(`${URL}/plaid/accounts`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
        fetch(`${URL}/plaid/transactions?days=30`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      ]);

      if (!accRes.ok && !txRes.ok)
        throw new Error("plaid-banking-svc unreachable on both endpoints");

      let gotAny = false;

      if (accRes.ok) {
        const arr = await accRes.json();
        if (Array.isArray(arr) && arr.length > 0) { setAccounts(arr); gotAny = true; }
      }

      if (txRes.ok) {
        const arr = await txRes.json();
        if (Array.isArray(arr) && arr.length > 0) {
          const formatted = arr.map(t => ({
            merchant: t.merchant || t.name || "Unknown",
            category: t.category || "Other",
            amount:   Number(t.amount),
            date:     new Date(t.date).toLocaleString("default", { month: "short", day: "numeric" }),
            pending:  t.pending || false,
          }));
          setTransactions(formatted);
          setCategories(computeCategories(formatted));
          gotAny = true;
        }
      }

      if (!gotAny) throw new Error("plaid-banking-svc returned empty data");

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
          console.warn(`[useBanking] plaid-banking-svc unreachable. Showing seed data. Reason: ${msg}`);
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
    const interval = setInterval(refresh, 120_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    accounts, transactions, categories,
    dataMode,
    isReal: dataMode === "live",
    lastError, lastUpdate, loading,
    refresh,
  };
}
