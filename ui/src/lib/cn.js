// ui/src/lib/cn.js
// className merge helper — combines clsx + tailwind-merge for clean conditional classes
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs) => twMerge(clsx(inputs));

// Number formatting helpers
export const fmtMoney = (n, opts = {}) => {
  if (n == null || isNaN(n)) return "—";
  const { decimals = 0, compact = false } = opts;
  if (compact && Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  if (compact && Math.abs(n) >= 1_000) {
    return `$${(n / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
};

export const fmtPct = (n, decimals = 2) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
};

export const fmtNum = (n, decimals = 0) => {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
};
