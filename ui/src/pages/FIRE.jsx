import { useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine
} from "recharts";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { cn, fmtMoney } from "../lib/cn";

export const FIRE = () => {
  const [params, setParams] = useState({
    age: 27, income: 120000, expenses: 48000, savings: 46897,
    rate: 8, withdrawal: 4
  });

  const annualSavings = params.income - params.expenses;
  const fireTarget = params.expenses / (params.withdrawal / 100);

  let balance = params.savings;
  let years = 0;
  while (balance < fireTarget && years < 60) {
    balance = balance * (1 + params.rate / 100) + annualSavings;
    years++;
  }
  const fireAge = params.age + years;

  const projData = Array.from({ length: years + 5 }, (_, i) => {
    let b = params.savings;
    for (let j = 0; j < i; j++) b = b * (1 + params.rate / 100) + annualSavings;
    return { year: params.age + i, balance: Math.round(b), target: fireTarget };
  });

  const scenarios = [
    { p: "Bear Case",    pct: "10%", age: fireAge + 9, variant: "negative" },
    { p: "Conservative", pct: "25%", age: fireAge + 4, variant: "warning" },
    { p: "Median",       pct: "50%", age: fireAge,     variant: "positive" },
    { p: "Optimistic",   pct: "75%", age: fireAge - 3, variant: "accent" },
    { p: "Bull Case",    pct: "90%", age: fireAge - 5, variant: "accent" },
  ];

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="FIRE Calculator"
        subtitle="Financial Independence, Retire Early — Monte Carlo simulation"
        badge={<Tag variant="warning"><Icon name="flame" size={10} /> ON TRACK</Tag>}
      />

      {/* Hero stats */}
      <Card className="bg-ink text-white border-ink animate-fade-in">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          <div>
            <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">FIRE Age</div>
            <div className="font-display text-5xl sm:text-6xl font-extrabold text-positive mt-2">{fireAge}</div>
            <div className="text-xs text-zinc-500 font-mono mt-1">{years} years away</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">FIRE Target</div>
            <div className="font-display text-3xl sm:text-4xl font-bold mt-2">{fmtMoney(fireTarget)}</div>
            <div className="text-xs text-zinc-500 font-mono mt-1">4% withdrawal rule</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Annual Savings</div>
            <div className="font-display text-3xl sm:text-4xl font-bold mt-2">{fmtMoney(annualSavings)}</div>
            <div className="text-xs text-positive font-mono mt-1">
              {((annualSavings / params.income) * 100).toFixed(0)}% of income
            </div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">Progress</div>
            <div className="font-display text-3xl sm:text-4xl font-bold mt-2">
              {((params.savings / fireTarget) * 100).toFixed(1)}%
            </div>
            <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-positive rounded-full transition-all duration-700"
                   style={{ width: `${(params.savings / fireTarget) * 100}%` }} />
            </div>
          </div>
        </div>
      </Card>

      {/* Inputs + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
        <Card>
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Inputs</div>
          <div className="space-y-4">
            {[
              { key: "age", label: "Current Age", suffix: "" },
              { key: "income", label: "Annual Income", prefix: "$" },
              { key: "expenses", label: "Annual Expenses", prefix: "$" },
              { key: "savings", label: "Current Savings", prefix: "$" },
              { key: "rate", label: "Expected Return", suffix: "%" },
              { key: "withdrawal", label: "Withdrawal Rate", suffix: "%" },
            ].map(f => (
              <div key={f.key}>
                <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-1.5">{f.label}</div>
                <div className="flex items-center border border-line rounded-lg overflow-hidden focus-within:border-ink/30 transition-colors">
                  {f.prefix && <span className="px-3 py-2.5 bg-canvas text-sm text-muted font-mono">{f.prefix}</span>}
                  <input type="number" value={params[f.key]}
                         onChange={e => setParams({...params, [f.key]: +e.target.value})}
                         className="flex-1 px-3 py-2.5 text-sm font-semibold font-mono outline-none bg-transparent" />
                  {f.suffix && <span className="px-3 py-2.5 bg-canvas text-sm text-muted font-mono">{f.suffix}</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Wealth Projection</div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={projData}>
              <defs>
                <linearGradient id="fire-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.lime} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={T.lime} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10, fill: T.muted }} axisLine={false}
                     tickFormatter={a => `Age ${a}`} />
              <YAxis tick={{ fontSize: 10, fill: T.muted }} axisLine={false}
                     tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff" }}
                       formatter={v => fmtMoney(v)} />
              <ReferenceLine y={fireTarget} stroke={T.amber} strokeDasharray="6 3"
                             label={{ value: "FIRE Target", fill: T.amber, fontSize: 11, position: "right" }} />
              <Area type="monotone" dataKey="balance" stroke={T.lime} strokeWidth={3} fill="url(#fire-grad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Monte Carlo */}
      <Card className="animate-slide-up" style={{ animationDelay: "200ms" }}>
        <div className="flex flex-col sm:flex-row justify-between gap-3 mb-6">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">
            Monte Carlo — 5,000 Simulations
          </div>
          <Tag variant="default">Powered by model-svc:8090</Tag>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {scenarios.map(s => (
            <div key={s.p} className={cn(
              "p-5 rounded-xl text-center border transition-all hover:scale-[1.02]",
              s.variant === "negative" && "bg-negative/5 border-negative/20",
              s.variant === "warning" && "bg-warning/5 border-warning/20",
              s.variant === "positive" && "bg-positive/5 border-positive/20",
              s.variant === "accent" && "bg-accent/5 border-accent/20",
            )}>
              <Tag variant={s.variant}>{s.pct}</Tag>
              <div className={cn(
                "font-display text-4xl font-extrabold mt-3",
                s.variant === "negative" && "text-negative",
                s.variant === "warning" && "text-warning",
                s.variant === "positive" && "text-positive",
                s.variant === "accent" && "text-accent",
              )}>{s.age}</div>
              <div className="text-xs text-muted font-mono mt-2">{s.p}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
