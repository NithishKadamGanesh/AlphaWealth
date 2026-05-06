import { useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine
} from "recharts";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { SkeletonCard } from "../components/ui/Skeleton";
import { cn, fmtMoney } from "../lib/cn";
import { useSymbolSentiment } from "../hooks/useSentiment";
import { ForecastWidget } from "../components/ForecastWidget";

const ANALYSIS_URL  = import.meta.env.VITE_ANALYSIS_URL  || "http://localhost:8088";
const LIVE_DATA_URL = import.meta.env.VITE_LIVE_DATA_URL || "http://localhost:8096";

const sentColor = (label) =>
  label === "positive" ? "positive" : label === "negative" ? "negative" : "warning";

const biasColor = (bias) =>
  bias === "BULLISH" ? "positive" : bias === "BEARISH" ? "negative" : "warning";

const convColor = (c) => {
  if (!c) return "muted";
  if (c.includes("STRONG_BUY")) return "positive";
  if (c.includes("MODERATE_BUY")) return "accent";
  if (c.includes("STRONG_SELL")) return "negative";
  if (c.includes("MODERATE_SELL")) return "negative";
  if (c.includes("CONFLICTING")) return "warning";
  return "muted";
};

export const Markets = ({ quotes }) => {
  const [selectedSym, setSelectedSym] = useState("AAPL");
  const [period, setPeriod] = useState("1mo");
  const [chartData, setChartData] = useState([]);
  const [levels, setLevels] = useState(null);
  const [signal, setSignal] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [convergence, setConvergence] = useState(null);
  const [indices, setIndices] = useState([]);
  const [sectors, setSectors] = useState([]);

  const { data: sentiment, loading: sentLoading } = useSymbolSentiment(selectedSym);

  useEffect(() => {
    fetch(`${LIVE_DATA_URL}/history/${selectedSym}?period=${period}&interval=1d`)
      .then(r => r.json())
      .then(d => setChartData((d.bars || []).map((b, i) => ({ t: i, date: b.date, price: b.close }))))
      .catch(() => setChartData([]));
  }, [selectedSym, period]);

  useEffect(() => {
    const ctl = new AbortController();
    const opts = { signal: ctl.signal };
    fetch(`${ANALYSIS_URL}/api/analysis/${selectedSym}/levels`, opts)
      .then(r => r.json()).then(d => setLevels(d.error ? null : d)).catch(() => {});
    fetch(`${ANALYSIS_URL}/api/analysis/${selectedSym}/signal`, opts)
      .then(r => r.json()).then(d => setSignal(d.error ? null : d)).catch(() => {});
    fetch(`${ANALYSIS_URL}/api/analysis/${selectedSym}/patterns`, opts)
      .then(r => r.json()).then(d => setPatterns(Array.isArray(d) ? d.slice(-5).reverse() : []))
      .catch(() => setPatterns([]));
    fetch(`${ANALYSIS_URL}/api/analysis/${selectedSym}/multitimeframe`, opts)
      .then(r => r.json()).then(d => setConvergence(d.error ? null : d)).catch(() => {});
    return () => ctl.abort();
  }, [selectedSym]);

  // Fetch live indices
  useEffect(() => {
    fetch(`${LIVE_DATA_URL}/quotes?symbols=^GSPC,^DJI,^IXIC,^VIX`)
      .then(r => r.json())
      .then(d => {
        const mapped = Object.entries(d).map(([ticker, q]) => ({
          ticker, name: { "^GSPC": "S&P 500", "^DJI": "Dow Jones", "^IXIC": "Nasdaq", "^VIX": "VIX" }[ticker] || ticker,
          value: q.price, change: q.change_pct
        }));
        if (mapped.length > 0) setIndices(mapped);
      })
      .catch(() => {});

    fetch(`${ANALYSIS_URL}/api/analysis/sectors`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d) && d.length > 0) setSectors(d); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Market Intelligence"
        subtitle="yfinance — analysis-svc — FinBERT sentiment — FinGPT-Forecaster"
        badge={
          <>
            <Tag variant="positive" dot>LIVE</Tag>
            <Tag variant="accent">ANALYSIS-SVC</Tag>
            <Tag variant="accent">FINBERT</Tag>
          </>
        }
      />

      {/* Indices + Fear/Greed */}
      {indices.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in">
          <Card className="lg:col-span-2">
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-3">Major Indices</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {indices.map(idx => (
                <div key={idx.ticker} className={cn(
                  "p-3 bg-canvas rounded-lg border-l-[3px]",
                  idx.change >= 0 ? "border-positive" : "border-negative"
                )}>
                  <div className="text-xs text-muted font-semibold">{idx.name}</div>
                  <div className="font-display text-lg font-bold tracking-tight mt-0.5">{idx.value?.toFixed(2)}</div>
                  <div className={cn("text-xs font-mono font-bold mt-1", idx.change >= 0 ? "text-positive" : "text-negative")}>
                    {idx.change >= 0 ? "+" : ""}{idx.change?.toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="bg-ink text-white border-ink">
            <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Fear & Greed Index</div>
            <div className="text-center mt-4 text-zinc-500 text-xs font-mono">
              Connect to live-data-svc for real-time index
            </div>
          </Card>
        </div>
      )}

      {/* Symbol picker */}
      <Card padded={false} className="p-3 animate-slide-up" style={{ animationDelay: "50ms" }}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Object.keys(quotes).map(s => {
            const q = quotes[s];
            const sel = s === selectedSym;
            return (
              <button key={s} onClick={() => setSelectedSym(s)} className={cn(
                "flex-shrink-0 px-4 py-2.5 rounded-lg transition-all text-left",
                sel ? "bg-ink text-white" : "bg-transparent border border-line text-ink hover:border-ink/30"
              )}>
                <div className="font-mono text-xs font-bold">{s}</div>
                <div className={cn("font-mono text-2xs mt-0.5", q.change_pct >= 0 ? "text-positive" : "text-negative")}>
                  ${q.price.toFixed(2)} {q.change_pct >= 0 ? "+" : ""}{q.change_pct.toFixed(2)}%
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Main chart + Signal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
        <Card className="lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
            <div>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-3xl font-extrabold">{selectedSym}</span>
                <span className={cn("font-display text-2xl font-bold", quotes[selectedSym]?.change_pct >= 0 ? "text-positive" : "text-negative")}>
                  ${quotes[selectedSym]?.price?.toFixed(2)}
                </span>
                <span className={cn("text-xs font-mono font-bold", quotes[selectedSym]?.change_pct >= 0 ? "text-positive" : "text-negative")}>
                  {quotes[selectedSym]?.change_pct >= 0 ? "+" : ""}{quotes[selectedSym]?.change_pct?.toFixed(2)}%
                </span>
              </div>
              <div className="text-xs text-muted mt-1">
                yfinance — {chartData.length} bars — {levels ? "S/R overlay active" : "loading levels..."}
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[["1D","5d"],["1M","1mo"],["3M","3mo"],["6M","6mo"],["1Y","1y"],["5Y","5y"]].map(([lbl, p]) => (
                <button key={p} onClick={() => setPeriod(p)} className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all",
                  p === period ? "bg-positive text-ink" : "text-muted border border-line hover:border-ink/30"
                )}>{lbl}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="mkt-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.lime} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={T.lime} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: T.muted }} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: T.muted }} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff" }}
                       labelFormatter={(_, p) => p?.[0]?.payload?.date || ""}
                       formatter={(v) => [`$${v?.toFixed?.(2)}`, "Close"]} />
              <Area type="monotone" dataKey="price" stroke={T.lime} strokeWidth={2.5} fill="url(#mkt-grad)" />
              {levels?.support?.slice(0, 3).map((lvl, i) => (
                <ReferenceLine key={`s${i}`} y={lvl} stroke={T.lime} strokeDasharray="4 4" strokeOpacity={0.6}
                               label={{ value: `S ${lvl?.toFixed(2)}`, position: "right", fill: T.lime, fontSize: 10 }} />
              ))}
              {levels?.resistance?.slice(0, 3).map((lvl, i) => (
                <ReferenceLine key={`r${i}`} y={lvl} stroke={T.red} strokeDasharray="4 4" strokeOpacity={0.6}
                               label={{ value: `R ${lvl?.toFixed(2)}`, position: "right", fill: T.red, fontSize: 10 }} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="bg-ink text-white border-ink">
          <div className="flex justify-between items-center mb-4">
            <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Signal — {selectedSym}</div>
            <Pulse color="positive" />
          </div>
          {signal ? (
            <>
              <div className={cn(
                "inline-block px-5 py-3 rounded-xl mb-4",
                signal.action === "BUY" ? "bg-positive" : signal.action === "SELL" ? "bg-negative" : "bg-warning"
              )}>
                <div className="font-display text-2xl font-extrabold text-ink">{signal.action}</div>
                <div className="text-2xs font-mono text-ink/70">confidence {(signal.confidence * 100).toFixed(0)}%</div>
              </div>
              <div className="text-xs text-zinc-400 mb-3">
                Regime: <span className="text-positive font-mono">{signal.regime}</span>
              </div>
            </>
          ) : (
            <div className="text-muted text-xs py-2">Waiting for analysis-svc...</div>
          )}

          {convergence?.convergence && (
            <div className="p-3 bg-zinc-900 rounded-lg mb-3">
              <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Multi-Timeframe</div>
              <div className={cn("font-display text-sm font-bold mt-1", `text-${convColor(convergence.convergence)}`)}>
                {convergence.convergence.replace(/_/g, " ")}
              </div>
              <div className="text-2xs text-zinc-400 mt-1">Score: {(convergence.convergenceScore * 100).toFixed(0)}%</div>
            </div>
          )}

          {signal?.indicators && (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(signal.indicators).slice(0, 6).map(([k, v]) => (
                <div key={k} className="p-2 bg-zinc-900 rounded-lg">
                  <div className="text-2xs text-zinc-500 font-mono">{k}</div>
                  <div className="font-mono text-xs font-bold text-white mt-0.5">
                    {typeof v === "number" ? v.toFixed(2) : String(v).slice(0, 8)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* FinBERT Sentiment */}
      <Card padded={false} className="animate-slide-up" style={{ animationDelay: "200ms" }}>
        <div className="px-5 py-4 border-b border-line flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <Icon name="sparkle" size={14} color={T.cyan} stroke={2.5} />
            <span className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">News Sentiment — {selectedSym}</span>
            <Tag variant="accent">FinBERT — GPU</Tag>
          </div>
          {sentiment?.aggregated && (
            <div className="flex items-center gap-3">
              <span className="text-2xs text-muted font-mono">{sentiment.aggregated.article_count} articles</span>
              <Tag variant={sentColor(sentiment.aggregated.label)}>{sentiment.aggregated.label.toUpperCase()}</Tag>
            </div>
          )}
        </div>

        {sentLoading && (
          <div className="p-8 text-center text-muted text-xs flex items-center justify-center gap-2">
            <Pulse color="accent" /> Scoring news with FinBERT...
          </div>
        )}

        {!sentLoading && !sentiment && (
          <div className="p-8 text-center text-muted text-xs">
            Sentiment service unavailable. Start with: <code className="bg-canvas px-1.5 py-0.5 rounded text-2xs">docker compose up sentiment-svc</code>
          </div>
        )}

        {sentiment?.aggregated && (
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr]">
            <div className="p-6 border-b md:border-b-0 md:border-r border-line">
              <div className="relative w-48 h-24 mx-auto">
                <svg viewBox="0 0 200 100" className="w-full h-full">
                  <path d="M 20 95 A 80 80 0 0 1 180 95" stroke={T.border} strokeWidth="14" fill="none" strokeLinecap="round" />
                  <path d="M 20 95 A 80 80 0 0 1 180 95"
                        stroke={T[sentColor(sentiment.aggregated.label) === "positive" ? "lime" : sentColor(sentiment.aggregated.label) === "negative" ? "red" : "amber"]}
                        strokeWidth="14" fill="none" strokeLinecap="round"
                        strokeDasharray={`${((sentiment.aggregated.score + 1) / 2) * 251} 251`} />
                </svg>
                <div className="absolute bottom-0 left-0 right-0 text-center">
                  <div className={cn("font-display text-2xl font-extrabold", `text-${sentColor(sentiment.aggregated.label)}`)}>
                    {sentiment.aggregated.score >= 0 ? "+" : ""}{sentiment.aggregated.score.toFixed(2)}
                  </div>
                  <div className="text-2xs text-muted font-mono">FinBERT Score</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-line text-center">
                <div>
                  <div className="text-2xs text-positive font-mono">Positive</div>
                  <div className="font-mono text-lg font-extrabold text-positive mt-1">{sentiment.aggregated.positive_count}</div>
                </div>
                <div>
                  <div className="text-2xs text-warning font-mono">Neutral</div>
                  <div className="font-mono text-lg font-extrabold text-warning mt-1">{sentiment.aggregated.neutral_count}</div>
                </div>
                <div>
                  <div className="text-2xs text-negative font-mono">Negative</div>
                  <div className="font-mono text-lg font-extrabold text-negative mt-1">{sentiment.aggregated.negative_count}</div>
                </div>
              </div>
            </div>

            <div className="p-4 max-h-80 overflow-y-auto space-y-1.5">
              {(sentiment.articles || []).slice(0, 8).map((a, i) => (
                <div key={i} className={cn(
                  "p-3 rounded-lg bg-canvas border-l-[3px]",
                  `border-${sentColor(a.sentiment?.label)}`
                )}>
                  <div className="flex gap-3 items-start">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold leading-snug">
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-ink hover:underline">{a.title}</a>
                        ) : a.title}
                      </div>
                      <div className="text-2xs text-muted font-mono mt-1">{a.source || "?"} — {a.published || ""}</div>
                    </div>
                    {a.sentiment && (
                      <div className="text-right flex-shrink-0">
                        <Tag variant={sentColor(a.sentiment.label)}>{a.sentiment.label.slice(0, 3).toUpperCase()}</Tag>
                        <div className="text-2xs text-muted font-mono mt-0.5">
                          {a.sentiment.score >= 0 ? "+" : ""}{a.sentiment.score.toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {(!sentiment.articles || sentiment.articles.length === 0) && (
                <div className="py-6 text-center text-muted text-xs">No recent news for {selectedSym}</div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* FinGPT Forecaster */}
      <div className="animate-slide-up" style={{ animationDelay: "300ms" }}>
        <ForecastWidget symbol={selectedSym} />
      </div>

      {/* Patterns */}
      {patterns.length > 0 && (
        <Card className="animate-slide-up" style={{ animationDelay: "350ms" }}>
          <div className="flex justify-between items-center mb-4">
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">
              Recent Patterns — {selectedSym}
            </div>
            <Tag variant="accent">{patterns.length} found</Tag>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {patterns.map((p, i) => (
              <div key={i} className={cn(
                "p-4 bg-canvas rounded-lg border-l-[3px]",
                `border-${biasColor(p.bias)}`
              )}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm font-bold">{p.name}</span>
                  <Tag variant={biasColor(p.bias)}>{p.bias}</Tag>
                </div>
                <div className="text-xs text-muted mb-2">{p.description}</div>
                <div className="text-2xs text-muted font-mono">
                  conf {(p.confidence * 100).toFixed(0)}% — bars {p.startIdx}-{p.endIdx}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sectors */}
      {sectors.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "400ms" }}>
          <Card className="lg:col-span-2">
            <div className="flex justify-between mb-4">
              <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Sector Performance</div>
              <Tag variant="default">{sectors.length} sectors</Tag>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {sectors.map(s => (
                <div key={s.name} className={cn(
                  "p-4 rounded-lg border",
                  s.change >= 0 ? "bg-positive/10 border-positive/20" : "bg-negative/10 border-negative/20"
                )}>
                  <div className="text-xs font-semibold text-ink">{s.name}</div>
                  <div className={cn("font-mono text-lg font-extrabold mt-1", s.change >= 0 ? "text-positive" : "text-negative")}>
                    {s.change >= 0 ? "+" : ""}{s.change.toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Top Movers</div>
            <div className="text-center py-8 text-muted text-xs">
              Connect live-data-svc for real-time movers
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
