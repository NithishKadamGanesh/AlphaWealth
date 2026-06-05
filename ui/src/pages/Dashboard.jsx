import { useState, useEffect } from "react";
import {
  ArrowUpRight, Wallet, Briefcase, Home, PiggyBank,
  Sparkles, ChevronRight, Newspaper, Bell, CreditCard,
} from "lucide-react";
import { Card } from "../components/ui/Card";
import { Stat, MiniStat } from "../components/ui/Stat";
import { Sparkline } from "../components/ui/Sparkline";
import { Tag } from "../components/ui/Tag";
import { Button } from "../components/ui/Button";
import { SkeletonCard } from "../components/ui/Skeleton";
import { cn, fmtMoney, fmtPct } from "../lib/cn";
import { summarizeCashFlow } from "../lib/banking";

import { useNetWorth } from "../hooks/useNetWorth";
import { useBanking } from "../hooks/useBanking";
import { useIbkrPositions } from "../hooks/useIbkrPositions";

const PERIODS = [
  { id: "1W",  label: "1W"  },
  { id: "1M",  label: "1M"  },
  { id: "3M",  label: "3M"  },
  { id: "1Y",  label: "1Y" },
  { id: "ALL", label: "All" },
];

const dataModeTag = (dataMode) => {
  if (dataMode === "live")      return <Tag variant="positive" dot>Live</Tag>;
  if (dataMode === "stale")     return <Tag variant="warning">Stale</Tag>;
  if (dataMode === "simulated") return <Tag variant="default">Sandbox</Tag>;
  if (dataMode === "disconnected") return <Tag variant="default">Disconnected</Tag>;
  if (dataMode === "error")     return <Tag variant="negative">Offline</Tag>;
  return <Tag variant="default">Loading</Tag>;
};

export const Dashboard = ({ onNav, quotes, isLive, dataMode: quotesMode = "unknown" }) => {
  const { snapshot, history, dataMode: nwMode = "unknown", loading: nwLoading } = useNetWorth();
  const { transactions, dataMode: bankMode = "unknown" } = useBanking();
  const { positions, dataMode: ibkrMode = "unknown" } = useIbkrPositions();
  const [period, setPeriod] = useState("1Y");

  const { income: totalIncome, spending: totalSpend, netCashFlow: cashFlow, saveRate, spendingTransactions } = summarizeCashFlow(transactions);

  const monthDelta = history.length >= 2
    ? history[history.length - 1].v - history[history.length - 2].v : 0;
  const monthDeltaPct = (history.length >= 2 && history[history.length - 2].v > 0)
    ? (monthDelta / history[history.length - 2].v) * 100 : 0;

  const topMover = positions.length > 0
    ? [...positions].sort((a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0))[0]
    : null;

  const sparkData = history.map(h => h.v ?? h.value ?? 0);

  const fireTarget = 2_500_000;
  const fireProgress = snapshot?.netWorth ? Math.min(snapshot.netWorth / fireTarget * 100, 100) : 0;

  // Build activity from real data
  const recentActivity = [];
  if (spendingTransactions.length > 0) {
    const bigSpend = [...spendingTransactions].sort((a, b) => a.amount - b.amount)[0];
    if (bigSpend) recentActivity.push({ type: "spend", text: `${bigSpend.merchant}: ${fmtMoney(bigSpend.amount)}`, time: bigSpend.date, icon: CreditCard });
  }
  if (positions.length > 0 && topMover) {
    recentActivity.push({
      type: "alert", icon: Bell,
      text: `${topMover.symbol || topMover.ticker} moved ${fmtPct(topMover.change_pct ?? 0)} today`,
      time: "Today",
    });
  }
  if (recentActivity.length === 0) {
    recentActivity.push(
      { type: "info", icon: Newspaper, text: "Connect services in Settings to see activity", time: "Now" },
    );
  }

  return (
    <div className="space-y-8 lg:space-y-12 max-w-[1400px]">
      {/* Hero: Net Worth */}
      <section className="animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 lg:mb-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-subtle font-medium">Net worth</span>
              {dataModeTag(nwMode)}
            </div>
            <div className="flex items-baseline gap-2 text-base text-muted flex-wrap">
              <span className="text-lg text-muted italic" style={{ fontFamily: "'Georgia', serif" }}>
                Good morning, Nithish.
              </span>
              <span className="text-subtle hidden sm:inline">-</span>
              <span className="font-mono text-xs hidden sm:inline">
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-surface border border-line">
            {PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-all duration-200",
                  period === p.id
                    ? "bg-ink text-canvas shadow-subtle"
                    : "text-muted hover:text-ink"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {nwLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-12">
            <div className="lg:col-span-2"><SkeletonCard /></div>
            <SkeletonCard />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-12">
            <div className="lg:col-span-2 space-y-5">
              <Stat
                value={snapshot?.netWorth ?? 0}
                delta={monthDelta}
                deltaPct={monthDeltaPct}
                size="hero"
                format="money"
              />
              <div className="h-24">
                <Sparkline data={sparkData} className="w-full" height={96} />
              </div>
            </div>

            <Card className="flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs uppercase tracking-wider text-subtle font-medium">FIRE Progress</span>
                  <button onClick={() => onNav?.("fire")} className="text-muted hover:text-ink transition-colors">
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="font-display text-3xl font-medium tabular tracking-tighter text-ink mt-2">
                  {fireProgress.toFixed(1)}%
                </div>
                <div className="text-xs text-muted mt-1 tabular">
                  of {fmtMoney(fireTarget, { compact: true })} target
                </div>
              </div>
              <div className="space-y-1.5 mt-4">
                <div className="h-1.5 bg-line rounded-full overflow-hidden">
                  <div
                    className="h-full bg-ink rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${fireProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-2xs text-subtle font-mono">
                  <span>{fmtMoney(snapshot?.netWorth ?? 0, { compact: true })}</span>
                  <span>{fmtMoney(fireTarget, { compact: true })}</span>
                </div>
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* Asset breakdown */}
      <section
        className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line rounded-xl overflow-hidden border border-line animate-slide-up"
        style={{ animationDelay: "100ms" }}
      >
        {[
          { label: "Cash",        icon: Wallet,    value: snapshot?.cash,        deltaPct: 0.4 },
          { label: "Investments", icon: Briefcase, value: snapshot?.investments, deltaPct: monthDeltaPct },
          { label: "Property",    icon: Home,      value: snapshot?.property,    deltaPct: 0.2 },
          { label: "Retirement",  icon: PiggyBank, value: snapshot?.retirement,  deltaPct: 1.8 },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-4 sm:px-6 py-5">
            <MiniStat label={s.label} value={s.value} deltaPct={s.deltaPct} format="money" icon={s.icon} />
          </div>
        ))}
      </section>

      {/* Body: 2-column */}
      <section
        className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-slide-up"
        style={{ animationDelay: "200ms" }}
      >
        <div className="lg:col-span-2 space-y-6">
          {/* This Month */}
          <Card>
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-ink">Last 30 days</h3>
                  {dataModeTag(bankMode)}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Cash flow from posted non-transfer banking activity
                </p>
              </div>
              <button
                onClick={() => onNav?.("banking")}
                className="text-xs text-muted hover:text-ink flex items-center gap-1 transition-colors"
              >
                View all <ChevronRight size={12} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4 sm:gap-6 mb-6">
              <MiniStat label="Income"   value={totalIncome}   format="money" />
              <MiniStat label="Spending" value={totalSpend}    format="money" />
              <div>
                <div className="text-xs uppercase tracking-wider text-subtle font-medium mb-2">Save Rate</div>
                <div className="font-display text-xl sm:text-2xl font-medium tabular tracking-tight text-ink">
                  {saveRate.toFixed(1)}%
                </div>
                <div className={cn(
                  "text-xs mt-1.5 tabular font-medium",
                  saveRate > 20 ? "text-positive" : saveRate > 10 ? "text-warning" : "text-negative"
                )}>
                  {saveRate > 20 ? "Excellent" : saveRate > 10 ? "On track" : "Below target"}
                </div>
              </div>
            </div>
            <div className="space-y-2 pt-4 border-t border-line">
              <div className="flex items-center justify-between text-2xs">
                <span className="text-subtle font-mono">CASH FLOW</span>
                <span className={cn("font-mono tabular font-medium", cashFlow >= 0 ? "text-positive" : "text-negative")}>
                  {cashFlow >= 0 ? "+" : ""}{fmtMoney(cashFlow)}
                </span>
              </div>
              <div className="h-2 bg-line rounded-full overflow-hidden flex">
                <div className="bg-positive transition-all duration-700" style={{ width: `${(totalIncome / (totalIncome + totalSpend || 1)) * 100}%` }} />
                <div className="bg-negative transition-all duration-700" style={{ width: `${(totalSpend / (totalIncome + totalSpend || 1)) * 100}%` }} />
              </div>
              <div className="flex justify-between text-2xs text-subtle font-mono">
                <span>{fmtMoney(totalIncome, { compact: true })} in</span>
                <span>{fmtMoney(totalSpend, { compact: true })} out</span>
              </div>
            </div>
          </Card>

          {/* Top Holdings */}
          <Card>
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-ink">Top holdings</h3>
                  {dataModeTag(ibkrMode)}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {ibkrMode === "live"
                    ? "Live from IBKR"
                    : ibkrMode === "stale"
                      ? "Last-known broker snapshot"
                      : ibkrMode === "disconnected"
                        ? "Connect IBKR in Settings"
                        : ibkrMode === "error"
                          ? "ibkr-sync-svc offline"
                          : "Checking broker status"}
                </p>
              </div>
              <button
                onClick={() => onNav?.("portfolio")}
                className="text-xs text-muted hover:text-ink flex items-center gap-1 transition-colors"
              >
                View portfolio <ChevronRight size={12} />
              </button>
            </div>
            <div className="space-y-1">
              {(positions.slice(0, 5)).map((pos, i) => (
                <button
                  key={pos.symbol || pos.ticker || i}
                  onClick={() => onNav?.("portfolio")}
                  className={cn(
                    "w-full flex items-center gap-4 py-2.5 px-3 -mx-3 rounded-lg",
                    "hover:bg-canvas transition-colors text-left group animate-slide-up",
                  )}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="w-9 h-9 rounded-lg bg-canvas border border-line flex items-center justify-center font-mono text-2xs font-semibold text-ink">
                    {(pos.symbol || pos.ticker)?.slice(0, 4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{pos.symbol || pos.ticker}</div>
                    <div className="text-2xs text-subtle font-mono tabular">
                      {pos.position ?? pos.shares} shares - avg {fmtMoney(pos.avgCost ?? pos.cost ?? 0)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-ink tabular">
                      {fmtMoney((pos.position ?? pos.shares ?? 0) * (pos.currentPrice ?? pos.price ?? pos.avgCost ?? 0))}
                    </div>
                    <div className={cn(
                      "text-2xs tabular font-medium",
                      (pos.change_pct ?? pos.change ?? 0) >= 0 ? "text-positive" : "text-negative"
                    )}>
                      {fmtPct(pos.change_pct ?? pos.change ?? 0)}
                    </div>
                  </div>
                </button>
              ))}
              {positions.length === 0 && (
                <div className="py-12 text-center text-sm text-subtle">
                  No positions yet. Connect IBKR in Settings.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* AI Briefing */}
          <Card className="bg-gradient-to-br from-surface to-canvas relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-ink flex items-center justify-center">
                  <Sparkles size={13} className="text-canvas" />
                </div>
                <span className="text-sm font-medium text-ink">Daily briefing</span>
              </div>
              <p className="text-sm text-muted leading-relaxed">
                Your portfolio is up <span className="text-positive font-medium">{fmtPct(monthDeltaPct)}</span> this
                month. {topMover && (
                  <>{topMover.symbol || topMover.ticker} is the standout at <span className={cn("font-medium", (topMover.change_pct ?? 0) >= 0 ? "text-positive" : "text-negative")}>
                  {fmtPct(topMover.change_pct ?? 0)}</span>.</>
                )} Save rate of <span className="text-ink font-medium">{saveRate.toFixed(0)}%</span> keeps
                you on track for FIRE.
              </p>
              <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={() => onNav?.("ai")}>
                <Sparkles size={13} />
                Open AI Advisor
                <ArrowUpRight size={13} />
              </Button>
            </div>
          </Card>

          {/* Market pulse */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-ink">Market pulse</h3>
                {dataModeTag(quotesMode === "unknown" ? (isLive ? "live" : "simulated") : quotesMode)}
              </div>
              <button onClick={() => onNav?.("markets")} className="text-xs text-muted hover:text-ink">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="space-y-3">
              {Object.entries(quotes ?? {}).slice(0, 5).map(([sym, q]) => (
                <div key={sym} className="flex items-center justify-between">
                  <span className="text-sm font-mono font-medium text-ink">{sym}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular text-muted">${q.price?.toFixed(2)}</span>
                    <span className={cn(
                      "text-xs tabular font-medium w-14 text-right",
                      q.change_pct >= 0 ? "text-positive" : "text-negative"
                    )}>
                      {fmtPct(q.change_pct ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Activity feed — real data, not hardcoded */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-ink">Activity</h3>
            </div>
            <div className="space-y-3">
              {recentActivity.map((a, i) => (
                <div key={i} className="flex items-start gap-3 text-sm animate-slide-up" style={{ animationDelay: `${i * 80}ms` }}>
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",
                    a.type === "alert" ? "bg-warning" : a.type === "spend" ? "bg-accent" : "bg-positive"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">{a.text}</div>
                    <div className="text-2xs text-subtle font-mono mt-0.5">{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};
