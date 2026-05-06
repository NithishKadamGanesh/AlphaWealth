/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas:     "rgb(var(--canvas) / <alpha-value>)",
        surface:    "rgb(var(--surface) / <alpha-value>)",
        elevated:   "rgb(var(--elevated) / <alpha-value>)",
        ink:        "rgb(var(--ink) / <alpha-value>)",
        muted:      "rgb(var(--muted) / <alpha-value>)",
        subtle:     "rgb(var(--subtle) / <alpha-value>)",
        line:       "rgb(var(--line) / <alpha-value>)",
        positive:   "rgb(var(--positive) / <alpha-value>)",
        negative:   "rgb(var(--negative) / <alpha-value>)",
        warning:    "rgb(var(--warning) / <alpha-value>)",
        accent:     "rgb(var(--accent) / <alpha-value>)",
        accentSoft: "rgb(var(--accent-soft) / <alpha-value>)",
      },
      fontFamily: {
        sans:    ["Inter", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "system-ui", "sans-serif"],
        mono:    ["'JetBrains Mono'", "monospace"],
      },
      fontSize: {
        "2xs":   ["0.6875rem", { lineHeight: "1rem" }],
        "xs":    ["0.75rem",   { lineHeight: "1.125rem" }],
        "sm":    ["0.8125rem", { lineHeight: "1.25rem" }],
        "base":  ["0.9375rem", { lineHeight: "1.5rem" }],
        "lg":    ["1.0625rem", { lineHeight: "1.625rem" }],
        "xl":    ["1.25rem",   { lineHeight: "1.75rem" }],
        "2xl":   ["1.5rem",    { lineHeight: "2rem" }],
        "3xl":   ["1.875rem",  { lineHeight: "2.25rem" }],
        "4xl":   ["2.5rem",    { lineHeight: "1" }],
        "5xl":   ["3.5rem",    { lineHeight: "1" }],
        "6xl":   ["4.5rem",    { lineHeight: "1" }],
        "7xl":   ["6rem",      { lineHeight: "1" }],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter:  "-0.03em",
        tight:    "-0.02em",
      },
      boxShadow: {
        "subtle": "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.04)",
        "soft":   "0 2px 8px -2px rgb(0 0 0 / 0.06), 0 1px 3px -1px rgb(0 0 0 / 0.04)",
        "lift":   "0 12px 24px -8px rgb(0 0 0 / 0.08), 0 4px 8px -4px rgb(0 0 0 / 0.04)",
        "glow":   "0 0 0 4px rgb(var(--accent) / 0.12)",
      },
      animation: {
        "fade-in":    "fade-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
        "slide-up":   "slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-down": "slide-down 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in":   "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        "shimmer":    "shimmer 2s ease-in-out infinite",
        "count-up":   "count-up 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-ring": "pulse-ring 2s infinite",
        "spin-slow":  "spin 3s linear infinite",
      },
      keyframes: {
        "fade-in":    { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        "slide-up":   {
          "0%":   { opacity: 0, transform: "translateY(12px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "slide-down": {
          "0%":   { opacity: 0, transform: "translateY(-8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "scale-in":   {
          "0%":   { opacity: 0, transform: "scale(0.95)" },
          "100%": { opacity: 1, transform: "scale(1)" },
        },
        "shimmer":    {
          "0%":   { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      backgroundImage: {
        "mesh-light": "radial-gradient(at 0% 0%, rgb(var(--accent) / 0.04) 0%, transparent 50%), radial-gradient(at 100% 100%, rgb(var(--positive) / 0.03) 0%, transparent 50%)",
        "mesh-dark":  "radial-gradient(at 0% 0%, rgb(var(--accent) / 0.10) 0%, transparent 50%), radial-gradient(at 100% 100%, rgb(var(--positive) / 0.06) 0%, transparent 50%)",
      },
      screens: {
        "xs": "480px",
      },
    },
  },
  plugins: [],
};
