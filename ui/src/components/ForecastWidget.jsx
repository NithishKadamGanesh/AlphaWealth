import { useEffect } from "react";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "./ui/Card";
import { Tag, Pulse } from "./ui/Tag";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";
import { useForecast } from "../hooks/useForecast";

const dirVariant = (dir) =>
  dir === "BULLISH" ? "positive" : dir === "BEARISH" ? "negative" : "warning";

export const ForecastWidget = ({ symbol }) => {
  const { data, loading, error, generate, reset } = useForecast(symbol);
  const isFallback = Boolean(data?.fallback);

  useEffect(() => { reset(); }, [symbol, reset]);

  return (
    <Card padded={false}>
      <div className="px-5 py-4 border-b border-line flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <div className="flex items-center gap-2">
          <Icon name="target" size={14} color="rgb(var(--accent))" stroke={2.5} />
          <span className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">
            FinGPT-Forecaster — {symbol}
          </span>
          <Tag variant={isFallback ? "warning" : "accent"}>
            {isFallback ? "CPU fallback" : "GPU — LoRA — 7B"}
          </Tag>
        </div>
        {data?.direction && (
          <Tag variant={dirVariant(data.direction)}>
            {data.direction} — {data.confidence}%
          </Tag>
        )}
      </div>

      {!data && !loading && !error && (
        <div className="p-6 text-center">
          <div className="text-xs text-muted mb-3">
            Generate next-week directional forecast for {symbol}.
            Uses recent price action + FinBERT sentiment + indicators.
            Uses FinGPT on GPU, or a conservative local fallback on CPU-only Docker.
          </div>
          <Button variant="accent" onClick={generate} className="gap-1.5">
            <Icon name="sparkle" size={13} /> Generate Forecast
          </Button>
        </div>
      )}

      {loading && (
        <div className="p-8 text-center flex items-center justify-center gap-2 text-muted text-xs">
          <Pulse color="accent" />
          Running forecast...
        </div>
      )}

      {error && (
        <div className="p-5 text-xs bg-negative/5">
          <span className="text-negative font-medium">Forecast failed: {error}</span>
          <div className="text-muted mt-1.5">
            Make sure fingpt-svc is running. True FinGPT also needs GPU access or extra Docker memory.
          </div>
        </div>
      )}

      {data && (
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-5 mb-4">
            <div className={cn(
              "p-4 rounded-xl text-center border-2",
              `border-${dirVariant(data.direction)}`,
              `bg-${dirVariant(data.direction)}/5`
            )}>
              <div className={cn("font-display text-2xl font-extrabold", `text-${dirVariant(data.direction)}`)}>
                {data.direction}
              </div>
              <div className="text-2xs text-muted font-mono mt-1">next-week direction</div>
              <div className="mt-3 h-2 bg-line rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", `bg-${dirVariant(data.direction)}`)}
                     style={{ width: `${data.confidence}%` }} />
              </div>
              <div className="font-mono text-sm font-bold mt-2">{data.confidence}% confidence</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-2">Reasoning</div>
              <div className="text-sm leading-relaxed text-ink whitespace-pre-wrap">{data.analysis}</div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-line">
            <div className="text-2xs font-mono text-muted flex-1">
              {data.model} — ctx {data.context_chars}c — {new Date(data.computed_at).toLocaleTimeString()}
            </div>
            <Button variant="ghost" size="sm" onClick={generate} className="gap-1">
              <Icon name="refresh" size={11} /> Regenerate
            </Button>
          </div>

          <div className="mt-3 p-2.5 bg-warning/5 border border-warning/20 rounded-lg text-2xs text-warning">
            FinGPT predictions are statistical estimates, not investment advice.
            Past patterns do not guarantee future results.
          </div>
        </div>
      )}
    </Card>
  );
};
