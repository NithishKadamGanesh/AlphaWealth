// Legacy primitives — thin wrappers that delegate to the new Tailwind components.
// Pages that still import from here will work; new code should import from ./ui/*.

import { cn, fmtMoney, fmtPct } from "../lib/cn";
import { Sparkline as NewSparkline } from "./ui/Sparkline";
import { Tag as NewTag, Pulse as NewPulse } from "./ui/Tag";
import { Card as NewCard } from "./ui/Card";
import { PageHeader as NewPageHeader } from "./ui/PageHeader";

export const Card = ({ children, padding, bg, border, style = {}, className }) => (
  <NewCard
    className={className}
    padded={padding !== 0}
    style={{
      ...(padding != null && padding !== true ? { padding } : {}),
      ...style,
    }}
  >
    {children}
  </NewCard>
);

export const Tag = ({ children, color, bg, border }) => {
  const variant = color?.includes("ef44") ? "negative"
    : color?.includes("a3e6") ? "positive"
    : color?.includes("06b6") ? "accent"
    : color?.includes("f59e") ? "warning"
    : "default";
  return <NewTag variant={variant}>{children}</NewTag>;
};

export const Pulse = ({ color, size = 8 }) => <NewPulse />;

export const Sparkline = ({ data, color, height = 36, fillOpacity }) => (
  <NewSparkline data={data?.map(d => d?.v ?? d)} height={height} />
);

export const ArrowChange = ({ value }) => {
  const isUp = value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 font-mono text-xs font-bold",
      isUp ? "text-positive" : "text-negative",
    )}>
      {isUp ? "+" : ""}{value?.toFixed(2)}%
    </span>
  );
};

export const Numeric = ({ value, prefix = "", suffix = "", size = 28, weight = 700, color }) => (
  <div
    className="font-display tracking-tight tabular"
    style={{ fontSize: size, fontWeight: weight }}
  >
    {prefix}{typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value}{suffix}
  </div>
);

export const Label = ({ children, color, size = 10 }) => (
  <div
    className="text-subtle font-medium uppercase tracking-widest font-mono flex items-center gap-1.5"
    style={{ fontSize: size }}
  >
    {children}
  </div>
);

export const PageHeader = NewPageHeader;

export const genSpark = (trend = 1, n = 24) => Array.from({ length: n }, (_, i) => ({
  v: 100 + i * trend * 0.5 + Math.sin(i / 2) * 4 + Math.random() * 3
}));
