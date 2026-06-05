// ui/src/hooks/useIbkrStatus.js
// Pure status reader for ibkr-sync-svc.
// The backend owns gateway auth + sync; the UI just polls status and triggers actions.

import { useState, useEffect, useCallback, useRef } from "react";

const IBKR_URL = import.meta.env.VITE_IBKR_URL || "http://localhost:8091";
const TIMEOUT_MS = 4000;
const ACTION_TIMEOUT_MS = 20_000;
const POLL_MS = 10_000;

export function useIbkrStatus() {
  const [status, setStatus] = useState(null);
  const [reachable, setReachable] = useState(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${IBKR_URL}/ibkr/status`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!aliveRef.current) return;
      setStatus(data);
      setReachable(true);
    } catch (e) {
      if (!aliveRef.current) return;
      setReachable(false);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  const sync = useCallback(async () => {
    try {
      const res = await fetch(`${IBKR_URL}/ibkr/sync`, {
        method: "POST",
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        if (!aliveRef.current) return;
        setStatus(data);
        setReachable(true);
      }
    } catch {}
    refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    try {
      const res = await fetch(`${IBKR_URL}/ibkr/disconnect`, {
        method: "POST",
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        if (!aliveRef.current) return;
        setStatus(data);
        setReachable(true);
      }
    } catch {}
    refresh();
  }, [refresh]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, [refresh]);

  return { status, reachable, loading, refresh, sync, disconnect };
}
