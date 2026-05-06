// ui/src/hooks/useSentiment.js
// Fetches FinBERT sentiment scoring from sentiment-svc:8097.
//
// dataMode: "loading" / "live" / "error"
// (No simulated fallback - sentiment is a real signal that should not be invented.)

import { useState, useEffect } from "react";

const URL = import.meta.env.VITE_SENTIMENT_URL || "http://localhost:8097";

export function useSymbolSentiment(symbol) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dataMode, setDataMode] = useState("loading");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setDataMode("loading");
    fetch(`${URL}/sentiment/symbol/${symbol}`, { signal: AbortSignal.timeout(15_000) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => {
        setData(d);
        setLoading(false);
        setDataMode("live");
      })
      .catch(e => {
        const msg = String(e);
        console.warn(`[useSymbolSentiment] ${symbol} failed: ${msg}`);
        setError(msg);
        setLoading(false);
        setDataMode("error");
      });
  }, [symbol]);

  return { data, loading, error, dataMode };
}

export function useFeedSentiment() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataMode, setDataMode] = useState("loading");

  useEffect(() => {
    const fetchFeed = () => {
      fetch(`${URL}/sentiment/feed`, { signal: AbortSignal.timeout(20_000) })
        .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
        .then(d => { setData(d); setLoading(false); setDataMode("live"); })
        .catch(e => {
          console.warn(`[useFeedSentiment] failed: ${e}`);
          setLoading(false);
          setDataMode("error");
        });
    };
    fetchFeed();
    const interval = setInterval(fetchFeed, 10 * 60_000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading, dataMode };
}

export function usePortfolioSentiment(symbols) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [dataMode, setDataMode] = useState("loading");

  useEffect(() => {
    if (!symbols || symbols.length === 0) return;
    setLoading(true);
    setDataMode("loading");
    const symStr = symbols.join(",");
    fetch(`${URL}/sentiment/portfolio?symbols=${symStr}`, { signal: AbortSignal.timeout(30_000) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { setData(d); setLoading(false); setDataMode("live"); })
      .catch(e => {
        console.warn(`[usePortfolioSentiment] failed: ${e}`);
        setLoading(false);
        setDataMode("error");
      });
  }, [symbols ? symbols.join(",") : ""]);

  return { data, loading, dataMode };
}
