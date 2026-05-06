// Design tokens — CSS variable backed for dark mode support.
// Legacy: pages that use inline styles reference T.xxx
// New code should use Tailwind classes (bg-ink, text-positive, etc.)

const cssVar = (name) => `rgb(var(--${name}))`;

export const T = {
  bg:      cssVar("canvas"),
  surface: cssVar("surface"),
  ink:     cssVar("ink"),
  border:  cssVar("line"),
  borderStrong: cssVar("ink"),
  muted:   cssVar("muted"),

  lime:    cssVar("positive"),
  limeBg:  "rgb(var(--positive) / 0.1)",
  blue:    "rgb(var(--accent))",
  blueBg:  "rgb(var(--accent) / 0.1)",
  pink:    "#ec4899",
  pinkBg:  "rgb(236 72 153 / 0.1)",
  amber:   cssVar("warning"),
  amberBg: "rgb(var(--warning) / 0.1)",
  violet:  "#7c3aed",
  violetBg:"rgb(124 58 237 / 0.1)",
  cyan:    cssVar("accent"),
  cyanBg:  "rgb(var(--accent) / 0.1)",
  red:     cssVar("negative"),
  redBg:   "rgb(var(--negative) / 0.1)",
};

export const FONT = {
  display: "'Space Grotesk', sans-serif",
  body:    "'Inter', system-ui, sans-serif",
  mono:    "'JetBrains Mono', monospace",
};

export const SIDEBAR_WIDTH = 240;
export const TICKER_HEIGHT = 36;
