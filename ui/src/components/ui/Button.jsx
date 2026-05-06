// ui/src/components/ui/Button.jsx
import { cn } from "../../lib/cn";

const variants = {
  primary:   "bg-ink text-canvas hover:bg-ink/90",
  secondary: "bg-surface text-ink border border-line hover:bg-canvas",
  ghost:     "text-muted hover:text-ink hover:bg-canvas",
  accent:    "bg-accent text-white hover:bg-accent/90",
  danger:    "bg-negative text-white hover:bg-negative/90",
};

const sizes = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export const Button = ({
  children, variant = "primary", size = "md",
  className, disabled, ...props
}) => (
  <button
    disabled={disabled}
    className={cn(
      "inline-flex items-center justify-center font-medium rounded-lg",
      "transition-all duration-150 ease-out",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      "active:scale-[0.98]",
      variants[variant], sizes[size],
      className,
    )}
    {...props}
  >
    {children}
  </button>
);
