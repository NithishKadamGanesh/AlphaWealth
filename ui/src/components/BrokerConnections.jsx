// ui/src/components/BrokerConnections.jsx
// IBKR connection management UI. Lives on the Settings page, NOT on Portfolio.
// Portfolio just reads positions; this is where the user manages the link.

import { useEffect, useMemo } from "react";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Tag } from "./ui/Tag";
import { useIbkrStatus } from "../hooks/useIbkrStatus";
import { useIbkrConnect } from "../hooks/useIbkrConnect";
import { IbkrConnectModal } from "./IbkrConnectModal";

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
  // Teller-style connect popup with auto-close on CONNECTED (shared hook).
  const { connectState, connect: openLogin, cancel: cancelConnect, connecting } =
    useIbkrConnect({ loginUrl, onConnected: refresh });

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

  // Safety net: if the session is already CONNECTED on load but has no synced
  // positions yet, kick one sync. (The popup connect flow syncs on its own.)
  useEffect(() => {
    if (status?.state === "CONNECTED" && !status.syncInProgress &&
        (!status.lastSyncAt || (status.positionCount ?? 0) === 0)) {
      sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state]);

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
        <Button variant="primary" size="sm" onClick={openLogin} disabled={connecting}>
          {connecting ? "Connecting…" : ((status?.connected || status?.hasSnapshot) ? "Reconnect ↗" : "Connect IBKR ↗")}
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
        Connect opens the IBKR Client Portal gateway login in a popup. Once you sign
        in (username, password, 2FA), AlphaWealth detects it, closes the popup, and
        syncs automatically — no need to close the tab yourself.
      </p>

      <IbkrConnectModal connectState={connectState} loginUrl={loginUrl} onCancel={cancelConnect} />
    </Card>
  );
}
