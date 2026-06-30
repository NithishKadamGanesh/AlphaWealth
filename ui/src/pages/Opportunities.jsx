import { useState, useCallback, useRef, useEffect } from "react";
import {
  Zap, TrendingUp, TrendingDown, Minus, RefreshCw,
  ChevronRight, CheckCircle, XCircle, AlertTriangle,
  Eye, Target, Ban, Activity, Radio, BookOpen,
  Briefcase, DollarSign, X, BarChart2, Newspaper,
} from "lucide-react";
import { cn } from "../lib/cn";

const ANALYSIS_URL  = import.meta.env.VITE_ANALYSIS_URL  || "http://localhost:8088";
const LIVE_DATA_URL = import.meta.env.VITE_LIVE_DATA_URL || "http://localhost:8096";
const SENTIMENT_URL = import.meta.env.VITE_SENTIMENT_URL || "http://localhost:8097";
const IBKR_URL      = import.meta.env.VITE_IBKR_URL      || "http://localhost:8091";
const BANKING_URL   = import.meta.env.VITE_BANKING_URL   || "http://localhost:8092";
const BACKTEST_URL  = import.meta.env.VITE_BACKTEST_URL  || "http://localhost:8089";

const DEFAULT_WATCHLIST = ["AAPL","NVDA","MSFT","AMZN","TSLA","GOOGL","META","AMD","SPY","QQQ","PLTR","ARM"];
const DECISIONS_KEY     = "aw_opportunity_decisions";
const MARKET_SELECTED_SYMBOL_KEY = "aw_markets_selected_symbol";

function signalColor(val = "") {
  const v = val.toLowerCase();
  if (v.includes("bull") || v.includes("buy") || v === "long") return "text-positive";
  if (v.includes("bear") || v.includes("sell") || v === "short") return "text-negative";
  return "text-muted";
}

function quoteChangePct(q) {
  return Number(q?.change_pct ?? q?.changePercent ?? 0);
}

function pctValue(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function computeScore({ sym, full, quote, sentimentScore, ibkrPositions, cashBalance, earningsData, companyData, optionsIdeasCount, nativeScan }) {
  const signal      = full.signal || full.blendedSignal || {};
  const bias        = String(signal.bias || signal.direction || signal.action || "NEUTRAL").toUpperCase();
  const rawConfidence = Number(signal.confidence ?? signal.score ?? 0.5);
  const confidence  = rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence;
  const patterns    = Array.isArray(full.patterns)  ? full.patterns  : [];
  const levels      = full.levels || {};
  const seasonality = full.seasonality || {};

  const bullPatterns = patterns.filter(p => String(p.bias || p.direction || "").toUpperCase().includes("BULL"));
  const bearPatterns = patterns.filter(p => String(p.bias || p.direction || "").toUpperCase().includes("BEAR"));
  const monthBias    = String(seasonality.currentMonthBias || seasonality.bias || "").toUpperCase();
  const supports     = (levels.supports || levels.support || []);
  const resistances  = (levels.resistances || levels.resistance || []);

  let score        = 0;
  const evidence   = [];
  const contradictions = [];
  const portfolio  = [];

  // Native C++ scanner / Lorentzian evidence
  if (nativeScan) {
    const nativeScore = Number(nativeScan.score);
    if (Number.isFinite(nativeScore)) {
      score += (nativeScore - 50) * 0.35;
      if (nativeScore >= 65) evidence.push(`C++ scanner score ${nativeScore.toFixed(0)}/100`);
      if (nativeScore <= 40) contradictions.push(`C++ scanner weak (${nativeScore.toFixed(0)}/100)`);
    }
    const lor = nativeScan.lorentzian || full.lorentzian;
    const lorAction = String(lor?.action || "").toUpperCase();
    const lorConf = Number(lor?.confidence || 0);
    if (lorAction === "BUY") evidence.push(`Lorentzian BUY (${(lorConf * 100).toFixed(0)}%)`);
    if (lorAction === "SELL") contradictions.push(`Lorentzian SELL (${(lorConf * 100).toFixed(0)}%)`);
    if (Array.isArray(nativeScan.riskFlags)) contradictions.push(...nativeScan.riskFlags.slice(0, 2));
  }

  // 1. Trend / Signal
  const isBull = bias.includes("BULL") || bias === "BUY" || bias === "STRONG_BUY";
  const isBear = bias.includes("BEAR") || bias === "SELL" || bias === "STRONG_SELL";
  if (isBull) { score += 30; evidence.push(`Signal: ${bias} (${confidence.toFixed(0)}%)`); }
  else if (isBear) { score -= 20; contradictions.push(`Signal: ${bias}`); }

  // 2. Momentum (price change)
  const chg = quoteChangePct(quote);
  if (chg > 2)  { score += 10; evidence.push(`+${chg.toFixed(1)}% today (momentum)`); }
  if (chg < -2) { score -= 8;  contradictions.push(`${chg.toFixed(1)}% today (weakness)`); }

  // 3. Volume / RVOL
  const vol    = Number(quote?.volume || 0);
  const avgVol = Number(quote?.avgVolume || quote?.averageVolume || companyData?.avgVolume || 0);
  if (avgVol > 0 && vol > 0) {
    const rvol = vol / avgVol;
    if (rvol > 1.5 && isBull) { score += 8; evidence.push(`RVOL ${rvol.toFixed(1)}× (high participation)`); }
    if (rvol < 0.5)            { score -= 4; contradictions.push(`RVOL ${rvol.toFixed(1)}× (low participation)`); }
  }

  // 4. Support/resistance proximity
  const price = Number(quote?.price || 0);
  if (price > 0 && supports.length > 0) {
    const nearestSupport = supports.map(s => (typeof s === "number" ? s : s?.level ?? 0)).sort((a, b) => b - a)[0];
    if (nearestSupport > 0) {
      const distPct = (price - nearestSupport) / price;
      if (distPct >= 0 && distPct < 0.03) { score += 12; evidence.push(`Price within 3% of support $${nearestSupport.toFixed(2)}`); }
      if (distPct < 0) { score -= 5; contradictions.push(`Price below support $${nearestSupport.toFixed(2)}`); }
    }
  }
  if (price > 0 && resistances.length > 0) {
    const nearestResist = resistances.map(r => (typeof r === "number" ? r : r?.level ?? 0)).filter(v => v > price).sort((a, b) => a - b)[0];
    if (nearestResist) {
      const distPct = (nearestResist - price) / price;
      if (distPct < 0.02) { score -= 5; contradictions.push(`Resistance at $${nearestResist.toFixed(2)} (within 2%)`); }
    }
  }

  // 5. Patterns
  if (bullPatterns.length > 0) { score += bullPatterns.length * 8; evidence.push(`${bullPatterns.length} bullish pattern${bullPatterns.length > 1 ? "s" : ""}`); }
  if (bearPatterns.length > 0) { score -= bearPatterns.length * 8; contradictions.push(`${bearPatterns.length} bearish pattern${bearPatterns.length > 1 ? "s" : ""}`); }

  // 6. Seasonality
  if (monthBias.includes("BULL") || monthBias === "POSITIVE") { score += 10; evidence.push("Seasonal tailwind this month"); }
  if (monthBias.includes("BEAR") || monthBias === "NEGATIVE") { score -= 8;  contradictions.push("Seasonal headwind this month"); }

  // 7. Sentiment (from sentiment-svc)
  if (sentimentScore != null) {
    if (sentimentScore > 0.2)  { score += 8;  evidence.push(`News sentiment positive (${(sentimentScore * 100).toFixed(0)}%)`); }
    if (sentimentScore < -0.2) { score -= 8;  contradictions.push(`News sentiment negative (${(sentimentScore * 100).toFixed(0)}%)`); }
  }

  // 8. Regime
  if (full.regime) {
    if (full.regime.includes("BULL"))     { score += 8; evidence.push(`Regime: ${full.regime}`); }
    if (full.regime.includes("BEAR"))     { score -= 8; contradictions.push(`Regime: ${full.regime}`); }
    if (full.regime.includes("HIGH_VOL")) { score -= 5; contradictions.push(`Regime: ${full.regime} (elevated risk)`); }
  }

  // 9. Catalyst / earnings risk
  if (earningsData) {
    if (earningsData.catalystRisk && earningsData.daysOut != null) {
      score -= 10;
      contradictions.push(`Earnings in ${earningsData.daysOut}d — binary event risk`);
    } else if (earningsData.daysOut != null && earningsData.daysOut <= 30) {
      contradictions.push(`Earnings in ${earningsData.daysOut}d — watch for catalyst`);
    }
  }

  // 10. Options liquidity (reward if options ideas exist — signals a liquid, optionable stock)
  if (optionsIdeasCount > 0) {
    score += 5;
    evidence.push(`Options available (${optionsIdeasCount} structure${optionsIdeasCount > 1 ? "s" : ""} generated)`);
  }

  // 11. Portfolio fit
  if (ibkrPositions && ibkrPositions.length > 0) {
    const owned = ibkrPositions.find(p => p.symbol === sym || p.ticker === sym);
    if (owned && owned.quantity > 0) {
      portfolio.push(`You hold ${owned.quantity} shares in IBKR — covered call may apply`);
    }
    const techTickers = ["AAPL","MSFT","NVDA","GOOGL","META","AMZN","AMD","TSLA","PLTR","ARM","INTC","AVGO"];
    const techExposure = ibkrPositions.filter(p => techTickers.includes(p.symbol || p.ticker)).length;
    const totalPositions = ibkrPositions.length;
    if (totalPositions > 0 && techTickers.includes(sym) && techExposure / totalPositions > 0.5) {
      portfolio.push("Portfolio >50% tech — this adds concentration");
    }
  }
  if (cashBalance != null && price > 0) {
    const maxSafePosition = cashBalance * 0.05;  // 5% of cash as rough max
    if (price * 100 > maxSafePosition) {
      portfolio.push(`100 shares = $${(price * 100).toLocaleString()} — consider sizing relative to available cash $${cashBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    }
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  // Classify
  let setup = "Neutral"; let direction = "Neutral"; let action = "Watch"; let risk = "Medium";

  if (contradictions.length >= evidence.length && contradictions.length > 0) {
    setup = "Evidence conflict"; direction = "Mixed"; action = "Avoid"; risk = "High";
  } else if (score >= 65 && isBull) {
    direction = "Bullish";
    setup = bullPatterns.length > 0 ? (bullPatterns[0].pattern || bullPatterns[0].name || "Bullish setup") : "Bullish momentum";
    action = score >= 80 ? "Research" : "Watch";
    risk = score >= 80 ? "Low" : "Medium";
  } else if (score <= 30 && isBear) {
    direction = "Bearish"; setup = bearPatterns.length > 0 ? (bearPatterns[0].pattern || bearPatterns[0].name || "Bearish setup") : "Bearish signal";
    action = "Avoid"; risk = "High";
  } else if (score >= 45 && !isBear) {
    direction = "Neutral"; setup = "Covered call / income candidate"; action = "Watch";
  }

  return { sym, score, direction, setup, action, risk, evidence, contradictions, portfolio, bias, confidence, full, quote, nativeScan };
}

// ── Research Brief Modal ──────────────────────────────────────────────────────

function ResearchBrief({ idea, onClose }) {
  const [backtestResult, setBacktestResult] = useState(null);
  const [optionsIdeas,   setOptionsIdeas]   = useState([]);
  const [newsItems,      setNews]           = useState([]);
  const [companyData,    setCompanyData]    = useState(null);
  const [earningsData,   setEarningsData]   = useState(null);

  useEffect(() => {
    const sym = idea.sym;
    const price = idea.quote?.price || 150;

    Promise.allSettled([
      fetch(`${LIVE_DATA_URL}/news/${sym}?limit=5`).then(r => r.ok ? r.json() : []),
      fetch(`${ANALYSIS_URL}/api/analysis/options/ideas/${sym}?spot=${price}&vol=0.3`).then(r => r.ok ? r.json() : null),
      fetch(`${LIVE_DATA_URL}/company/${sym}`).then(r => r.ok ? r.json() : null),
      fetch(`${LIVE_DATA_URL}/earnings/${sym}`).then(r => r.ok ? r.json() : null),
    ]).then(([newsRes, optRes, compRes, earnRes]) => {
      const news = newsRes.value;
      setNews(Array.isArray(news) ? news.slice(0, 5) : (news?.articles || []).slice(0, 5));
      const opts = optRes.value;
      setOptionsIdeas(opts ? (Array.isArray(opts) ? opts.slice(0, 2) : (opts.ideas || []).slice(0, 2)) : []);
      setCompanyData(compRes.value || null);
      setEarningsData(earnRes.value || null);
    });

    fetch(`${BACKTEST_URL}/api/backtest/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, strategy: "SMA_CROSSOVER", capital: 10000, positionPct: 0.95, commission: 1.0, slippage: 5 }),
    }).then(r => r.ok ? r.json() : null).then(setBacktestResult).catch(() => {});
  }, [idea.sym]);

  const signal = idea.full?.signal || idea.full?.blendedSignal || {};
  const bias   = String(signal.bias || signal.direction || "NEUTRAL").toUpperCase();
  const isBull = bias.includes("BULL") || bias === "BUY";
  const isBear = bias.includes("BEAR") || bias === "SELL";

  const verdict = idea.score >= 75 ? "Strong Watch" : idea.score >= 55 ? "Possible Entry" : idea.score >= 40 ? "Wait" : "Avoid";
  const verdictColor = idea.score >= 75 ? "text-positive" : idea.score >= 55 ? "text-warning" : "text-negative";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="bg-canvas border border-line rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-ink">{idea.sym}</span>
              <span className={cn("text-sm font-semibold", isBull ? "text-positive" : isBear ? "text-negative" : "text-muted")}>
                {isBull ? <TrendingUp size={14} className="inline mr-1" /> : isBear ? <TrendingDown size={14} className="inline mr-1" /> : null}
                {bias}
              </span>
              <span className={cn("text-sm font-bold px-3 py-0.5 rounded-full border", verdictColor,
                idea.score >= 55 ? "bg-positive/10 border-positive/30" : "bg-negative/10 border-negative/30"
              )}>{verdict}</span>
            </div>
            {idea.quote?.price && (
              <div className="text-sm text-muted mt-0.5">${Number(idea.quote.price).toFixed(2)} · Score {idea.score}/100</div>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface transition-colors text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Bull / Bear cases */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-positive/5 border border-positive/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2 font-semibold text-positive text-sm">
                <TrendingUp size={14} /> Bull Case
              </div>
              <ul className="space-y-1">
                {idea.evidence.map((e, i) => (
                  <li key={i} className="text-xs text-ink flex items-start gap-1.5">
                    <CheckCircle size={10} className="text-positive mt-0.5 shrink-0" />{e}
                  </li>
                ))}
                {idea.evidence.length === 0 && <li className="text-xs text-muted">No bullish signals</li>}
              </ul>
            </div>
            <div className="bg-negative/5 border border-negative/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2 font-semibold text-negative text-sm">
                <TrendingDown size={14} /> Bear Case
              </div>
              <ul className="space-y-1">
                {idea.contradictions.map((c, i) => (
                  <li key={i} className="text-xs text-ink flex items-start gap-1.5">
                    <XCircle size={10} className="text-negative mt-0.5 shrink-0" />{c}
                  </li>
                ))}
                {idea.contradictions.length === 0 && <li className="text-xs text-muted">No bearish signals</li>}
              </ul>
            </div>
          </div>

          {/* Technical trend + price levels + earnings risk + volume */}
          <div className="grid grid-cols-2 gap-4">
            {/* Technical trend */}
            <div className="bg-surface border border-line rounded-xl p-4">
              <div className="text-xs font-semibold text-ink mb-2 flex items-center gap-1.5">
                <Activity size={12} /> Technical Trend
              </div>
              <div className="space-y-1.5 text-xs">
                {idea.full?.signal && (
                  <div className="flex justify-between">
                    <span className="text-muted">Signal</span>
                    <span className={cn("font-medium", signalColor(idea.full.signal.bias || idea.full.signal.direction || ""))}>
                      {idea.full.signal.bias || idea.full.signal.direction || idea.full.signal.action || "—"}
                    </span>
                  </div>
                )}
                {idea.full?.weeklySignal && (
                  <div className="flex justify-between">
                    <span className="text-muted">Weekly</span>
                    <span className={cn("font-medium", signalColor(idea.full.weeklySignal.bias || idea.full.weeklySignal.action || ""))}>
                      {idea.full.weeklySignal.bias || idea.full.weeklySignal.action || "—"}
                    </span>
                  </div>
                )}
                {idea.full?.regime && (
                  <div className="flex justify-between">
                    <span className="text-muted">Regime</span>
                    <span className="text-ink">{idea.full.regime}</span>
                  </div>
                )}
                {companyData?.beta && (
                  <div className="flex justify-between">
                    <span className="text-muted">Beta</span>
                    <span className="text-ink">{companyData.beta.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Price levels + earnings risk */}
            <div className="bg-surface border border-line rounded-xl p-4">
              <div className="text-xs font-semibold text-ink mb-2">Price Levels & Catalyst Risk</div>
              <div className="space-y-1.5 text-xs">
                {(idea.full?.levels?.resistances || idea.full?.levels?.resistance || []).slice(0, 1).map((r, i) => {
                  const val = typeof r === "number" ? r : r?.level ?? null;
                  return val ? (
                    <div key={i} className="flex justify-between">
                      <span className="text-muted">Resistance</span>
                      <span className="text-negative font-mono">${Number(val).toFixed(2)}</span>
                    </div>
                  ) : null;
                })}
                {(idea.full?.levels?.supports || idea.full?.levels?.support || []).slice(0, 1).map((s, i) => {
                  const val = typeof s === "number" ? s : s?.level ?? null;
                  return val ? (
                    <div key={i} className="flex justify-between">
                      <span className="text-muted">Support</span>
                      <span className="text-positive font-mono">${Number(val).toFixed(2)}</span>
                    </div>
                  ) : null;
                })}
                {companyData?.fiftyTwoWeekHigh && (
                  <div className="flex justify-between">
                    <span className="text-muted">52W High</span>
                    <span className="text-ink font-mono">${companyData.fiftyTwoWeekHigh.toFixed(2)}</span>
                  </div>
                )}
                {companyData?.fiftyTwoWeekLow && (
                  <div className="flex justify-between">
                    <span className="text-muted">52W Low</span>
                    <span className="text-ink font-mono">${companyData.fiftyTwoWeekLow.toFixed(2)}</span>
                  </div>
                )}
                {earningsData?.nextEarningsDate && (
                  <div className="flex justify-between">
                    <span className="text-muted">Next Earnings</span>
                    <span className={cn("font-medium", earningsData.catalystRisk ? "text-negative" : "text-warning")}>
                      {earningsData.nextEarningsDate} ({earningsData.daysOut}d)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Volume / participation */}
          {(idea.quote?.volume || companyData?.avgVolume) && (
            <div className="bg-surface border border-line rounded-xl p-4">
              <div className="text-xs font-semibold text-ink mb-2">Volume & Participation</div>
              <div className="flex gap-6 text-xs">
                {idea.quote?.volume && (
                  <div>
                    <div className="text-muted">Today's Volume</div>
                    <div className="font-semibold text-ink">{(Number(idea.quote.volume) / 1e6).toFixed(2)}M</div>
                  </div>
                )}
                {companyData?.avgVolume && (
                  <div>
                    <div className="text-muted">Avg Volume (3M)</div>
                    <div className="font-semibold text-ink">{(Number(companyData.avgVolume) / 1e6).toFixed(2)}M</div>
                  </div>
                )}
                {idea.quote?.volume && companyData?.avgVolume && (
                  <div>
                    <div className="text-muted">RVOL</div>
                    <div className={cn("font-semibold", Number(idea.quote.volume) > Number(companyData.avgVolume) * 1.5 ? "text-positive" : "text-ink")}>
                      {(Number(idea.quote.volume) / Number(companyData.avgVolume)).toFixed(2)}×
                    </div>
                  </div>
                )}
                {companyData?.marketCap && (
                  <div>
                    <div className="text-muted">Market Cap</div>
                    <div className="font-semibold text-ink">${(Number(companyData.marketCap) / 1e9).toFixed(1)}B</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Portfolio context */}
          {idea.portfolio?.length > 0 && (
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2 font-semibold text-warning text-sm">
                <Briefcase size={14} /> Portfolio Context
              </div>
              {idea.portfolio.map((p, i) => (
                <div key={i} className="text-xs text-ink flex items-start gap-1.5 mb-1">
                  <AlertTriangle size={10} className="text-warning mt-0.5 shrink-0" />{p}
                </div>
              ))}
            </div>
          )}

          {/* Backtest summary */}
          {backtestResult && (
            <div>
              <div className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
                <BarChart2 size={14} /> Backtest Summary (SMA Crossover, 1Y)
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  ["Return",    pctValue(backtestResult.totalPnlPct),                   Number(backtestResult.totalPnlPct) > 0],
                  ["Sharpe",     backtestResult.sharpeRatio?.toFixed(2),               (backtestResult.sharpeRatio || 0) > 1],
                  ["Win Rate",   pctValue(backtestResult.winRate, 0),                  (backtestResult.winRate || 0) > 50],
                  ["Max DD",     pctValue(backtestResult.maxDrawdownPct),              (backtestResult.maxDrawdownPct || 0) < 15],
                ].map(([label, val, good]) => (
                  <div key={label} className="bg-surface rounded-lg p-2 border border-line text-center">
                    <div className="text-2xs text-muted">{label}</div>
                    <div className={cn("text-sm font-bold", good ? "text-positive" : "text-negative")}>{val ?? "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Options ideas */}
          {optionsIdeas.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
                <DollarSign size={14} /> Options Setup
              </div>
              {optionsIdeas.map((o, i) => (
                <div key={i} className="bg-surface border border-line rounded-lg p-3 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-ink">{o.structure}</span>
                    <span className="text-2xs text-muted">{o.direction}</span>
                  </div>
                  <div className="text-2xs text-muted space-y-0.5">
                    {o.legs && <div>{o.legs}</div>}
                    <div>Max loss: <span className="text-negative">${o.maxLoss}</span> · Max profit: <span className="text-positive">{o.maxProfit?.startsWith?.("U") ? "Unlimited" : `$${o.maxProfit}`}</span> · BE: ${o.breakeven}</div>
                    {o.rationale && <div className="text-ink mt-1">{o.rationale}</div>}
                    {o.invalidation && <div className="text-negative mt-0.5">Invalidated if: {o.invalidation}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent news */}
          {newsItems.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
                <Newspaper size={14} /> Recent Catalysts
              </div>
              {newsItems.map((n, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-line last:border-0">
                  <Minus size={10} className="text-muted mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-ink">{n.title || n.headline}</p>
                    <p className="text-2xs text-muted">{n.source} · {n.published_at ? new Date(n.published_at).toLocaleDateString() : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Idea card ─────────────────────────────────────────────────────────────────

const ACTION_STYLE = {
  Research:      "bg-accent/10 text-accent border-accent/30",
  Watch:         "bg-warning/10 text-warning border-warning/30",
  Avoid:         "bg-negative/10 text-negative border-negative/30",
  "Paper Trade": "bg-positive/10 text-positive border-positive/30",
};

function IdeaCard({ idea, onViewChart, onDecision, decision, onOpenBrief }) {
  const [expanded, setExpanded] = useState(false);
  const pos = idea.direction === "Bullish";
  const neg = idea.direction === "Bearish";
  const q   = idea.quote;

  return (
    <div className={cn(
      "bg-canvas border border-line rounded-xl overflow-hidden hover:shadow-md transition-shadow",
      expanded && "ring-1 ring-accent/20",
    )}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface/40 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Score */}
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 border-2",
          idea.score >= 70 ? "border-positive text-positive bg-positive/10" :
          idea.score >= 45 ? "border-warning text-warning bg-warning/10" :
                             "border-negative text-negative bg-negative/10",
        )}>
          {idea.score}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-ink">{idea.sym}</span>
            <span className={cn(
              "text-2xs px-1.5 py-0.5 rounded font-medium",
              pos ? "bg-positive/10 text-positive" : neg ? "bg-negative/10 text-negative" : "bg-surface text-muted",
            )}>
              {pos ? <TrendingUp size={9} className="inline mr-0.5" /> : neg ? <TrendingDown size={9} className="inline mr-0.5" /> : <Minus size={9} className="inline mr-0.5" />}
              {idea.direction}
            </span>
            {q?.price && <span className="text-xs font-mono text-muted">${Number(q.price).toFixed(2)}</span>}
            {(q?.change_pct ?? q?.changePercent) != null && (
              <span className={cn("text-2xs font-mono", quoteChangePct(q) >= 0 ? "text-positive" : "text-negative")}>
                {quoteChangePct(q) >= 0 ? "+" : ""}{quoteChangePct(q).toFixed(1)}%
              </span>
            )}
            {idea.portfolio?.length > 0 && (
              <AlertTriangle size={11} className="text-warning" title={idea.portfolio[0]} />
            )}
          </div>
          <div className="text-xs text-muted mt-0.5 truncate">{idea.setup}</div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {decision && (
            <span className={cn("text-2xs px-2 py-0.5 rounded border font-medium opacity-60", ACTION_STYLE[decision] || "bg-surface border-line text-muted")}>
              {decision}
            </span>
          )}
          <span className={cn("text-2xs px-2 py-0.5 rounded border font-medium", ACTION_STYLE[idea.action] || "bg-surface border-line text-muted")}>
            {idea.action}
          </span>
          <ChevronRight size={14} className={cn("text-muted transition-transform", expanded && "rotate-90")} />
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-line pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-2xs font-medium text-subtle uppercase tracking-wider mb-1.5">Evidence ({idea.evidence.length})</div>
              {idea.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 mb-1">
                  <CheckCircle size={10} className="text-positive mt-0.5 shrink-0" />
                  <span className="text-xs text-ink">{e}</span>
                </div>
              ))}
              {!idea.evidence.length && <span className="text-2xs text-muted">No supporting signals</span>}
            </div>
            <div>
              <div className="text-2xs font-medium text-subtle uppercase tracking-wider mb-1.5">Contradictions ({idea.contradictions.length})</div>
              {idea.contradictions.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5 mb-1">
                  <XCircle size={10} className="text-negative mt-0.5 shrink-0" />
                  <span className="text-xs text-ink">{c}</span>
                </div>
              ))}
              {!idea.contradictions.length && <span className="text-2xs text-muted">No contradictions</span>}
            </div>
          </div>

          {idea.portfolio?.length > 0 && (
            <div className="bg-warning/5 border border-warning/20 rounded-lg px-3 py-2">
              <div className="text-2xs font-medium text-warning uppercase tracking-wider mb-1">Portfolio Context</div>
              {idea.portfolio.map((p, i) => (
                <div key={i} className="text-xs text-ink flex items-start gap-1.5 mb-0.5">
                  <AlertTriangle size={10} className="text-warning mt-0.5 shrink-0" />{p}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-2xs text-muted">Risk:</span>
            <span className={cn("text-2xs font-medium",
              idea.risk === "Low" ? "text-positive" : idea.risk === "High" ? "text-negative" : "text-warning"
            )}>{idea.risk}</span>
            <div className="flex-1" />
            <button
              onClick={() => onOpenBrief(idea)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-surface border border-line rounded hover:bg-surface/80 text-ink"
            >
              <BookOpen size={11} /> Research Brief
            </button>
            <button
              onClick={() => onViewChart(idea.sym)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-surface border border-line rounded hover:bg-surface/80 text-ink"
            >
              <Activity size={11} /> Chart
            </button>
            {(["Watch","Paper Trade","Avoid"]).map(action => (
              <button
                key={action}
                onClick={() => onDecision(idea.sym, action)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 text-xs rounded border transition-colors",
                  decision === action ? "ring-1 ring-offset-1 ring-current" : "",
                  ACTION_STYLE[action] || "bg-surface border-line text-muted",
                )}
              >
                {action === "Watch"       && <Eye size={10} />}
                {action === "Paper Trade" && <Target size={10} />}
                {action === "Avoid"       && <Ban size={10} />}
                {action}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Intraday card ─────────────────────────────────────────────────────────────

function IntradayCard({ data }) {
  const up = data.breakoutDirection === "UP";
  return (
    <div className="bg-canvas border border-line rounded-xl px-4 py-3 flex items-center gap-4">
      <div className={cn(
        "w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold border-2 shrink-0",
        up ? "border-positive text-positive bg-positive/10" : "border-negative text-negative bg-negative/10",
      )}>
        {data.openRvol?.toFixed(1)}x
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-ink">{data.symbol}</span>
          {up ? <TrendingUp size={13} className="text-positive" /> : <TrendingDown size={13} className="text-negative" />}
          <span className="text-2xs text-muted">RVOL {data.openRvol?.toFixed(2)}x avg {(data.avgOpenVolume / 1e3).toFixed(0)}K</span>
          <span className="text-2xs font-mono text-muted">${data.price?.toFixed(2)}</span>
        </div>
        <div className="text-2xs text-muted mt-0.5">
          OR High: ${data.openRangeHigh?.toFixed(2)} / Low: ${data.openRangeLow?.toFixed(2)} ·
          Breakout: {data.breakoutDirection} ·
          {data.followThrough ? " ✓ Follow-through" : " No follow-through"}
        </div>
        {data.riskFlags?.length > 0 && (
          <div className="text-2xs text-warning mt-0.5">{data.riskFlags.join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Opportunities({ onNav }) {
  const [watchlistInput, setWatchlistInput] = useState(DEFAULT_WATCHLIST.join(", "));
  const [ideas,          setIdeas]          = useState([]);
  const [scanning,       setScanning]       = useState(false);
  const [progress,       setProgress]       = useState({ done: 0, total: 0 });
  const [mode,           setMode]           = useState("swing");
  const [intradayData,   setIntradayData]   = useState([]);
  const [decisions,      setDecisions]      = useState(() => {
    try { return JSON.parse(localStorage.getItem(DECISIONS_KEY) || "{}"); }
    catch { return {}; }
  });
  const [briefIdea,      setBriefIdea]      = useState(null);
  const abortRef = useRef(null);

  // Persist decisions
  useEffect(() => {
    localStorage.setItem(DECISIONS_KEY, JSON.stringify(decisions));
  }, [decisions]);

  const scan = useCallback(async () => {
    const symbols = watchlistInput.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setScanning(true); setIdeas([]); setProgress({ done: 0, total: symbols.length });

    // Fetch IBKR positions + banking cash + native C++ scanner for context (best-effort)
    let ibkrPositions = [], cashBalance = null;
    let nativeBySymbol = {};
    try {
      const ibkrRes = await fetch(`${IBKR_URL}/ibkr/positions`, { signal: abort.signal });
      if (ibkrRes.ok) { const d = await ibkrRes.json(); ibkrPositions = Array.isArray(d) ? d : d.positions || []; }
    } catch {}
    try {
      const bankRes = await fetch(`${BANKING_URL}/banking/accounts`, { signal: abort.signal });
      if (bankRes.ok) {
        const d = await bankRes.json();
        const accounts = Array.isArray(d) ? d : d.accounts || [];
        cashBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance || acc.available || 0), 0);
      }
    } catch {}
    try {
      const nativeRes = await fetch(`${ANALYSIS_URL}/api/analysis/opportunities/native-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({ symbols }),
      });
      if (nativeRes.ok) {
        const d = await nativeRes.json();
        const nativeResults = Array.isArray(d) ? d : d.results || [];
        nativeBySymbol = Object.fromEntries(nativeResults.map(item => [item.symbol || item.sym, item]));
      }
    } catch {}

    const results = [];
    for (const sym of symbols) {
      if (abort.signal.aborted) break;
      try {
        const [fullRes, quoteRes, sentRes, earningsRes, companyRes] = await Promise.allSettled([
          fetch(`${ANALYSIS_URL}/api/analysis/research-brief/${sym}`,      { signal: abort.signal }).then(r => r.ok ? r.json() : null),
          fetch(`${LIVE_DATA_URL}/quote/${sym}`,                          { signal: abort.signal }).then(r => r.ok ? r.json() : null),
          fetch(`${SENTIMENT_URL}/sentiment/symbol/${sym}?limit=25`,       { signal: abort.signal }).then(r => r.ok ? r.json() : null),
          fetch(`${LIVE_DATA_URL}/earnings/${sym}`,                       { signal: abort.signal }).then(r => r.ok ? r.json() : null),
          fetch(`${LIVE_DATA_URL}/company/${sym}`,                        { signal: abort.signal }).then(r => r.ok ? r.json() : null),
        ]);
        const full          = fullRes.status       === "fulfilled" ? fullRes.value       : null;
        const quote         = quoteRes.status      === "fulfilled" ? quoteRes.value      : null;
        const sent          = sentRes.status       === "fulfilled" ? sentRes.value       : null;
        const earningsData  = earningsRes.status   === "fulfilled" ? earningsRes.value   : null;
        const companyData   = companyRes.status    === "fulfilled" ? companyRes.value    : null;
        const spot = Number(quote?.price || companyData?.fiftyTwoWeekHigh || 150);
        const optIdeas = await fetch(`${ANALYSIS_URL}/api/analysis/options/ideas/${sym}?spot=${spot}&vol=0.3`, { signal: abort.signal })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);
        const sentimentScore      = sent?.aggregated?.score ?? sent?.sentiment_score ?? sent?.score ?? sent?.sentimentScore ?? null;
        const optionsIdeasCount   = Array.isArray(optIdeas) ? optIdeas.length : (optIdeas?.ideas?.length ?? 0);

        if (full) {
          results.push(computeScore({
            sym, full, quote, sentimentScore, ibkrPositions, cashBalance, earningsData, companyData,
            optionsIdeasCount, nativeScan: nativeBySymbol[sym]
          }));
        }
      } catch (e) {
        if (e.name === "AbortError") break;
      }
      setProgress(p => ({ ...p, done: p.done + 1 }));
      await new Promise(r => setTimeout(r, 0));
    }

    results.sort((a, b) => {
      const order = { Research: 0, "Paper Trade": 1, Watch: 2, Avoid: 3 };
      const oa = order[a.action] ?? 2, ob = order[b.action] ?? 2;
      return oa !== ob ? oa - ob : b.score - a.score;
    });

    setIdeas(results);
    setScanning(false);
  }, [watchlistInput]);

  const scanIntraday = useCallback(async () => {
    const symbols = watchlistInput.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    setScanning(true); setIntradayData([]);
    const results = [];
    for (const sym of symbols) {
      try {
        const d = await fetch(`${LIVE_DATA_URL}/intraday/${sym}/rvol`).then(r => r.ok ? r.json() : null);
        if (d && !d.error) results.push(d);
      } catch {}
    }
    results.sort((a, b) => (b.openRvol ?? 0) - (a.openRvol ?? 0));
    setIntradayData(results);
    setScanning(false);
  }, [watchlistInput]);

  function handleDecision(sym, action) {
    setDecisions(d => ({ ...d, [sym]: action }));
  }

  function handleViewChart(sym) {
    try { localStorage.setItem(MARKET_SELECTED_SYMBOL_KEY, sym); } catch {}
    onNav?.("markets");
  }

  const actionCounts = ideas.reduce((acc, idea) => {
    acc[idea.action] = (acc[idea.action] || 0) + 1;
    return acc;
  }, {});

  const decisionList = Object.entries(decisions).filter(([, v]) => v);

  return (
    <div className="space-y-5 max-w-5xl">
      {briefIdea && <ResearchBrief idea={briefIdea} onClose={() => setBriefIdea(null)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <Zap size={20} className="text-accent" /> Opportunities
          </h1>
          <p className="text-sm text-muted mt-0.5">
            Scan your watchlist for ranked, explainable trade ideas with evidence and portfolio context.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface border border-line rounded-lg p-1">
          <button
            onClick={() => setMode("swing")}
            className={cn("px-3 py-1.5 text-xs rounded font-medium transition-colors",
              mode === "swing" ? "bg-canvas shadow-sm text-ink" : "text-muted hover:text-ink")}
          >
            Swing / Position
          </button>
          <button
            onClick={() => setMode("intraday")}
            className={cn("flex items-center gap-1 px-3 py-1.5 text-xs rounded font-medium transition-colors",
              mode === "intraday" ? "bg-canvas shadow-sm text-ink" : "text-muted hover:text-ink")}
          >
            <Radio size={10} /> Intraday Flow
          </button>
        </div>
      </div>

      {/* Input */}
      <div className="flex gap-2 flex-wrap">
        <textarea
          value={watchlistInput}
          onChange={e => setWatchlistInput(e.target.value)}
          rows={2}
          placeholder="AAPL, NVDA, MSFT, …"
          className="flex-1 min-w-64 text-xs bg-surface border border-line rounded-lg px-3 py-2 text-ink resize-none focus:outline-none focus:border-accent/50 font-mono"
        />
        <button
          onClick={mode === "swing" ? scan : scanIntraday}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 disabled:opacity-50 self-start"
        >
          {scanning
            ? <><RefreshCw size={14} className="animate-spin" /> {progress.done}/{progress.total}</>
            : <><Zap size={14} /> Scan</>}
        </button>
      </div>

      {/* Summary */}
      {ideas.length > 0 && mode === "swing" && (
        <div className="flex gap-2 flex-wrap items-center">
          {Object.entries(actionCounts).map(([action, count]) => (
            <div key={action} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium",
              ACTION_STYLE[action] || "bg-surface border-line text-muted"
            )}>
              {count} {action}
            </div>
          ))}
          <div className="text-xs text-muted px-2">{ideas.length} symbols scanned</div>
        </div>
      )}

      {/* Decision log */}
      {decisionList.length > 0 && (
        <div className="bg-surface border border-line rounded-xl px-4 py-3">
          <div className="text-2xs font-medium text-subtle uppercase tracking-wider mb-2">Your Decisions (saved)</div>
          <div className="flex gap-2 flex-wrap">
            {decisionList.map(([sym, action]) => (
              <span key={sym} className={cn("text-xs px-2 py-0.5 rounded border font-medium",
                ACTION_STYLE[action] || "bg-surface border-line text-muted"
              )}>
                {sym} → {action}
                <button onClick={() => setDecisions(d => { const n = { ...d }; delete n[sym]; return n; })}
                  className="ml-1 opacity-50 hover:opacity-100">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Swing results */}
      {mode === "swing" && ideas.length > 0 && (
        <div className="space-y-2">
          {ideas.map(idea => (
            <IdeaCard
              key={idea.sym}
              idea={idea}
              decision={decisions[idea.sym]}
              onViewChart={handleViewChart}
              onDecision={handleDecision}
              onOpenBrief={setBriefIdea}
            />
          ))}
        </div>
      )}

      {/* Intraday results */}
      {mode === "intraday" && intradayData.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted">Ranked by opening RVOL. Requires market-hours intraday data from live-data-svc.</p>
          {intradayData.map(d => <IntradayCard key={d.symbol} data={d} />)}
        </div>
      )}

      {/* Empty states */}
      {!scanning && mode === "swing" && ideas.length === 0 && (
        <div className="text-center py-16 text-muted">
          <Zap size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Hit Scan to analyse your watchlist.</p>
          <p className="text-xs mt-1">
            Scores trend, momentum, volume, support distance, patterns, seasonality, sentiment, regime, and portfolio fit.
          </p>
        </div>
      )}
      {!scanning && mode === "intraday" && intradayData.length === 0 && (
        <div className="text-center py-16 text-muted">
          <Radio size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Hit Scan to run the opening RVOL scanner.</p>
          <p className="text-xs mt-1">Requires intraday data — works best during market hours.</p>
        </div>
      )}
    </div>
  );
}
