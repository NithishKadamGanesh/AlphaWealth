// ui/src/components/ui/Sparkline.jsx
// Minimal SVG sparkline — refined, no recharts overhead
import { cn } from "../../lib/cn";

export const Sparkline = ({ data, width = 120, height = 36, className, color }) => {
  if (!data || data.length < 2) {
    return <div className={cn("skeleton", className)} style={{ width, height }} />;
  }

  const values = data.map(d => typeof d === "number" ? d : d.v ?? d.value ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const trend = values[values.length - 1] >= values[0] ? "positive" : "negative";
  const strokeColor = color || `rgb(var(--${trend}))`;
  const fillColor   = color || `rgb(var(--${trend}) / 0.12)`;
  const id = `spark-${Math.random().toString(36).slice(2, 9)}`;

  // Build area path
  const lastX = width;
  const firstX = 0;
  const areaPath = `M ${firstX},${height} L ${points.replace(/ /g, " L ")} L ${lastX},${height} Z`;

  return (
    <svg width={width} height={height} className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={strokeColor} stopOpacity={0.18} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
