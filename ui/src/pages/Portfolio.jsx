import { useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip
} from "recharts";
import { Briefcase } from "lucide-react";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { Sparkline } from "../components/ui/Sparkline";
import { SkeletonCard } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { cn, fmtMoney, fmtPct } from "../lib/cn";
import { useIbkrPositions } from "../hooks/useIbkrPositions";

const ANALYSIS_URL = import.meta.env.VITE_ANALYSIS_URL || "http://localhost:8088";

const formatLastSync = (ts) => {
  if (!ts) return "never";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const Portfolio = () => {
  const { positions, summary, status, dataMode, isReal, loading, lastError, refresh } = useIbkrPositions();
  const [optimization, setOptimization] = useState(null);
  const [optimizing, setOptimizing] = useState(false);

  const investedValue = positions.reduce((s, h) => s + (h.marketValue || h.shares * h.price), 0);
  const totalCost = positions.reduce((s, h) => s + h.shares * h.cost, 0);
  const totalValue = summary?.netLiquidation ?? investedValue;
  const totalCash = summary?.totalCash ?? 0;
  const totalGain = investedValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  useEffect(() => {
    if (positions.length < 2) return;
    const symbols = positions.slice(0, 8).map(p => p.ticker);
    setOptimizing(true);
    fetch(`${ANALYSIS_URL}/api/analysis/portfolio/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
      signal: AbortSignal.timeout(15_000)
    }).then(r => r.json())
      .then(d => { setOptimization(d.error ? null : d); setOptimizing(false); })
      .catch(() => setOptimizing(false));
  }, [positions.map(p => p.ticker).join(",")]);

  const buildCorrelationMatrix = () => {
    if (!optimization?.correlations) return null;
    const symbols = [...new Set(optimization.correlations.flatMap(c => [c.sym1, c.sym2]))];
    const matrix = {};
    symbols.forEach(s => { matrix[s] = {}; symbols.forEach(s2 => matrix[s][s2] = s === s2 ? 1.0 : null); });
    optimization.correlations.forEach(c => {
      matrix[c.sym1][c.sym2] = c.correlation;
      matrix[c.sym2][c.sym1] = c.correlation;
    });
    return { symbols, matrix };
  };

  const corrData = buildCorrelationMatrix();

  const corrColor = (v) => {
    if (v === null || v === undefined) return "transparent";
    if (v >= 0) return `rgb(${Math.round(230 - v*100)}, ${Math.round(250 - v*30)}, ${Math.round(230 - v*100)})`;
    return `rgb(${Math.round(250 + v*30)}, ${Math.round(230 + v*100)}, ${Math.round(230 + v*100)})`;
  };

  const sectorMap = {};
  positions.forEach(p => {
    const sector = p.sector || "Other";
    sectorMap[sector] = (sectorMap[sector] || 0) + (p.weight || 0);
  });
  const sectorList = Object.entries(sectorMap)
    .map(([name, weight]) => ({ name, weight: +weight.toFixed(1),
      holdings: positions.filter(p => (p.sector || "Other") === name).map(p => p.ticker) }))
    .sort((a, b) => b.weight - a.weight);

  const connectionBadge = (() => {
    if (loading) return <Tag variant="warning" dot>Loading</Tag>;
    if (dataMode === "live") {
      return <Tag variant="positive" dot>IBKR LIVE — {status?.positionCount || 0} pos</Tag>;
    }
    if (dataMode === "stale") {
      return <Tag variant="warning">Snapshot — {formatLastSync(status?.lastSyncAt)}</Tag>;
    }
    if (dataMode === "disconnected") {
      return <Tag variant="default">Login required</Tag>;
    }
    return <Tag variant="negative">Service offline</Tag>;
  })();

  const holdingsSourceLabel = dataMode === "live"
    ? "IBKR Live"
    : dataMode === "stale"
      ? "Last-known snapshot"
      : dataMode === "disconnected"
        ? "No broker data"
        : "Service offline";

  const emptyState = (() => {
    if (dataMode === "live") {
      return {
        title: "No live positions",
        description: "IBKR is connected, but there are no holdings in the synced account right now.",
      };
    }
    if (dataMode === "stale") {
      return {
        title: "No cached positions available",
        description: "The broker link exists, but this workspace doesn't have a usable IBKR snapshot yet.",
      };
    }
    if (dataMode === "disconnected") {
      return {
        title: "Connect IBKR to load holdings",
        description: "Open Settings → Broker Connections, sign in through the Client Portal gateway, then run a sync.",
      };
    }
    return {
      title: "ibkr-sync-svc is offline",
      description: "The portfolio service couldn't reach the IBKR sync backend. Bring the service back up, then refresh.",
    };
  })();

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Portfolio Analyzer"
        subtitle="Backend-owned IBKR snapshots — Correlation matrix — Risk-parity sizing"
        badge={
          <>
            {connectionBadge}
            <Tag variant="accent">ANALYSIS-SVC</Tag>
          </>
        }
      />

      {(dataMode === "stale" || dataMode === "disconnected" || dataMode === "error") && (
        <Card className={cn(
          dataMode === "stale" && "bg-warning/5 border-warning/20",
          dataMode === "disconnected" && "bg-canvas",
          dataMode === "error" && "bg-negative/5 border-negative/20",
        )}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-1">
                IBKR Connection
              </div>
              <div className="text-sm text-muted">
                {dataMode === "stale" && `Showing your last-known broker snapshot from ${formatLastSync(status?.lastSyncAt)}.`}
                {dataMode === "disconnected" && "No authenticated IBKR session is available yet. Connect the gateway from Settings, then sync once."}
                {dataMode === "error" && "ibkr-sync-svc is unavailable, so broker holdings can't be refreshed right now."}
              </div>
              {lastError && (
                <div className="text-2xs text-subtle font-mono mt-2">{lastError}</div>
              )}
            </div>
            <button
              onClick={refresh}
              className="text-xs text-muted hover:text-ink transition-colors font-mono"
            >
              Refresh status
            </button>
          </div>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
        <Card>
          <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono">
            {summary ? "Net Liquidation" : "Portfolio Value"}
          </div>
          <div className="font-display text-2xl sm:text-3xl font-bold tracking-tighter mt-2">{fmtMoney(totalValue)}</div>
          <div className="mt-1">
            <Tag variant={totalGainPct >= 0 ? "positive" : "negative"}>
              {totalGainPct >= 0 ? "+" : ""}{totalGainPct.toFixed(1)}%
            </Tag>
          </div>
          {summary && (
            <div className="mt-2 text-2xs text-subtle font-mono">
              {fmtMoney(investedValue)} invested + {fmtMoney(totalCash)} cash
            </div>
          )}
          <div className="mt-3 h-8"><Sparkline data={[100,102,105,108,107,110,112]} height={30} /></div>
        </Card>

        <Card className="bg-ink text-white border-ink">
          <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Unrealized P&L</div>
          <div className={cn("font-display text-2xl sm:text-3xl font-bold tracking-tighter mt-2",
            totalGain >= 0 ? "text-positive" : "text-negative")}>
            {totalGain >= 0 ? "+" : "-"}{fmtMoney(Math.abs(totalGain))}
          </div>
        </Card>

        <Card className="bg-positive/10 border-positive/20">
          <div className="text-2xs uppercase tracking-wider text-positive font-medium font-mono">Sharpe Ratio</div>
          <div className="font-display text-2xl sm:text-3xl font-bold tracking-tighter mt-2 text-ink">
            {optimization?.sharpe?.toFixed(2) || "—"}
          </div>
        </Card>

        <Card>
          <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono">Portfolio Vol</div>
          <div className="font-display text-2xl sm:text-3xl font-bold tracking-tighter mt-2">
            {optimization ? (optimization.volatility * 100).toFixed(1) + "%" : "—"}
          </div>
        </Card>
      </div>

      {/* Chart + Sector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
        <Card className="lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-4 mb-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Performance vs S&P 500</div>
              <div className="font-display text-lg font-bold tracking-tight mt-1">1-Year Return Comparison</div>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted">
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-positive rounded" />Portfolio</div>
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-muted rounded" />SPY</div>
            </div>
          </div>
          <div className="text-center py-12 text-muted text-xs">
            Connect analysis-svc for live benchmark comparison
          </div>
        </Card>

        <Card>
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-5">Sector Exposure</div>
          <div className="space-y-4">
            {sectorList.map(s => (
              <div key={s.name}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <span className="font-mono text-sm font-bold">{s.weight}%</span>
                </div>
                <div className="h-2 bg-canvas rounded-full overflow-hidden">
                  <div className="h-full bg-ink rounded-full transition-all duration-700"
                       style={{ width: `${Math.min(s.weight, 100)}%` }} />
                </div>
                <div className="text-2xs text-muted font-mono mt-1">{s.holdings.join(" — ")}</div>
              </div>
            ))}
            {sectorList.length === 0 && (
              <div className="text-center py-6 text-muted text-xs">No sector data available</div>
            )}
          </div>
        </Card>
      </div>

      {/* Correlation Matrix */}
      {corrData && (
        <Card className="animate-slide-up" style={{ animationDelay: "200ms" }}>
          <div className="flex justify-between items-center mb-4">
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Correlation Matrix</div>
            <Tag variant="default">Pearson — 252-day</Tag>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th />
                  {corrData.symbols.map(s => (
                    <th key={s} className="px-1 py-2 text-2xs font-mono font-bold text-muted">{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrData.symbols.map(rowSym => (
                  <tr key={rowSym}>
                    <td className="px-2 py-1.5 font-mono text-2xs font-bold text-muted text-right">{rowSym}</td>
                    {corrData.symbols.map(colSym => {
                      const v = corrData.matrix[rowSym][colSym];
                      return (
                        <td key={colSym} className="px-1 py-2.5 text-center font-mono text-2xs font-bold border border-canvas"
                            style={{ background: corrColor(v), minWidth: 44 }}>
                          {v === null ? "—" : v.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-4 text-2xs text-muted">
            <span>Negative</span>
            {[-1, -0.5, 0, 0.5, 1].map(v => (
              <div key={v} className="w-4 h-3 rounded-sm" style={{ background: corrColor(v) }} />
            ))}
            <span>Positive</span>
            <span className="ml-4">Lower correlations = better diversification</span>
          </div>
        </Card>
      )}

      {/* Risk-Parity Weights */}
      {optimization?.weights && (
        <Card className="bg-ink text-white border-ink animate-slide-up" style={{ animationDelay: "250ms" }}>
          <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono mb-1">Risk-Parity Weights</div>
          <div className="text-xs text-zinc-500 mb-5">Suggested allocation that equalizes risk contribution</div>
          <div className="space-y-2.5">
            {optimization.weights.sort((a, b) => b.weight - a.weight).map(w => (
              <div key={w.symbol} className="flex items-center gap-3">
                <div className="w-12 font-mono text-xs font-bold text-positive">{w.symbol}</div>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full">
                  <div className="h-full rounded-full bg-gradient-to-r from-positive to-accent transition-all duration-700"
                       style={{ width: `${w.weight * 100}%` }} />
                </div>
                <div className="w-14 text-right font-mono text-xs font-bold">{(w.weight * 100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-zinc-800 grid grid-cols-3 gap-4">
            <div>
              <div className="text-2xs text-zinc-500 font-mono">Exp Return</div>
              <div className="font-mono text-base font-bold text-positive mt-1">{(optimization.expectedReturn * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-2xs text-zinc-500 font-mono">Vol</div>
              <div className="font-mono text-base font-bold text-warning mt-1">{(optimization.volatility * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-2xs text-zinc-500 font-mono">Sharpe</div>
              <div className="font-mono text-base font-bold text-accent mt-1">{optimization.sharpe?.toFixed(2)}</div>
            </div>
          </div>
        </Card>
      )}

      {!corrData && optimizing && (
        <div className="flex items-center gap-2 text-muted text-sm py-6">
          <Pulse color="accent" /> Computing correlations and optimal weights...
        </div>
      )}

      {/* Holdings table */}
      <Card padded={false} className="animate-slide-up" style={{ animationDelay: "300ms" }}>
        <div className="px-6 py-4 border-b border-line flex justify-between items-center">
          <span className="font-display text-base font-bold">Holdings — {holdingsSourceLabel}</span>
          <Tag variant="default">{positions.length} positions</Tag>
        </div>
        {positions.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={emptyState.title}
            description={emptyState.description}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-canvas">
                  {["Symbol", "Shares", "Price", "Value", "Cost", "P&L", "Day", "Weight"].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-2xs font-bold text-muted uppercase tracking-wider font-mono">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(h => {
                  const value = h.shares * h.price;
                  const cost = h.shares * h.cost;
                  const pnl = value - cost;
                  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                  return (
                    <tr key={h.ticker} className="border-b border-line hover:bg-canvas/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-ink text-positive flex items-center justify-center font-mono text-2xs font-extrabold">
                            {h.ticker.slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-mono text-sm font-bold">{h.ticker}</div>
                            <div className="text-xs text-muted">{h.name || h.ticker}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm">{h.shares}</td>
                      <td className="px-6 py-4 font-mono text-sm font-semibold">${h.price.toFixed(2)}</td>
                      <td className="px-6 py-4 font-mono text-sm font-semibold">{fmtMoney(value)}</td>
                      <td className="px-6 py-4 font-mono text-sm text-muted">{fmtMoney(cost)}</td>
                      <td className="px-6 py-4">
                        <div className={cn("font-mono text-sm font-bold", pnl >= 0 ? "text-positive" : "text-negative")}>
                          {pnl >= 0 ? "+" : ""}{fmtMoney(Math.abs(pnl))}
                        </div>
                        <div className={cn("font-mono text-2xs", pnl >= 0 ? "text-positive" : "text-negative")}>
                          {fmtPct(pnlPct)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn("font-mono text-xs font-bold", (h.change ?? 0) >= 0 ? "text-positive" : "text-negative")}>
                          {(h.change ?? 0) >= 0 ? "+" : ""}{(h.change ?? 0).toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-1.5 bg-canvas rounded-full">
                            <div className="h-full bg-ink rounded-full" style={{ width: `${Math.min(h.weight * 2, 100)}%` }} />
                          </div>
                          <span className="font-mono text-xs text-muted">{h.weight}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
