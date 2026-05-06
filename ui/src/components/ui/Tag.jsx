// ui/src/components/ui/Tag.jsx
// Refined pill — no more MONO+UPPERCASE+10px tryhard
import { cn } from "../../lib/cn";

const variants = {
  default:  "bg-line/60 text-muted",
  positive: "bg-positive/10 text-positive",
  negative: "bg-negative/10 text-negative",
  warning:  "bg-warning/10 text-warning",
  accent:   "bg-accent/10 text-accent",
  outline:  "border border-line text-muted",
};

export const Tag = ({ children, variant = "default", className, dot = false }) => (
  <span className={cn(
    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium",
    variants[variant],
    className,
  )}>
    {dot && (
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        variant === "positive" && "bg-positive",
        variant === "negative" && "bg-negative",
        variant === "warning"  && "bg-warning",
        variant === "accent"   && "bg-accent",
        variant === "default"  && "bg-muted",
      )} />
    )}
    {children}
  </span>
);

export const Pulse = ({ className, color = "positive" }) => (
  <span className="relative flex h-2 w-2">
    <span className={cn(
      "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
      color === "positive" && "bg-positive",
      color === "negative" && "bg-negative",
      color === "accent" && "bg-accent",
    )} />
    <span className={cn(
      "relative inline-flex rounded-full h-2 w-2",
      color === "positive" && "bg-positive",
      color === "negative" && "bg-negative",
      color === "accent" && "bg-accent",
    )} />
  </span>
);
