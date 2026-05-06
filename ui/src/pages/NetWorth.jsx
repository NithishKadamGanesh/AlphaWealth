import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell
} from "recharts";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { Sparkline } from "../components/ui/Sparkline";
import { SkeletonCard } from "../components/ui/Skeleton";
import { cn, fmtMoney } from "../lib/cn";
import { useNetWorth } from "../hooks/useNetWorth";
import { ASSETS, LIABILITIES } from "../lib/mockData";

const ALLOC_COLORS = [
  "rgb(var(--accent))", "rgb(var(--positive))", "rgb(var(--warning))",
  "rgb(var(--accent))", "#ec4899", "rgb(var(--muted))",
];

export const NetWorth = () => {
  const { snapshot, history, breakdown, isReal, loading } = useNetWorth();

  const allocData = [
    { name: "Property",   value: snapshot.property,    color: ALLOC_COLORS[0] },
    { name: "Investment", value: snapshot.investments, color: ALLOC_COLORS[1] },
    { name: "Retirement", value: snapshot.retirement,  color: ALLOC_COLORS[2] },
    { name: "Cash",       value: snapshot.cash,        color: ALLOC_COLORS[3] },
    { name: "Crypto",     value: snapshot.crypto,      color: ALLOC_COLORS[4] },
    { name: "Other",      value: snapshot.otherAssets, color: ALLOC_COLORS[5] },
  ].filter(a => a.value > 0);

  const assetsList = breakdown?.manualAssets?.length > 0 ? breakdown.manualAssets : ASSETS;
  const liabsList  = breakdown?.manualLiabilities?.length > 0 ? breakdown.manualLiabilities : LIABILITIES;

  const monthChange = history.length >= 2
    ? history[history.length - 1].v - history[history.length - 2].v : 0;

  const sparkData = history.map(h => h.v ?? 0);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Net Worth Tracker"
        subtitle="Aggregated from IBKR, Chase (Plaid), and manual entries"
        badge={
          <>
            {loading && <Tag variant="warning" dot>Loading</Tag>}
            {!loading && isReal && <Tag variant="positive" dot>LIVE</Tag>}
            {!loading && !isReal && <Tag variant="warning">Fallback</Tag>}
          </>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : (
        <>
          {/* Hero cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
            <Card className="bg-ink text-white border-ink">
              <div className="text-xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Net Worth</div>
              <div className="font-display text-3xl sm:text-4xl font-bold tracking-tighter mt-2">
                {fmtMoney(snapshot.netWorth)}
              </div>
              <div className="mt-2">
                <Tag variant={monthChange >= 0 ? "positive" : "negative"}>
                  {monthChange >= 0 ? "+" : ""}{fmtMoney(monthChange)}
                </Tag>
              </div>
              <div className="mt-4 h-10">
                <Sparkline data={sparkData} height={40} />
              </div>
            </Card>

            <Card className="bg-positive/10 border-positive/20">
              <div className="text-xs uppercase tracking-wider text-positive font-medium font-mono">Total Assets</div>
              <div className="font-display text-3xl sm:text-4xl font-bold tracking-tighter mt-2 text-ink">
                {fmtMoney(snapshot.totalAssets)}
              </div>
              <div className="text-xs font-mono text-muted mt-2">{assetsList.length} sources</div>
              <div className="mt-4 h-10">
                <Sparkline data={sparkData} height={40} />
              </div>
            </Card>

            <Card className="bg-negative/5 border-negative/20">
              <div className="text-xs uppercase tracking-wider text-negative font-medium font-mono">Total Liabilities</div>
              <div className="font-display text-3xl sm:text-4xl font-bold tracking-tighter mt-2 text-negative">
                -{fmtMoney(snapshot.totalLiabilities)}
              </div>
              <div className="text-xs font-mono text-negative/70 mt-2">{liabsList.length} loans</div>
              <div className="mt-4 h-10 flex items-center justify-center text-negative/30">
                <Icon name="bank" size={32} />
              </div>
            </Card>
          </div>

          {/* Chart + Allocation */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
            <Card className="lg:col-span-2">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                <div>
                  <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">
                    {history.length}-Month History
                  </div>
                  <div className="font-display text-xl font-bold tracking-tight mt-1">
                    {fmtMoney(snapshot.netWorth)}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {["1M", "6M", "1Y", "2Y", "All"].map(p => (
                    <button key={p} className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all",
                      p === "2Y"
                        ? "bg-ink text-canvas"
                        : "text-muted border border-line hover:border-ink/20"
                    )}>{p}</button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={T.lime} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={T.lime} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false}
                         tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff", fontSize: 12 }}
                           formatter={v => [`$${v.toLocaleString()}`, "Net Worth"]} />
                  <Area type="monotone" dataKey="v" stroke={T.lime} strokeWidth={3} fill="url(#nw-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Asset Allocation</div>
              {allocData.length > 0 && (
                <div className="relative">
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie data={allocData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}>
                        {allocData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                    <div className="text-2xs text-muted font-mono">TOTAL</div>
                    <div className="font-display text-lg font-extrabold">${(snapshot.totalAssets/1000).toFixed(0)}k</div>
                  </div>
                </div>
              )}
              <div className="mt-4 space-y-2">
                {allocData.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                    <span className="flex-1 text-muted">{d.name}</span>
                    <span className="font-mono font-semibold">${(d.value / 1000).toFixed(0)}k</span>
                    <span className="font-mono text-2xs text-muted w-9 text-right">
                      {snapshot.totalAssets > 0 ? ((d.value/snapshot.totalAssets)*100).toFixed(0) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Assets & Liabilities */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-slide-up" style={{ animationDelay: "200ms" }}>
            <Card>
              <div className="flex justify-between items-center mb-4">
                <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Assets</div>
                <Tag variant="positive">{assetsList.length}</Tag>
              </div>
              <div className="space-y-2">
                {assetsList.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-canvas rounded-lg border-l-[3px] border-positive">
                    <Icon name={a.icon || "briefcase"} size={16} color={T.lime} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">{a.name}</div>
                      <div className="text-2xs text-muted font-mono">{a.type || "Asset"}</div>
                    </div>
                    <div className="font-mono text-sm font-bold tabular">{fmtMoney(Number(a.value) || 0)}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <div className="flex justify-between items-center mb-4">
                <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Liabilities</div>
                <Tag variant="negative">{liabsList.length}</Tag>
              </div>
              <div className="space-y-2">
                {liabsList.map((l, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-canvas rounded-lg border-l-[3px] border-negative">
                    <Icon name={l.icon || "coffee"} size={16} color={T.red} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">{l.name}</div>
                      <div className="text-2xs text-muted font-mono">{l.type || "Loan"}</div>
                    </div>
                    <div className="font-mono text-sm font-bold tabular text-negative">-{fmtMoney(Number(l.value) || 0)}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
