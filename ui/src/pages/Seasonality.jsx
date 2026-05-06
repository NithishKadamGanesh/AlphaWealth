import { useState, useEffect } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell
} from "recharts";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { cn } from "../lib/cn";

const ANALYSIS_URL = import.meta.env.VITE_ANALYSIS_URL || "http://localhost:8088";
const WATCHLIST = ["AAPL", "NVDA", "MSFT", "AMZN", "TSLA", "GOOGL", "META", "VOO", "SPY"];

export const Seasonality = () => {
  const [symbol, setSymbol] = useState("AAPL");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${ANALYSIS_URL}/api/analysis/${symbol}/seasonality`)
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  }, [symbol]);

  const monthShort = (name) => name?.slice(0, 3) || "";

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Seasonality Analysis"
        subtitle="When does this stock historically perform best?"
        badge={<Tag variant="accent">ANALYSIS-SVC</Tag>}
      />

      {/* Symbol picker */}
      <Card padded={false} className="p-4 animate-fade-in">
        <div className="flex gap-2 flex-wrap">
          {WATCHLIST.map(sym => (
            <button key={sym} onClick={() => setSymbol(sym)} className={cn(
              "px-4 py-2.5 rounded-lg font-mono text-sm font-bold transition-all",
              sym === symbol ? "bg-ink text-white" : "border border-line hover:border-ink/30"
            )}>{sym}</button>
          ))}
        </div>
      </Card>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-muted text-sm py-10">
          <Pulse color="accent" /> Loading seasonality data...
        </div>
      )}

      {!loading && data && (
        <>
          {/* Best & Worst */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-slide-up" style={{ animationDelay: "50ms" }}>
            <Card className="bg-positive/10 border-positive/20">
              <div className="text-xs uppercase tracking-wider text-positive font-medium font-mono mb-3 flex items-center gap-2">
                <Icon name="arrow_up" size={10} /> Best Buy Months
              </div>
              <div className="space-y-2">
                {(data.bestBuyMonths || []).map((m, i) => {
                  const stat = data.monthly?.find(s => s.name === m);
                  return (
                    <div key={m} className="flex justify-between items-center p-3 bg-ink rounded-lg text-white">
                      <div className="flex items-center gap-3">
                        <span className="font-display text-lg font-extrabold text-positive">#{i+1}</span>
                        <span className="font-semibold">{monthShort(m)}</span>
                      </div>
                      {stat && (
                        <div className="flex gap-3 font-mono text-xs">
                          <span className="text-positive">+{stat.avgReturn?.toFixed(2)}%</span>
                          <span className="text-zinc-400">{stat.winRate?.toFixed(0)}% wr</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="bg-negative/5 border-negative/20">
              <div className="text-xs uppercase tracking-wider text-negative font-medium font-mono mb-3 flex items-center gap-2">
                <Icon name="arrow_dn" size={10} /> Worst Months
              </div>
              <div className="space-y-2">
                {(data.worstMonths || []).map((m, i) => {
                  const stat = data.monthly?.find(s => s.name === m);
                  return (
                    <div key={m} className="flex justify-between items-center p-3 bg-ink rounded-lg text-white">
                      <div className="flex items-center gap-3">
                        <span className="font-display text-lg font-extrabold text-negative">#{i+1}</span>
                        <span className="font-semibold">{monthShort(m)}</span>
                      </div>
                      {stat && (
                        <div className="flex gap-3 font-mono text-xs">
                          <span className="text-negative">{stat.avgReturn?.toFixed(2)}%</span>
                          <span className="text-zinc-400">{stat.winRate?.toFixed(0)}% wr</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Monthly chart */}
          <Card className="animate-slide-up" style={{ animationDelay: "100ms" }}>
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">
              Average Monthly Return — {symbol}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(data.monthly || []).map(m => ({...m, short: monthShort(m.name)}))}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                <XAxis dataKey="short" tick={{ fontSize: 11, fill: T.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff" }}
                         formatter={(v, n) => [`${v?.toFixed?.(2)}%`, n]} />
                <Bar dataKey="avgReturn" radius={[6, 6, 0, 0]}>
                  {(data.monthly || []).map((m, i) => (
                    <Cell key={i} fill={m.avgReturn >= 0 ? T.lime : T.red} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Day of week + Weekly heat */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-slide-up" style={{ animationDelay: "150ms" }}>
            <Card>
              <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Day of Week Performance</div>
              <div className="space-y-0">
                {(data.dayOfWeek || []).map(d => {
                  const positive = d.avgReturn >= 0;
                  return (
                    <div key={d.day} className="flex items-center gap-4 py-3 border-b border-line last:border-0">
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center font-mono text-2xs font-extrabold",
                        positive ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
                      )}>{d.day.slice(0, 3)}</div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold">{d.day}</div>
                        <div className="text-2xs text-muted font-mono mt-0.5">{d.sampleSize} samples</div>
                      </div>
                      <div className="text-right">
                        <div className={cn("font-mono text-sm font-bold", positive ? "text-positive" : "text-negative")}>
                          {positive ? "+" : ""}{d.avgReturn?.toFixed(3)}%
                        </div>
                        <div className="text-2xs text-muted font-mono mt-0.5">{d.winRate?.toFixed(0)}% win</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Week-of-Year Heat</div>
              <div className="grid grid-cols-13 gap-1">
                {(data.weekly || []).slice(0, 52).map(w => {
                  const intensity = Math.min(Math.abs(w.avgReturn) / 2, 1);
                  return (
                    <div key={w.week}
                         title={`Week ${w.week}: ${w.avgReturn?.toFixed(2)}%`}
                         className="h-5 rounded-sm transition-colors"
                         style={{
                           background: w.sampleSize === 0 ? T.border
                             : w.avgReturn >= 0
                               ? `rgb(var(--positive) / ${0.1 + intensity * 0.6})`
                               : `rgb(var(--negative) / ${0.1 + intensity * 0.6})`
                         }} />
                  );
                })}
              </div>
              <div className="flex justify-between mt-3 text-2xs text-muted font-mono">
                <span>Week 1</span><span>Week 26</span><span>Week 52</span>
              </div>
              <div className="flex items-center gap-2 mt-3 text-2xs text-muted">
                <div className="w-3 h-3 rounded-sm bg-negative/40" /> Bad weeks
                <div className="w-3 h-3 rounded-sm bg-line ml-3" /> No data
                <div className="w-3 h-3 rounded-sm bg-positive/40 ml-3" /> Good weeks
              </div>
            </Card>
          </div>
        </>
      )}

      {!loading && !data && (
        <Card>
          <EmptyState
            icon={<Icon name="calendar" size={48} color={T.border} stroke={1.5} />}
            title="No seasonality data"
            description="Make sure analysis-svc is running on :8088"
          />
        </Card>
      )}
    </div>
  );
};
