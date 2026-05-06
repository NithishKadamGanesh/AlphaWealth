import { useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell
} from "recharts";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { cn, fmtMoney } from "../lib/cn";

const BACKTEST_URL = import.meta.env.VITE_BACKTEST_URL || "http://localhost:8089";

const STRATEGIES = [
  { id: "SMA_CROSSOVER",      name: "SMA Crossover",       desc: "Fast SMA crosses slow SMA",     params: "fast=10, slow=50" },
  { id: "RSI_MEAN_REVERSION", name: "RSI Mean Reversion",  desc: "Buy oversold, sell overbought",  params: "period=14, OS=30, OB=70" },
  { id: "MACD_CROSSOVER",     name: "MACD Crossover",      desc: "MACD line crosses signal line",  params: "fast=12, slow=26, sig=9" },
  { id: "BOLLINGER_BOUNCE",   name: "Bollinger Bounce",    desc: "Buy lower band, sell upper",     params: "period=20, mult=2.0" },
  { id: "MEAN_REVERSION",     name: "Mean Reversion",      desc: "Buy when far below SMA",         params: "period=20, thresh=2%" },
  { id: "BREAKOUT",           name: "Donchian Breakout",   desc: "Buy on N-day high",              params: "period=20" },
  { id: "BUY_AND_HOLD",       name: "Buy and Hold",        desc: "Baseline benchmark",             params: "(none)" },
];

export const Backtest = () => {
  const [symbol, setSymbol] = useState("AAPL");
  const [strategy, setStrategy] = useState("SMA_CROSSOVER");
  const [capital, setCapital] = useState(100000);
  const [stopLoss, setStopLoss] = useState(0);
  const [takeProfit, setTakeProfit] = useState(0);
  const [result, setResult] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [running, setRunning] = useState(false);

  const runBacktest = async () => {
    setRunning(true); setResult(null);
    try {
      const r = await fetch(`${BACKTEST_URL}/api/backtest/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol, strategy, capital,
          positionPct: 0.95, commission: 1.0, slippage: 5,
          stopLossPct: stopLoss, takeProfitPct: takeProfit, params: {}
        })
      });
      const d = await r.json();
      setResult(d.error ? null : d);
    } catch { setResult(null); }
    setRunning(false);
  };

  const compareAll = async () => {
    setRunning(true); setComparison(null);
    try {
      const r = await fetch(`${BACKTEST_URL}/api/backtest/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, capital })
      });
      const d = await r.json();
      setComparison(d.error ? null : d);
    } catch { setComparison(null); }
    setRunning(false);
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Strategy Backtest"
        subtitle="Test strategies on historical data — Walk-forward — Monthly returns"
        badge={<Tag variant="accent">BACKTEST-SVC</Tag>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Config */}
        <Card className="animate-fade-in">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Configuration</div>
          <div className="space-y-4">
            <div>
              <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-1.5">Symbol</div>
              <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
                     className="w-full px-3 py-2.5 border border-line rounded-lg text-sm font-bold font-mono outline-none focus:border-ink/30 bg-transparent transition-colors" />
            </div>

            <div>
              <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-1.5">Strategy</div>
              <div className="space-y-1.5">
                {STRATEGIES.map(s => (
                  <button key={s.id} onClick={() => setStrategy(s.id)} className={cn(
                    "w-full p-3 rounded-lg text-left transition-all border",
                    s.id === strategy ? "bg-ink text-white border-ink" : "border-line hover:border-ink/30"
                  )}>
                    <div className="text-xs font-bold">{s.name}</div>
                    <div className={cn("text-2xs font-mono mt-0.5", s.id === strategy ? "text-zinc-400" : "text-muted")}>
                      {s.params}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-1.5">Starting Capital</div>
              <div className="flex items-center border border-line rounded-lg overflow-hidden focus-within:border-ink/30 transition-colors">
                <span className="px-3 py-2.5 bg-canvas font-mono text-muted">$</span>
                <input type="number" value={capital} step={1000}
                       onChange={e => setCapital(+e.target.value)}
                       className="flex-1 px-3 py-2.5 text-sm font-semibold font-mono outline-none bg-transparent" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-1.5">Stop-Loss %</div>
                <input type="number" value={stopLoss} step={1} placeholder="0 = off"
                       onChange={e => setStopLoss(+e.target.value)}
                       className="w-full px-3 py-2.5 border border-line rounded-lg text-sm font-mono outline-none focus:border-ink/30 bg-transparent" />
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-1.5">Take-Profit %</div>
                <input type="number" value={takeProfit} step={1} placeholder="0 = off"
                       onChange={e => setTakeProfit(+e.target.value)}
                       className="w-full px-3 py-2.5 border border-line rounded-lg text-sm font-mono outline-none focus:border-ink/30 bg-transparent" />
              </div>
            </div>

            <Button onClick={runBacktest} disabled={running} className="w-full gap-2">
              <Icon name="beaker" size={16} /> {running ? "Running..." : "Run Backtest"}
            </Button>
            <Button variant="secondary" onClick={compareAll} disabled={running} className="w-full">
              Compare All Strategies
            </Button>
          </div>
        </Card>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {!result && !comparison && !running && (
            <Card>
              <EmptyState
                icon={<Icon name="beaker" size={48} color={T.border} stroke={1.5} />}
                title="Configure & run"
                description="Select a strategy and click Run Backtest"
              />
            </Card>
          )}

          {running && (
            <Card>
              <div className="flex items-center justify-center gap-2 py-20 text-muted text-sm">
                <Pulse color="accent" /> Running backtest...
              </div>
            </Card>
          )}

          {result && !running && (
            <>
              <Card className="animate-fade-in">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                  <div className={cn("p-3 rounded-xl", result.totalPnlPct >= 0 ? "bg-positive" : "bg-negative")}>
                    <div className="text-2xs text-ink/60 uppercase font-mono">Total Return</div>
                    <div className="font-display text-2xl font-bold text-ink mt-1">{result.totalPnlPct?.toFixed(2)}%</div>
                  </div>
                  <div className="p-3 bg-canvas rounded-xl border border-line">
                    <div className="text-2xs text-subtle uppercase font-mono">Sharpe</div>
                    <div className="font-display text-2xl font-bold mt-1">{result.sharpeRatio?.toFixed(2)}</div>
                  </div>
                  <div className="p-3 bg-negative/5 border border-negative/20 rounded-xl">
                    <div className="text-2xs text-negative uppercase font-mono">Max DD</div>
                    <div className="font-display text-2xl font-bold text-negative mt-1">{result.maxDrawdownPct?.toFixed(2)}%</div>
                  </div>
                  <div className="p-3 bg-canvas rounded-xl border border-line">
                    <div className="text-2xs text-subtle uppercase font-mono">Win Rate</div>
                    <div className="font-display text-2xl font-bold mt-1">{result.winRate?.toFixed(0)}%</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-4 border-t border-line text-xs">
                  <div><div className="text-2xs text-subtle uppercase font-mono">Trades</div><div className="font-mono font-bold mt-1">{result.totalTrades}</div></div>
                  <div><div className="text-2xs text-subtle uppercase font-mono">PF</div><div className="font-mono font-bold mt-1">{result.profitFactor}</div></div>
                  <div><div className="text-2xs text-subtle uppercase font-mono">Avg Win</div><div className="font-mono font-bold mt-1 text-positive">+${result.avgWin}</div></div>
                  <div><div className="text-2xs text-subtle uppercase font-mono">Avg Loss</div><div className="font-mono font-bold mt-1 text-negative">-${result.avgLoss}</div></div>
                </div>
              </Card>

              <Card className="animate-slide-up" style={{ animationDelay: "50ms" }}>
                <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Equity Curve</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={(result.equityCurve || []).map((v, i) => ({ bar: i, equity: v }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                    <XAxis dataKey="bar" tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false}
                           tickFormatter={v => `$${(v/1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff" }}
                             formatter={v => [fmtMoney(v), "Equity"]} />
                    <Line type="monotone" dataKey="equity" stroke={T.lime} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              {result.monthlyReturns?.length > 0 && (
                <Card className="animate-slide-up" style={{ animationDelay: "100ms" }}>
                  <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Monthly Returns</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={result.monthlyReturns}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 9, fill: T.muted }} />
                      <YAxis tick={{ fontSize: 10, fill: T.muted }} tickFormatter={v => `${v}%`} />
                      <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff" }} />
                      <Bar dataKey="return" radius={[4, 4, 0, 0]}>
                        {result.monthlyReturns.map((m, i) => (
                          <Cell key={i} fill={m.return >= 0 ? T.lime : T.red} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
            </>
          )}

          {comparison && !running && (
            <Card padded={false} className="animate-fade-in">
              <div className="px-6 py-4 border-b border-line flex justify-between">
                <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">
                  Strategy Comparison — {comparison.symbol}
                </div>
                <Tag variant="default">{comparison.bars} bars</Tag>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-canvas">
                      {["Strategy", "Return %", "Sharpe", "Max DD", "Win %", "Trades", "Final $"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-2xs font-bold text-muted uppercase tracking-wider font-mono">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.comparisons?.sort((a, b) => b.totalReturn - a.totalReturn).map((c, i) => (
                      <tr key={c.strategy} className="border-b border-line hover:bg-canvas/50 transition-colors">
                        <td className="px-4 py-3.5 font-bold text-sm">
                          {i === 0 && <Tag variant="positive" className="mr-1.5">BEST</Tag>}
                          {c.strategy}
                        </td>
                        <td className={cn("px-4 py-3.5 font-mono text-sm font-bold", c.totalReturn >= 0 ? "text-positive" : "text-negative")}>
                          {c.totalReturn >= 0 ? "+" : ""}{c.totalReturn?.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3.5 font-mono text-sm">{c.sharpe?.toFixed(2)}</td>
                        <td className="px-4 py-3.5 font-mono text-sm text-negative">-{c.maxDrawdown?.toFixed(1)}%</td>
                        <td className="px-4 py-3.5 font-mono text-sm">{c.winRate?.toFixed(0)}%</td>
                        <td className="px-4 py-3.5 font-mono text-sm">{c.trades}</td>
                        <td className="px-4 py-3.5 font-mono text-sm">${c.endingCapital?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
