// ui/src/hooks/useBanking.js
// Fetches Teller data from plaid-banking-svc:8092 (/banking/* endpoints).
//
// dataMode: "live" / "stale" / "simulated"

import { useState, useEffect, useCallback, useRef } from "react";
import { transactions as mockTx, spendingByCategory as mockCats } from "../lib/mockData";
import { computeSpendingCategories } from "../lib/banking";

const URL = import.meta.env.VITE_PLAID_URL || "http://localhost:8092";
const TIMEOUT_MS = 6000;

const mockAccounts = [
  { id: "chk-1", name: "Chase Checking", type: "depository", subtype: "checking", balance: 8450, available: 8450, currency: "USD" },
  { id: "sav-1", name: "Chase Savings",  type: "depository", subtype: "savings",  balance: 24000, available: 24000, currency: "USD" },
];

export function useBanking() {
  const [accounts, setAccounts] = useState(mockAccounts);
  const [transactions, setTransactions] = useState(mockTx);
  const [categories, setCategories] = useState(mockCats);
  const [dataMode, setDataMode] = useState("simulated");
  const [lastError, setLastError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appId, setAppId] = useState(null);
  const failsRef = useRef(0);
  const warnedRef = useRef(false);

  useEffect(() => {
    fetch(`${URL}/banking/config`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.appId) setAppId(d.appId); })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [accRes, txRes] = await Promise.all([
        fetch(`${URL}/banking/accounts`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
        fetch(`${URL}/banking/transactions?days=30`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      ]);

      if (!accRes.ok && !txRes.ok)
        throw new Error("banking-svc unreachable");

      let gotAny = false;

      if (accRes.ok) {
        const arr = await accRes.json();
        if (Array.isArray(arr) && arr.length > 0) { setAccounts(arr); gotAny = true; }
      }

      if (txRes.ok) {
        const arr = await txRes.json();
        if (Array.isArray(arr) && arr.length > 0) {
          const formatted = arr.map(t => ({
            id:       t.id,
            merchant: t.merchant || t.name || "Unknown",
            category: t.category || "Other",
            amount:   Number(t.amount),
            rawDate:  t.date,
            date:     new Date(t.date).toLocaleString("default", { month: "short", day: "numeric" }),
            pending:  t.pending || false,
          }));
          setTransactions(formatted);
          setCategories(computeSpendingCategories(formatted));
          gotAny = true;
        }
      }

      if (!gotAny) throw new Error("No bank accounts connected yet");

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
          console.warn(`[useBanking] banking-svc unreachable. Showing seed data. Reason: ${msg}`);
          warnedRef.current = true;
        }
        setDataMode("simulated");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const enroll = useCallback(async (accessToken, institution) => {
    const res = await fetch(`${URL}/banking/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, institution }),
    });
    if (res.ok) {
      // Reset failure state so refresh treats this as a fresh start
      failsRef.current = 0;
      warnedRef.current = false;
      setTimeout(refresh, 1500);
      setTimeout(refresh, 4000); // second attempt in case Teller needs a moment
    }
    return res.ok;
  }, [refresh]);

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
    appId, enroll,
    refresh,
  };
}
