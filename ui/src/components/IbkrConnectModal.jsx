// ui/src/components/IbkrConnectModal.jsx
// Shared overlay for the IBKR connect flow (driven by useIbkrConnect).
// Renders nothing when idle; otherwise shows connecting / success / blocked.

import { Loader2, CheckCircle2 } from "lucide-react";
import { Card } from "./ui/Card";

export function IbkrConnectModal({ connectState, loginUrl, onCancel }) {
  if (!connectState || connectState === "idle") return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <Card className="max-w-md w-full mx-4 text-center space-y-4">
        {connectState === "success" ? (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-positive/15 flex items-center justify-center">
              <CheckCircle2 className="text-positive" size={26} />
            </div>
            <h3 className="font-display text-lg font-bold">Connected to IBKR</h3>
            <p className="text-sm text-muted">Syncing your positions…</p>
          </>
        ) : connectState === "blocked" ? (
          <>
            <h3 className="font-display text-lg font-bold">Popup blocked</h3>
            <p className="text-sm text-muted">
              Your browser blocked the IBKR login window. Allow popups for this
              site, or open the gateway login directly:
            </p>
            <a
              href={loginUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-accent underline text-sm break-all"
            >
              {loginUrl}
            </a>
            <div>
              <button onClick={onCancel} className="text-xs font-mono text-muted hover:text-ink">
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center">
              <Loader2 className="text-accent animate-spin" size={26} />
            </div>
            <h3 className="font-display text-lg font-bold">Connecting to Interactive Brokers</h3>
            <p className="text-sm text-muted leading-relaxed">
              Finish signing in (username, password, 2FA) in the IBKR window. This
              dialog closes itself automatically once you're authenticated — no need
              to close the IBKR tab yourself.
            </p>
            <p className="text-2xs text-subtle font-mono">
              First time? Accept the self-signed certificate warning in the popup.
            </p>
            <button onClick={onCancel} className="text-xs font-mono text-muted hover:text-ink">
              Cancel
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
