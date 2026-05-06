import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip
} from "recharts";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { Sparkline } from "../components/ui/Sparkline";
import { SkeletonCard } from "../components/ui/Skeleton";
import { cn, fmtMoney } from "../lib/cn";
import { useBanking } from "../hooks/useBanking";

export const Banking = () => {
  const { accounts, transactions, categories, isReal, loading } = useBanking();

  const totalIncome = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalSpend  = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const savings = totalIncome - totalSpend;
  const totalBalance = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);

  const dailySpend = transactions.length > 0
    ? (() => {
        const byDay = {};
        transactions.filter(t => t.amount < 0).forEach(t => {
          const day = new Date(t.date).getDate() || 1;
          byDay[day] = (byDay[day] || 0) + Math.abs(t.amount);
        });
        return Array.from({ length: 30 }, (_, i) => ({ day: i + 1, amount: byDay[i + 1] || 0 }));
      })()
    : [];

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Banking & Spending"
        subtitle="Chase accounts via Plaid — auto-categorized"
        badge={
          <>
            {loading && <Tag variant="warning" dot>Loading</Tag>}
            {!loading && isReal && <Tag variant="accent" dot>LIVE — Plaid</Tag>}
            {!loading && !isReal && <Tag variant="warning">Sandbox</Tag>}
          </>
        }
      />

      {/* Hero stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
        <Card className="bg-positive/10 border-positive/20">
          <div className="text-xs uppercase tracking-wider text-positive font-medium font-mono">Income — This Month</div>
          <div className="font-display text-3xl font-bold tracking-tighter mt-2 text-ink">{fmtMoney(totalIncome)}</div>
          <div className="text-xs font-mono text-positive/70 mt-1">
            {transactions.filter(t => t.amount > 0).length} deposits
          </div>
          <div className="mt-4 h-9"><Sparkline data={[100,102,105,108,110,114,118]} height={36} /></div>
        </Card>

        <Card className="bg-negative/5 border-negative/20">
          <div className="text-xs uppercase tracking-wider text-negative font-medium font-mono">Spending — This Month</div>
          <div className="font-display text-3xl font-bold tracking-tighter mt-2 text-negative">{fmtMoney(totalSpend)}</div>
          <div className="text-xs font-mono text-negative/70 mt-1">
            {transactions.filter(t => t.amount < 0).length} transactions
          </div>
          <div className="mt-4 h-9"><Sparkline data={[120,118,115,112,110,108,104]} height={36} /></div>
        </Card>

        <Card className="bg-ink text-white border-ink">
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Net Cash Flow</div>
          <div className={cn("font-display text-3xl font-bold tracking-tighter mt-2", savings >= 0 ? "text-positive" : "text-negative")}>
            {savings >= 0 ? "+" : "-"}{fmtMoney(Math.abs(savings))}
          </div>
          <div className="text-xs font-mono text-zinc-500 mt-1">
            Save rate {totalIncome > 0 ? ((savings / totalIncome) * 100).toFixed(0) : 0}%
          </div>
          <div className="mt-4 h-9"><Sparkline data={[98,100,103,105,107,109,112]} height={36} /></div>
        </Card>
      </div>

      {/* Accounts */}
      <Card padded={false} className="animate-slide-up" style={{ animationDelay: "100ms" }}>
        <div className="px-6 py-4 border-b border-line flex justify-between items-center">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Connected Accounts</div>
          <Tag variant="default">{fmtMoney(totalBalance)}</Tag>
        </div>
        <div className={cn("p-4 grid gap-3", accounts.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4")}>
          {accounts.map((a, i) => (
            <div key={a.id || i} className="p-4 bg-canvas rounded-lg border-l-[3px] border-accent">
              <div className="flex justify-between items-start mb-2">
                <Icon name="bank" size={16} color={T.cyan} />
                <Tag variant="default">{a.subtype || a.type || "account"}</Tag>
              </div>
              <div className="text-sm font-bold text-ink">{a.name}</div>
              <div className="font-display text-xl font-bold tracking-tight mt-1">{fmtMoney(Number(a.balance) || 0)}</div>
              {a.available !== undefined && (
                <div className="text-2xs text-muted font-mono mt-1">{fmtMoney(Number(a.available || 0))} available</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "200ms" }}>
        <Card className="lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Spending by Category</div>
            <Tag variant="default">{categories.length} categories</Tag>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={categories} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: T.muted }} tickFormatter={v => `$${v}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: T.ink }} width={100} />
              <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff", fontSize: 12 }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {categories.map((c, i) => <rect key={i} fill={c.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {dailySpend.length > 0 && (
          <Card>
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Daily Spending — 30d</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailySpend}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: T.muted }} />
                <YAxis tick={{ fontSize: 9, fill: T.muted }} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff", fontSize: 11 }} />
                <Bar dataKey="amount" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {/* Transactions table */}
      <Card padded={false} className="animate-slide-up" style={{ animationDelay: "300ms" }}>
        <div className="px-6 py-4 border-b border-line flex justify-between">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Recent Transactions</div>
          <Tag variant="default">{transactions.length} txs — 30d</Tag>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-canvas">
                {["Merchant", "Category", "Date", "Amount"].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-2xs font-bold text-muted uppercase tracking-wider font-mono">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 12).map((t, i) => (
                <tr key={i} className="border-b border-line hover:bg-canvas/50 transition-colors">
                  <td className="px-6 py-3.5 text-sm font-semibold text-ink">{t.merchant}</td>
                  <td className="px-6 py-3.5"><Tag variant="default">{t.category}</Tag></td>
                  <td className="px-6 py-3.5 font-mono text-xs text-muted">{t.date}</td>
                  <td className={cn("px-6 py-3.5 font-mono text-sm font-bold text-right tabular",
                    t.amount >= 0 ? "text-positive" : "text-ink")}>
                    {t.amount >= 0 ? "+" : ""}${Math.abs(t.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
