import { useState, useEffect } from "react";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { cn } from "../lib/cn";

const ANALYSIS_URL = import.meta.env.VITE_ANALYSIS_URL || "http://localhost:8088";
const WATCHLIST = ["AAPL", "NVDA", "MSFT", "AMZN", "TSLA", "GOOGL", "META", "AMD", "VOO"];

const biasVariant = (bias) =>
  bias === "BULLISH" ? "positive" : bias === "BEARISH" ? "negative" : "warning";

export const Patterns = () => {
  const [selected, setSelected] = useState("AAPL");
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanResults, setScanResults] = useState({});

  useEffect(() => {
    setLoading(true);
    fetch(`${ANALYSIS_URL}/api/analysis/${selected}/patterns`)
      .then(r => r.json())
      .then(data => { setPatterns(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setPatterns([]); setLoading(false); });
  }, [selected]);

  const scanWatchlist = async () => {
    const results = {};
    for (const sym of WATCHLIST) {
      try {
        const r = await fetch(`${ANALYSIS_URL}/api/analysis/${sym}/patterns`, { signal: AbortSignal.timeout(8000) });
        const data = await r.json();
        results[sym] = Array.isArray(data) ? data : [];
      } catch { results[sym] = []; }
    }
    setScanResults(results);
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Pattern Detection"
        subtitle="Chart patterns from analysis-svc — Double Top/Bottom, H&S, Triangles, Candles"
        badge={<Tag variant="accent">ANALYSIS-SVC</Tag>}
      />

      {/* Symbol picker */}
      <Card padded={false} className="p-4 animate-fade-in">
        <div className="flex justify-between items-center mb-3">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Watchlist</div>
          <button onClick={scanWatchlist}
            className="px-3 py-2 rounded-lg bg-ink text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-ink/90 transition-colors">
            <Icon name="refresh" size={12} /> Scan All
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {WATCHLIST.map(sym => {
            const scanData = scanResults[sym];
            const sel = sym === selected;
            const count = scanData ? scanData.length : null;
            return (
              <button key={sym} onClick={() => setSelected(sym)} className={cn(
                "px-4 py-2.5 rounded-lg transition-all flex items-center gap-2",
                sel ? "bg-ink text-white" : "border border-line hover:border-ink/30"
              )}>
                <span className="font-mono text-sm font-bold">{sym}</span>
                {count !== null && <Tag variant={count > 0 ? "positive" : "default"}>{count}</Tag>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Results */}
      <Card className="animate-slide-up" style={{ animationDelay: "50ms" }}>
        <div className="flex justify-between items-start mb-5">
          <div>
            <div className="font-display text-xl font-bold">
              {selected} <span className="text-muted text-sm font-normal ml-1">Detected Patterns</span>
            </div>
            <div className="text-xs text-muted mt-1">
              {loading ? "Scanning..." : `${patterns.length} patterns found in last ~2 years`}
            </div>
          </div>
          {loading && <Pulse color="accent" />}
        </div>

        {!loading && patterns.length === 0 && (
          <EmptyState icon={<Icon name="puzzle" size={48} color={T.border} stroke={1.5} />}
            title={`No patterns for ${selected}`}
            description="Try a different symbol or wait for more price action" />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {patterns.map((p, i) => (
            <div key={i} className={cn(
              "p-4 rounded-xl bg-canvas border border-line border-l-4",
              `border-l-${biasVariant(p.bias)}`
            )}>
              <div className="flex justify-between items-start mb-2.5">
                <span className="font-display text-sm font-bold">{p.name}</span>
                <Tag variant={biasVariant(p.bias)}>{p.bias}</Tag>
              </div>
              <div className="text-xs text-muted mb-3">{p.description}</div>
              <div className="flex gap-4 text-xs font-mono">
                <div>
                  <div className="text-2xs text-subtle uppercase">Type</div>
                  <div className="font-bold mt-0.5">{p.type}</div>
                </div>
                <div>
                  <div className="text-2xs text-subtle uppercase">Confidence</div>
                  <div className={cn("font-bold mt-0.5", `text-${biasVariant(p.bias)}`)}>
                    {(p.confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div className="text-2xs text-subtle uppercase">Bars</div>
                  <div className="font-bold mt-0.5">{p.startIdx} → {p.endIdx}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Pattern legend */}
      <Card className="animate-slide-up" style={{ animationDelay: "100ms" }}>
        <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Pattern Reference</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {[
            { name: "Double Top",        type: "REVERSAL",     bias: "BEARISH", desc: "Resistance tested twice" },
            { name: "Double Bottom",     type: "REVERSAL",     bias: "BULLISH", desc: "Support tested twice" },
            { name: "Head and Shoulders", type: "REVERSAL",    bias: "BEARISH", desc: "Three peaks, middle highest" },
            { name: "Ascending Triangle", type: "CONTINUATION", bias: "BULLISH", desc: "Flat top, rising lows" },
            { name: "Descending Triangle", type: "CONTINUATION", bias: "BEARISH", desc: "Flat bottom, falling highs" },
            { name: "Bullish Engulfing", type: "CANDLESTICK",  bias: "BULLISH", desc: "Reversal up" },
            { name: "Bearish Engulfing", type: "CANDLESTICK",  bias: "BEARISH", desc: "Reversal down" },
            { name: "Doji",              type: "CANDLESTICK",  bias: "NEUTRAL", desc: "Indecision" },
            { name: "Hammer",            type: "CANDLESTICK",  bias: "BULLISH", desc: "Reversal at bottom" },
          ].map(p => (
            <div key={p.name} className={cn("p-3 bg-canvas rounded-lg border-l-[3px]", `border-${biasVariant(p.bias)}`)}>
              <div className="text-xs font-bold mb-1">{p.name}</div>
              <div className="text-2xs text-muted mb-2">{p.desc}</div>
              <Tag variant="default">{p.type}</Tag>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
