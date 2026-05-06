// ui/src/hooks/useForecast.js
// Fetches FinGPT-Forecaster predictions from fingpt-svc:8098.
// Forecasts are slow (~5-10s on RTX 2080 SUPER), so we don't auto-refresh.
//
// dataMode: "idle" no forecast yet / "loading" generating / "live" forecast in hand / "error"
// (No simulated fallback - inventing a directional forecast would be actively misleading.)

import { useState, useCallback } from "react";

const URL = import.meta.env.VITE_FINGPT_URL || "http://localhost:8098";

export function useForecast(symbol) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dataMode, setDataMode] = useState("idle");
  const [lastUpdate, setLastUpdate] = useState(null);

  const generate = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setDataMode("loading");
    try {
      const r = await fetch(`${URL}/forecast/${symbol}`, {
        signal: AbortSignal.timeout(120_000)  // 2 min, first request loads model
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setData(d);
      setDataMode("live");
      setLastUpdate(Date.now());
    } catch (e) {
      const msg = String(e.message || e);
      console.warn(`[useForecast] ${symbol} failed: ${msg}`);
      setError(msg);
      setDataMode("error");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setDataMode("idle");
  }, []);

  return { data, loading, error, dataMode, lastUpdate, generate, reset };
}
