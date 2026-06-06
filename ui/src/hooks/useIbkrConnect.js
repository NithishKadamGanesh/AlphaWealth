// ui/src/hooks/useIbkrConnect.js
// Teller-style IBKR connect flow shared by the Portfolio page and the
// Settings → Broker Connections card.
//
// IBKR has no embeddable JS SDK, so we open the local Client Portal gateway
// login in a small popup. Because WE opened it, we hold the window handle and
// can close it ourselves: we poll backend auth status and, the moment it
// reports CONNECTED, auto-close the popup, fire a sync, and surface success.

import { useState, useRef, useEffect, useCallback } from "react";

const IBKR_URL = import.meta.env.VITE_IBKR_URL || "http://localhost:8091";
const DEFAULT_LOGIN_URL = "https://localhost:5001";

export function useIbkrConnect({ loginUrl = DEFAULT_LOGIN_URL, onConnected } = {}) {
  const [connectState, setConnectState] = useState("idle"); // idle | waiting | success | blocked
  const winRef = useRef(null);
  // Keep the latest onConnected without re-running the polling effect.
  const onConnectedRef = useRef(onConnected);
  useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);

  const connect = useCallback(() => {
    const w = 480, h = 720;
    const left = window.screenX + Math.max(0, Math.round((window.outerWidth - w) / 2));
    const top  = window.screenY + Math.max(0, Math.round((window.outerHeight - h) / 2));
    const win = window.open(
      loginUrl, "ibkr-login",
      `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
    );
    winRef.current = win;
    setConnectState(win ? "waiting" : "blocked");
  }, [loginUrl]);

  const cancel = useCallback(() => {
    try { winRef.current?.close(); } catch { /* cross-origin close is allowed for windows we opened */ }
    winRef.current = null;
    setConnectState("idle");
  }, []);

  // While waiting: poll auth status; on CONNECTED close popup + sync + success.
  useEffect(() => {
    if (connectState !== "waiting") return;
    let cancelled = false;
    const id = setInterval(async () => {
      let connected = false;
      try {
        const res = await fetch(`${IBKR_URL}/ibkr/status`, { signal: AbortSignal.timeout(4000) });
        if (res.ok) connected = (await res.json())?.state === "CONNECTED";
      } catch { /* gateway / login still in progress */ }
      if (cancelled) return;

      if (connected) {
        try { winRef.current?.close(); } catch {}
        winRef.current = null;
        setConnectState("success");
        fetch(`${IBKR_URL}/ibkr/sync`, { method: "POST", signal: AbortSignal.timeout(20_000) })
          .catch(() => {})
          .finally(() => onConnectedRef.current && onConnectedRef.current());
        return;
      }
      // User closed the popup before authenticating → stop waiting.
      if (!winRef.current || winRef.current.closed) {
        winRef.current = null;
        setConnectState("idle");
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connectState]);

  // Auto-dismiss the success confirmation. Lives in its OWN effect so the
  // waiting-effect cleanup can't cancel it (that was the stuck-modal bug).
  useEffect(() => {
    if (connectState !== "success") return;
    const t = setTimeout(() => setConnectState("idle"), 2600);
    return () => clearTimeout(t);
  }, [connectState]);

  return { connectState, connect, cancel, connecting: connectState === "waiting", loginUrl };
}
