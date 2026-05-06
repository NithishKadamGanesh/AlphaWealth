import { useState, useEffect } from "react";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { cn, fmtMoney } from "../lib/cn";
import { useNetWorth } from "../hooks/useNetWorth";
import { useIbkrPositions } from "../hooks/useIbkrPositions";
import { useBanking } from "../hooks/useBanking";

const AI_ADVISOR_URL = import.meta.env.VITE_AI_ADVISOR_URL || "http://localhost:8094";
const DEFAULT_WATCH = ["AAPL", "NVDA", "MSFT", "VOO"];

const PROVIDER_LABELS = {
  claude: { name: "Claude Sonnet 4",  variant: "warning",  icon: "sparkle",  cost: "$3/$15 per Mtok" },
  openai: { name: "GPT-4o-mini",      variant: "accent",   icon: "cpu",      cost: "$0.15/$0.60 per Mtok" },
  gemini: { name: "Gemini 2.0 Flash", variant: "accent",   icon: "layers",   cost: "Free tier" },
  ollama: { name: "Llama 3.1 8B",     variant: "positive", icon: "shield",   cost: "FREE — Local" },
};

export const AIAdvisor = () => {
  const { snapshot } = useNetWorth();
  const { positions } = useIbkrPositions();
  const { transactions } = useBanking();

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi Nithish. I have your full financial picture loaded — net worth, IBKR portfolio, Chase accounts, spending data, real-time technical signals, and FinBERT news sentiment scores. Toggle 'Include FinGPT forecasts' below if you want next-week directional predictions in my context (slower but more forward-looking). What would you like to dig into?"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [watchSymbols, setWatchSymbols] = useState(DEFAULT_WATCH);
  const [newSym, setNewSym] = useState("");
  const [providers, setProviders] = useState(null);
  const [activeProvider, setActiveProvider] = useState(null);
  const [includeForecast, setIncludeForecast] = useState(false);

  useEffect(() => {
    fetch(`${AI_ADVISOR_URL}/providers`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setProviders(d); setActiveProvider(d.active); } })
      .catch(() => {});
  }, []);

  const portfolioValue = positions.reduce((s, p) => s + p.shares * p.price, 0);
  const totalSpend = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalIncome = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const saveRate = totalIncome > 0 ? ((totalIncome - totalSpend) / totalIncome) * 100 : 0;

  const suggestions = [
    "Am I on track for FIRE by 38?",
    "What does the multi-timeframe say about NVDA?",
    "How is the FinBERT sentiment for my watchlist?",
    "Should I rebalance my tech-heavy portfolio?",
    "Best month historically to buy AAPL?",
  ];

  const sendMsg = async (text) => {
    const msg = text || input;
    if (!msg.trim()) return;
    setInput("");
    const newMessages = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const timeout = includeForecast ? 180_000 : 60_000;
      const res = await fetch(`${AI_ADVISOR_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, watchSymbols, provider: activeProvider, includeForecast }),
        signal: AbortSignal.timeout(timeout)
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        role: "assistant", content: data.reply || "Connection issue.",
        contextSize: data.context_size, provider: data.provider, usedForecast: includeForecast,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Connection error: ${e.message || "timeout"}. ` +
                 (includeForecast ? "FinGPT forecasts can be slow on first load. Try toggling them off." :
                  "Make sure ai-advisor-svc is running on port 8094.")
      }]);
    }
    setLoading(false);
  };

  const addSymbol = () => {
    const s = newSym.trim().toUpperCase();
    if (s && !watchSymbols.includes(s)) { setWatchSymbols([...watchSymbols, s]); setNewSym(""); }
  };

  const activeInfo = activeProvider ? PROVIDER_LABELS[activeProvider] : PROVIDER_LABELS.claude;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="AI Financial Advisor"
        subtitle="Multi-model LLM with full RAG context — analysis-svc + FinBERT + FinGPT"
        badge={
          <>
            <Tag variant={activeInfo.variant}><Icon name={activeInfo.icon} size={10} /> {activeInfo.name}</Tag>
            <Tag variant="accent">RAG — ANALYSIS — SENTIMENT</Tag>
            {includeForecast && <Tag variant="accent">+FINGPT</Tag>}
          </>
        }
      />

      {/* Provider selector */}
      {providers && (
        <Card padded={false} className="p-4 animate-fade-in">
          <div className="flex justify-between items-center mb-3">
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">LLM Provider</div>
            <div className="text-2xs text-muted font-mono">active: {providers.active}</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(providers.available).map(([key, info]) => {
              const meta = PROVIDER_LABELS[key];
              if (!meta) return null;
              const isActive = activeProvider === key;
              const isAvailable = info.configured;
              return (
                <button key={key} disabled={!isAvailable} onClick={() => setActiveProvider(key)}
                  className={cn(
                    "p-3 rounded-xl text-left transition-all border-2",
                    isActive ? "border-ink bg-ink text-white" : "border-line bg-transparent hover:border-ink/30",
                    !isAvailable && "opacity-50 cursor-not-allowed"
                  )}>
                  <div className="flex justify-between mb-2">
                    <Icon name={meta.icon} size={16} color={isActive ? "#fff" : T.ink} stroke={2.5} />
                    {info.free && <Tag variant="positive">FREE</Tag>}
                    {!isAvailable && <Tag variant="warning">NO KEY</Tag>}
                  </div>
                  <div className="font-bold text-sm">{meta.name}</div>
                  <div className="text-2xs mt-1 opacity-80">{info.description}</div>
                  <div className="text-2xs font-mono mt-1 opacity-60">{meta.cost}</div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Context + Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "50ms" }}>
        <Card className="lg:col-span-2" padded={false} style={{ padding: 16 }}>
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-3">Financial Context</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {[
              { label: "Net Worth", value: fmtMoney(snapshot.netWorth, { compact: true }), variant: "positive" },
              { label: "Portfolio", value: fmtMoney(portfolioValue, { compact: true }), variant: "accent" },
              { label: "Cash",      value: fmtMoney(snapshot.cash, { compact: true }), variant: "accent" },
              { label: "Spending",  value: fmtMoney(totalSpend), variant: "negative" },
              { label: "Save Rate", value: `${saveRate.toFixed(0)}%`, variant: "warning" },
              { label: "Holdings",  value: positions.length, variant: "default" },
            ].map(c => (
              <div key={c.label} className={cn(
                "p-2.5 rounded-lg border",
                c.variant === "positive" && "bg-positive/5 border-positive/20",
                c.variant === "accent" && "bg-accent/5 border-accent/20",
                c.variant === "negative" && "bg-negative/5 border-negative/20",
                c.variant === "warning" && "bg-warning/5 border-warning/20",
                c.variant === "default" && "bg-canvas border-line",
              )}>
                <div className={cn("text-2xs font-bold uppercase tracking-wider font-mono",
                  `text-${c.variant === "default" ? "muted" : c.variant}`)}>{c.label}</div>
                <div className="font-mono text-sm font-bold mt-1">{c.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="bg-ink text-white border-ink">
          <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono mb-1">Analysis Watchlist</div>
          <div className="text-2xs text-zinc-500 mb-3">
            Pre-loaded with signals — patterns — MTF — FinBERT{includeForecast && " — FinGPT"}
          </div>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {watchSymbols.map(s => (
              <span key={s} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-positive text-ink font-mono text-xs font-bold">
                {s}
                <button onClick={() => setWatchSymbols(watchSymbols.filter(x => x !== s))}
                  className="text-ink/60 hover:text-ink text-sm leading-none">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1.5 mb-3">
            <input value={newSym} onChange={e => setNewSym(e.target.value)}
                   onKeyDown={e => e.key === "Enter" && addSymbol()}
                   placeholder="Add..."
                   className="flex-1 px-3 py-2 rounded-lg border border-zinc-700 text-xs bg-zinc-900 text-white font-mono outline-none focus:border-zinc-500" />
            <Button size="sm" onClick={addSymbol} className="bg-positive text-ink hover:bg-positive/90">Add</Button>
          </div>

          <div className={cn(
            "p-3 rounded-lg border cursor-pointer transition-all",
            includeForecast ? "bg-accent/20 border-accent" : "bg-zinc-900 border-zinc-700"
          )} onClick={() => setIncludeForecast(!includeForecast)}>
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-9 h-5 rounded-full relative transition-all flex-shrink-0",
                includeForecast ? "bg-accent" : "bg-zinc-600"
              )}>
                <div className={cn(
                  "w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all",
                  includeForecast ? "left-[18px]" : "left-0.5"
                )} />
              </div>
              <div>
                <div className={cn("text-xs font-bold", includeForecast ? "text-accent" : "text-white")}>
                  Include FinGPT forecasts
                </div>
                <div className="text-2xs text-zinc-400 mt-0.5">
                  {includeForecast ? "+5-15s per symbol on first load" : "Toggle on for next-week predictions"}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Chat */}
      <Card padded={false} className="h-[580px] flex flex-col animate-slide-up" style={{ animationDelay: "100ms" }}>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[75%] px-4 py-3 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-ink text-white rounded-2xl rounded-br-sm"
                  : "bg-canvas border border-line text-ink rounded-2xl rounded-bl-sm"
              )}>
                {m.role === "assistant" && (
                  <div className="flex gap-1.5 items-center flex-wrap mb-2">
                    <Tag variant={m.provider ? (PROVIDER_LABELS[m.provider]?.variant || "default") : "warning"}>
                      {m.provider ? PROVIDER_LABELS[m.provider]?.name?.split(" ")[0] || "AI" : "AI"}
                    </Tag>
                    {m.usedForecast && <Tag variant="accent">FinGPT ctx</Tag>}
                    {m.contextSize && (
                      <span className="text-2xs text-muted font-mono">ctx {(m.contextSize / 1000).toFixed(1)}k</span>
                    )}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex">
              <div className="bg-canvas border border-line px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
                         style={{ animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
                {includeForecast && (
                  <span className="text-2xs text-muted font-mono ml-2">
                    loading FinGPT forecasts ({watchSymbols.length} symbols)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-3 flex gap-2 flex-wrap">
          {suggestions.map(s => (
            <button key={s} onClick={() => sendMsg(s)}
              className="px-3 py-1.5 rounded-lg border border-line bg-surface text-xs text-muted hover:text-ink hover:border-ink/30 transition-colors">
              {s}
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-line flex gap-3">
          <input value={input} onChange={e => setInput(e.target.value)}
                 onKeyDown={e => e.key === "Enter" && sendMsg()}
                 placeholder="Ask about your finances or markets..."
                 className="flex-1 px-4 py-3 rounded-xl border border-line text-sm outline-none bg-transparent focus:border-ink/30 transition-colors" />
          <Button onClick={() => sendMsg()} disabled={loading || !input.trim()}
                  className="gap-1.5">
            <Icon name="send" size={14} /> Send
          </Button>
        </div>
      </Card>
    </div>
  );
};
