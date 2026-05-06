import { useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine
} from "recharts";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { cn, fmtMoney } from "../lib/cn";

const ANALYSIS_URL = import.meta.env.VITE_ANALYSIS_URL || "http://localhost:8088";

export const Options = () => {
  const [params, setParams] = useState({
    spot: 150, strike: 155, days: 30, vol: 0.30, rate: 0.05
  });
  const [callPrice, setCallPrice] = useState(null);
  const [putPrice, setPutPrice] = useState(null);
  const [chain, setChain] = useState([]);
  const [strategy, setStrategy] = useState("ironCondor");
  const [strategyResult, setStrategyResult] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([
      fetch(`${ANALYSIS_URL}/api/analysis/options/price`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CALL", ...params, daysToExpiry: params.days, volatility: params.vol })
      }).then(r => r.json()),
      fetch(`${ANALYSIS_URL}/api/analysis/options/price`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "PUT", ...params, daysToExpiry: params.days, volatility: params.vol })
      }).then(r => r.json())
    ]).then(([call, put]) => { setCallPrice(call); setPutPrice(put); }).catch(() => {});
    return () => ctl.abort();
  }, [params]);

  useEffect(() => {
    fetch(`${ANALYSIS_URL}/api/analysis/options/chain?spot=${params.spot}&days=${params.days}&vol=${params.vol}&rate=${params.rate}&strikes=5`)
      .then(r => r.json()).then(d => setChain(d.chain || [])).catch(() => setChain([]));
  }, [params.spot, params.days, params.vol, params.rate]);

  useEffect(() => {
    const presets = {
      coveredCall: {
        name: "Covered Call",
        legs: [
          { type: "STOCK", strike: 0, qty: 1, premium: params.spot },
          { type: "CALL", strike: params.spot * 1.05, qty: -1, premium: 3.5 }
        ]
      },
      ironCondor: {
        name: "Iron Condor",
        legs: [
          { type: "PUT", strike: params.spot * 0.90, qty: 1, premium: 1.5 },
          { type: "PUT", strike: params.spot * 0.95, qty: -1, premium: 3.0 },
          { type: "CALL", strike: params.spot * 1.05, qty: -1, premium: 3.0 },
          { type: "CALL", strike: params.spot * 1.10, qty: 1, premium: 1.5 }
        ]
      },
      straddle: {
        name: "Long Straddle",
        legs: [
          { type: "CALL", strike: params.spot, qty: 1, premium: 5 },
          { type: "PUT", strike: params.spot, qty: 1, premium: 5 }
        ]
      },
      bullCall: {
        name: "Bull Call Spread",
        legs: [
          { type: "CALL", strike: params.spot * 0.98, qty: 1, premium: 5 },
          { type: "CALL", strike: params.spot * 1.04, qty: -1, premium: 2 }
        ]
      },
    };
    const preset = presets[strategy];
    fetch(`${ANALYSIS_URL}/api/analysis/options/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: preset.name, spot: params.spot, legs: preset.legs })
    }).then(r => r.json()).then(setStrategyResult).catch(() => setStrategyResult(null));
  }, [strategy, params.spot]);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Options Pricing"
        subtitle="Black-Scholes pricing — Greeks — Strategy payoffs"
        badge={<Tag variant="accent">ANALYSIS-SVC</Tag>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in">
        {/* Inputs */}
        <Card>
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4">Inputs</div>
          <div className="space-y-3.5">
            {[
              { key: "spot", label: "Spot Price", prefix: "$", step: 1 },
              { key: "strike", label: "Strike Price", prefix: "$", step: 1 },
              { key: "days", label: "Days to Expiry", suffix: "d", step: 1 },
              { key: "vol", label: "Volatility", suffix: "", step: 0.01, display: v => (v * 100).toFixed(1) + "%" },
              { key: "rate", label: "Risk-Free Rate", suffix: "", step: 0.01, display: v => (v * 100).toFixed(2) + "%" },
            ].map(f => (
              <div key={f.key}>
                <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-1.5">{f.label}</div>
                <div className="flex items-center border border-line rounded-lg overflow-hidden focus-within:border-ink/30 transition-colors">
                  {f.prefix && <span className="px-3 py-2.5 bg-canvas text-sm text-muted font-mono">{f.prefix}</span>}
                  <input type="number" value={params[f.key]} step={f.step}
                         onChange={e => setParams({...params, [f.key]: +e.target.value})}
                         className="flex-1 px-3 py-2.5 text-sm font-semibold font-mono outline-none bg-transparent" />
                  {f.suffix && <span className="px-3 py-2.5 bg-canvas text-sm text-muted font-mono">{f.suffix}</span>}
                </div>
                {f.display && <div className="text-2xs text-muted font-mono mt-1">= {f.display(params[f.key])}</div>}
              </div>
            ))}
          </div>
        </Card>

        {/* Call */}
        <Card className="bg-positive/10 border-positive/20">
          <div className="text-xs uppercase tracking-wider text-positive font-medium font-mono">CALL Option</div>
          {callPrice && (
            <>
              <div className="font-display text-3xl sm:text-4xl font-bold tracking-tighter mt-2 text-ink">
                ${callPrice.price?.toFixed(2)}
              </div>
              <div className="text-xs font-mono text-ink/60 mt-1">
                Intrinsic ${callPrice.intrinsic} — Time ${callPrice.timeValue}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-positive/20">
                {Object.entries(callPrice.greeks || {}).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-2xs text-positive/70 uppercase font-mono">{k}</div>
                    <div className="font-mono text-sm font-bold text-ink">{Number(v).toFixed(4)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Put */}
        <Card className="bg-ink text-white border-ink">
          <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono">PUT Option</div>
          {putPrice && (
            <>
              <div className="font-display text-3xl sm:text-4xl font-bold tracking-tighter mt-2 text-positive">
                ${putPrice.price?.toFixed(2)}
              </div>
              <div className="text-xs font-mono text-zinc-500 mt-1">
                Intrinsic ${putPrice.intrinsic} — Time ${putPrice.timeValue}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-zinc-800">
                {Object.entries(putPrice.greeks || {}).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-2xs text-zinc-500 uppercase font-mono">{k}</div>
                    <div className="font-mono text-sm font-bold text-white">{Number(v).toFixed(4)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Options chain */}
      <Card padded={false} className="animate-slide-up" style={{ animationDelay: "100ms" }}>
        <div className="px-5 py-4 border-b border-line flex justify-between">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">
            Options Chain — {params.days} days
          </div>
          <Tag variant="default">Spot ${params.spot}</Tag>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-canvas">
                <th className="px-4 py-3 text-2xs font-bold text-muted uppercase tracking-wider font-mono" colSpan="3">CALL</th>
                <th className="px-4 py-3 text-2xs font-bold text-positive uppercase tracking-wider font-mono text-center bg-ink">STRIKE</th>
                <th className="px-4 py-3 text-2xs font-bold text-muted uppercase tracking-wider font-mono" colSpan="3">PUT</th>
              </tr>
              <tr className="bg-canvas text-2xs">
                <th className="px-4 py-1.5 text-left font-mono text-muted">Bid</th>
                <th className="px-4 py-1.5 text-left font-mono text-muted">Delta</th>
                <th className="px-4 py-1.5 text-left font-mono text-muted">Gamma</th>
                <th className="px-4 py-1.5 text-center bg-ink" />
                <th className="px-4 py-1.5 text-left font-mono text-muted">Bid</th>
                <th className="px-4 py-1.5 text-left font-mono text-muted">Delta</th>
                <th className="px-4 py-1.5 text-left font-mono text-muted">Gamma</th>
              </tr>
            </thead>
            <tbody>
              {chain.map((row, i) => {
                const itm = row.strike < params.spot;
                return (
                  <tr key={i} className="border-b border-line">
                    <td className={cn("px-4 py-3 font-mono text-xs font-semibold", itm && "bg-positive/5")}>${row.call?.price?.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.call?.greeks?.delta?.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.call?.greeks?.gamma?.toFixed(3)}</td>
                    <td className="px-4 py-3 font-mono text-xs font-extrabold text-center bg-ink text-white">${row.strike}</td>
                    <td className={cn("px-4 py-3 font-mono text-xs font-semibold", !itm && "bg-negative/5")}>${row.put?.price?.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.put?.greeks?.delta?.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.put?.greeks?.gamma?.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Strategy payoff */}
      <Card className="animate-slide-up" style={{ animationDelay: "200ms" }}>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-5">
          <div>
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">Strategy Payoff Analyzer</div>
            <div className="text-xs text-muted mt-1">Visualize P&L across underlying prices at expiration</div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { id: "coveredCall", label: "Covered Call" },
              { id: "bullCall",    label: "Bull Spread" },
              { id: "ironCondor",  label: "Iron Condor" },
              { id: "straddle",    label: "Straddle" },
            ].map(s => (
              <button key={s.id} onClick={() => setStrategy(s.id)} className={cn(
                "px-3 py-2 rounded-lg text-xs font-semibold transition-all",
                s.id === strategy ? "bg-ink text-white" : "border border-line hover:border-ink/30"
              )}>{s.label}</button>
            ))}
          </div>
        </div>

        {strategyResult && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              <div className="p-3 bg-positive/5 border border-positive/20 rounded-xl">
                <div className="text-2xs text-subtle uppercase font-mono">Max Profit</div>
                <div className="font-display text-xl font-bold text-positive mt-1">${strategyResult.maxProfit?.toFixed(2)}</div>
              </div>
              <div className="p-3 bg-negative/5 border border-negative/20 rounded-xl">
                <div className="text-2xs text-subtle uppercase font-mono">Max Loss</div>
                <div className="font-display text-xl font-bold text-negative mt-1">-${Math.abs(strategyResult.maxLoss)?.toFixed(2)}</div>
              </div>
              <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl">
                <div className="text-2xs text-subtle uppercase font-mono">Breakeven</div>
                <div className="font-display text-xl font-bold text-accent mt-1">${strategyResult.breakeven?.toFixed(2)}</div>
              </div>
              <div className="p-3 bg-warning/5 border border-warning/20 rounded-xl">
                <div className="text-2xs text-subtle uppercase font-mono">Risk/Reward</div>
                <div className="font-display text-xl font-bold text-warning mt-1">
                  {Math.abs(strategyResult.maxProfit / strategyResult.maxLoss).toFixed(2)}
                </div>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={strategyResult.payoffCurve?.map(([px, pnl]) => ({ price: px, pnl }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                <XAxis dataKey="price" tick={{ fontSize: 11, fill: T.muted }} tickFormatter={v => `$${v.toFixed(0)}`} />
                <YAxis tick={{ fontSize: 11, fill: T.muted }} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip contentStyle={{ background: T.ink, border: "none", borderRadius: 8, color: "#fff" }}
                         formatter={(v) => [`$${v?.toFixed(2)}`, "P&L"]} />
                <ReferenceLine y={0} stroke={T.muted} strokeDasharray="3 3" />
                <ReferenceLine x={params.spot} stroke="rgb(var(--accent))" strokeDasharray="3 3"
                               label={{ value: "Spot", fill: "rgb(var(--accent))", fontSize: 11, position: "top" }} />
                <Line type="monotone" dataKey="pnl" stroke={T.lime} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>
    </div>
  );
};
