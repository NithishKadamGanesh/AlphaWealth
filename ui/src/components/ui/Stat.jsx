import { TrendingUp, TrendingDown } from "lucide-react";
import { cn, fmtMoney, fmtPct } from "../../lib/cn";

export const Stat = ({
  label, value, delta, deltaPct,
  format = "money",
  size = "lg",
  prefix, suffix,
  className,
  showDelta = true,
}) => {
  const formatted =
    format === "money" ? fmtMoney(value) :
    format === "pct"   ? fmtPct(value) :
    typeof value === "number" ? value.toLocaleString() : value;

  const sizeClasses = {
    hero: "text-5xl sm:text-6xl lg:text-7xl",
    lg:   "text-3xl sm:text-4xl lg:text-5xl",
    md:   "text-2xl sm:text-3xl",
    sm:   "text-lg sm:text-xl",
  }[size];

  const isUp = delta != null ? delta >= 0 : (deltaPct != null ? deltaPct >= 0 : null);

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <div className="text-xs uppercase tracking-wider text-subtle font-medium">
          {label}
        </div>
      )}
      <div
        className={cn(
          "font-display font-medium tabular tracking-tighter text-ink animate-slide-up",
          sizeClasses,
        )}
      >
        {prefix}{formatted}{suffix}
      </div>
      {showDelta && (delta != null || deltaPct != null) && (
        <div
          className={cn(
            "inline-flex items-center gap-1.5 text-sm tabular font-medium",
            isUp ? "text-positive" : "text-negative",
          )}
        >
          {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {delta != null && <span>{isUp ? "+" : ""}{fmtMoney(delta)}</span>}
          {deltaPct != null && (
            <span className="text-muted font-normal">
              ({isUp ? "+" : ""}{deltaPct.toFixed(2)}%)
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export const MiniStat = ({ label, value, deltaPct, format = "money", className, icon: Icon }) => {
  const isUp = deltaPct != null && deltaPct >= 0;
  const formatted =
    format === "money" ? fmtMoney(value, { compact: true }) :
    format === "pct"   ? fmtPct(value) :
    typeof value === "number" ? value.toLocaleString() : value;

  return (
    <div className={cn("group", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-subtle font-medium">
          {label}
        </div>
        {Icon && <Icon size={14} className="text-subtle group-hover:text-muted transition-colors" />}
      </div>
      <div className="font-display text-xl sm:text-2xl font-medium tracking-tight tabular text-ink">
        {formatted}
      </div>
      {deltaPct != null && (
        <div className={cn(
          "text-xs tabular mt-1.5 font-medium",
          isUp ? "text-positive" : "text-negative",
        )}>
          {isUp ? "+" : ""}{Math.abs(deltaPct).toFixed(2)}%
        </div>
      )}
    </div>
  );
};
