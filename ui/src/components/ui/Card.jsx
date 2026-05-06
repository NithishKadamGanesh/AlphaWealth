// ui/src/components/ui/Card.jsx
// Refined card primitive — subtle depth, no loud borders
import { cn } from "../../lib/cn";

export const Card = ({ children, className, hoverable = false, padded = true, ...props }) => (
  <div
    className={cn(
      "bg-surface rounded-xl border border-line",
      "shadow-subtle",
      padded && "p-6",
      hoverable && "hoverable cursor-pointer",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export const CardHeader = ({ children, className }) => (
  <div className={cn("flex items-center justify-between mb-4", className)}>
    {children}
  </div>
);

export const CardTitle = ({ children, className }) => (
  <h3 className={cn("text-sm font-medium text-ink", className)}>
    {children}
  </h3>
);

export const CardDescription = ({ children, className }) => (
  <p className={cn("text-xs text-muted mt-1", className)}>
    {children}
  </p>
);
