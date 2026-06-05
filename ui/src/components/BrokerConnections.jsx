// ui/src/components/BrokerConnections.jsx
// IBKR connection management UI. Lives on the Settings page, NOT on Portfolio.
// Portfolio just reads positions; this is where the user manages the link.

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Tag } from "./ui/Tag";
import { useIbkrStatus } from "../hooks/useIbkrStatus";

const STATE_COPY = {
  DISCONNECTED:     { variant: "default",  label: "Not connected",  hint: "Start the IBKR Client Portal gateway, then click Connect." },
  AUTH_REQUIRED:    { variant: "warning",  label: "Login required", hint: "Gateway is running but no IBKR session. Log in to authorize." },
  CONNECTED:        { variant: "positive", label: "Connected",      hint: "Positions are syncing on schedule." },
  SYNCING:          { variant: "accent",   label: "Syncing…",        hint: "Fetching the latest positions and balances." },
  DEGRADED:         { variant: "warning",  label: "Degraded",        hint: "Showing last-known data; gateway temporarily unreachable." },
  LAST_SYNC_FAILED: { variant: "negative", label: "Last sync failed", hint: "Most recent sync didn't complete. Try Sync now." },
};

function timeAgo(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)        return Math.max(1, Math.round(ms / 1000)) + "s ago";
  if (ms < 3_600_000)     return Math.round(ms / 60_000) + "m ago";
  if (ms < 86_400_000)    return Math.round(ms / 3_600_000) + "h ago";
  return Math.round(ms / 86_400_000) + "d ago";
}

function absoluteUrl(pathOrUrl) {
  try {
    return new URL(pathOrUrl || "https://localhost:5001", window.location.origin).toString();
  } catch {
    return "https://localhost:5001";
  }
}

export function BrokerConnections() {
  const { status, reachable, loading, sync, disconnect, refresh } = useIbkrStatus();
  const loginUrl = absoluteUrl(status?.loginUrl);
  const loginWindowRef = useRef(null);
  const autoSyncTriggeredRef = useRef(false);
  const [loginFlowActive, setLoginFlowActive] = useState(false);

  const view = useMemo(() => {
    if (loading)           return { ...STATE_COPY.DISCONNECTED, label: "Checking…" };
    if (reachable === false) return { variant: "negative", label: "Service offline", hint: "ibkr-sync-svc is not responding on :8091." };
    const s = status?.state || "DISCONNECTED";
    const base = STATE_COPY[s] || STATE_COPY.DISCONNECTED;
    if (status?.hasSnapshot && ["AUTH_REQUIRED", "DEGRADED", "LAST_SYNC_FAILED"].includes(s)) {
      return {
        ...base,
        hint: `${base.hint} Portfolio will keep showing your last-known snapshot until the connection recovers.`,
      };
    }
    return base;
  }, [status, reachable, loading]);

  useEffect(() => {
    if (!loginFlowActive) return;

    const timer = window.setInterval(() => {
      if (!loginWindowRef.current || loginWindowRef.current.closed) {
        loginWindowRef.current = null;
        setLoginFlowActive(false);
        refresh();
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [loginFlowActive, refresh]);

  useEffect(() => {
    if (!status) return;

    if (status.state === "AUTH_REQUIRED") {
      autoSyncTriggeredRef.current = false;
      return;
    }

    if (
      status.state === "CONNECTED" &&
      !status.syncInProgress &&
      !autoSyncTriggeredRef.current &&
      (!status.lastSyncAt || (status.positionCount ?? 0) === 0)
    ) {
      autoSyncTriggeredRef.current = true;
      sync();
    }
  }, [status, sync]);

  const openLogin = () => {
    autoSyncTriggeredRef.current = false;
    loginWindowRef.current = window.open(loginUrl, "ibkr-login", "noopener,noreferrer");
    setLoginFlowActive(Boolean(loginWindowRef.current));
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-display text-base font-bold">Interactive Brokers</h3>
            <Tag variant={view.variant} dot>{view.label}</Tag>
          </div>
          <p className="text-sm text-muted">{view.hint}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>Refresh</Button>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
        <dt className="text-muted">Account</dt>
        <dd className="font-mono">{status?.primaryAccount || "—"}</dd>

        <dt className="text-muted">Positions</dt>
        <dd>{status?.positionCount ?? 0}</dd>

        <dt className="text-muted">Last sync</dt>
        <dd>{timeAgo(status?.lastSyncAt)}</dd>

        {status?.lastError && (
          <>
            <dt className="text-muted">Last error</dt>
            <dd className="text-negative text-xs truncate" title={status.lastError}>{status.lastError}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={openLogin}>
          Open IBKR login ↗
        </Button>
        <Button variant="secondary" size="sm" onClick={sync} disabled={reachable === false || loading}>
          Sync now
        </Button>
        {(status?.connected || status?.hasSnapshot) && (
          <Button variant="ghost" size="sm" onClick={disconnect}>
            Disconnect
          </Button>
        )}
      </div>

      <p className="text-xs text-muted mt-4 leading-relaxed">
        Login opens the native IBKR Client Portal gateway on `https://localhost:5001`.
        After you sign in there, close that tab and AlphaWealth will refresh status and
        trigger a sync automatically.
      </p>
    </Card>
  );
}
