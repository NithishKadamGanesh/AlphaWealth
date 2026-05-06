import { Menu } from "lucide-react";
import { cn } from "../lib/cn";

const MODE_STYLE = {
  live:      { classes: "bg-positive/15 text-positive border-positive/25", label: "LIVE", pulse: true },
  stale:     { classes: "bg-warning/15 text-warning border-warning/25",    label: "STALE", pulse: false },
  simulated: { classes: "bg-negative/15 text-negative border-negative/25", label: "SIM",   pulse: false },
  unknown:   { classes: "bg-line text-subtle border-line",                 label: "...",   pulse: false },
};

export const TickerTape = ({ quotes, dataMode = "unknown", isLive, lastError, lastUpdate, onMenuToggle }) => {
  const effectiveMode = dataMode !== "unknown" ? dataMode : (isLive ? "live" : "simulated");
  const mode = MODE_STYLE[effectiveMode] || MODE_STYLE.unknown;
  const ageSec = lastUpdate ? Math.floor((Date.now() - lastUpdate) / 1000) : null;

  return (
    <div className="bg-ink text-white overflow-hidden border-b border-ink h-9 flex items-center sticky top-0 z-30">
      {/* Mobile menu button */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden flex-shrink-0 px-3 py-2 text-white/70 hover:text-white transition-colors"
      >
        <Menu size={16} />
      </button>

      {/* Status badge */}
      <div
        title={lastError ? `Error: ${lastError}` : (ageSec != null ? `${ageSec}s ago` : "")}
        className={cn(
          "flex-shrink-0 px-2.5 py-0.5 ml-2 lg:ml-3 mr-2 rounded-md border",
          "font-mono text-2xs font-bold tracking-wide",
          "inline-flex items-center gap-1.5",
          mode.classes,
        )}
      >
        {mode.pulse && (
          <span className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse" />
        )}
        {mode.label}
      </div>

      {/* Scrolling tape */}
      <div className="flex-1 overflow-hidden">
        <div
          className={cn(
            "flex gap-8 py-2.5 whitespace-nowrap w-max",
            effectiveMode !== "live" && "opacity-50",
          )}
          style={{ animation: "scroll 60s linear infinite" }}
        >
          {[...Object.entries(quotes), ...Object.entries(quotes), ...Object.entries(quotes)].map(([sym, q], i) => (
            <span key={i} className="inline-flex items-center gap-2 font-mono text-xs">
              <span className="text-white/50 font-bold">{sym}</span>
              <span className="font-bold">${q.price.toFixed(2)}</span>
              <span className={cn("font-bold", q.change_pct >= 0 ? "text-positive" : "text-negative")}>
                {q.change_pct >= 0 ? "+" : ""}{q.change_pct.toFixed(2)}%
              </span>
              <span className="text-white/15">|</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
