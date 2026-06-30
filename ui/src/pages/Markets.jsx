import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart, CandlestickSeries, BarSeries, AreaSeries, BaselineSeries,
  HistogramSeries, LineSeries, LineStyle, PriceScaleMode,
  createSeriesMarkers, createTextWatermark,
} from "lightweight-charts";
import {
  Search, TrendingUp, TrendingDown, Minus, Activity, BarChart2,
  Layers, Brain, Newspaper, RefreshCw, CheckCircle, XCircle,
  DollarSign, Gauge, LineChart, CandlestickChart, Target as TargetIcon,
  X, Plus,
} from "lucide-react";
import { cn } from "../lib/cn";
import { ForecastWidget } from "../components/ForecastWidget";

const ANALYSIS_URL  = import.meta.env.VITE_ANALYSIS_URL  || "http://localhost:8088";
const LIVE_DATA_URL = import.meta.env.VITE_LIVE_DATA_URL || "http://localhost:8096";
const AI_URL        = import.meta.env.VITE_AI_ADVISOR_URL|| "http://localhost:8094";
const BACKTEST_URL  = import.meta.env.VITE_BACKTEST_URL  || "http://localhost:8089";

const DEFAULT_WATCHLIST = ["AAPL","NVDA","MSFT","AMZN","TSLA","GOOGL","META","AMD","SPY","QQQ"];
const WATCHLIST_KEY = "aw_markets_watchlist";
const SELECTED_SYMBOL_KEY = "aw_markets_selected_symbol";

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
    if (Array.isArray(saved) && saved.length) return saved.filter(Boolean);
  } catch { /* ignore */ }
  return DEFAULT_WATCHLIST;
}

function loadSelectedSymbol() {
  try {
    const saved = String(localStorage.getItem(SELECTED_SYMBOL_KEY) || "").trim().toUpperCase();
    if (/^[A-Z0-9.\-]{1,8}$/.test(saved)) return saved;
  } catch { /* ignore */ }
  return "AAPL";
}

// Timeframes: label shown to user, yfinance period, interval
const PERIODS = [
  { label: "1D",  period: "2d",  interval: "1m"  },
  { label: "5D",  period: "5d",  interval: "5m"  },
  { label: "1M",  period: "1mo", interval: "1h"  },
  { label: "3M",  period: "3mo", interval: "1d"  },
  { label: "6M",  period: "6mo", interval: "1d"  },
  { label: "1Y",  period: "1y",  interval: "1d"  },
  { label: "5Y",  period: "5y",  interval: "1wk" },
];

const isDarkMode = () => document.documentElement.classList.contains("dark");

// TradingView's news timeline needs an exchange-qualified symbol (e.g. NASDAQ:AAPL).
// Map the common watchlist; fall back to the bare ticker for TradingView to resolve.
const TV_AMEX   = new Set(["SPY","VOO","DIA","IWM","GLD","SLV","XLF","XLK","XLE","ARKK"]);
const TV_NASDAQ = new Set([
  "AAPL","NVDA","MSFT","AMZN","TSLA","GOOGL","GOOG","META","AMD","QQQ","COIN","PLTR",
  "ARM","INTC","AVGO","NFLX","ADBE","CSCO","PEP","COST","TXN","QCOM","AMAT","MU","MRVL","SBUX",
]);
function tvSymbol(sym) {
  const s = String(sym || "").toUpperCase();
  if (TV_AMEX.has(s))   return `AMEX:${s}`;
  if (TV_NASDAQ.has(s)) return `NASDAQ:${s}`;
  return s;
}

// ── Technical calculations (client-side) ─────────────────────────────────────

function sma(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const avg = data.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period;
    return { time: data[i].time, value: avg };
  }).filter(Boolean);
}

function ema(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let prev = data.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  result.push({ time: data[period - 1].time, value: prev });
  for (let i = period; i < data.length; i++) {
    prev = data[i].close * k + prev * (1 - k);
    result.push({ time: data[i].time, value: prev });
  }
  return result;
}

// EMA over an array of { time, value } points (used for MACD signal line)
function emaVals(points, period) {
  if (points.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = points.slice(0, period).reduce((s, p) => s + p.value, 0) / period;
  out.push({ time: points[period - 1].time, value: prev });
  for (let i = period; i < points.length; i++) {
    prev = points[i].value * k + prev * (1 - k);
    out.push({ time: points[i].time, value: prev });
  }
  return out;
}

function vwap(data) {
  let cumTPV = 0, cumVol = 0;
  return data.map(c => {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * (c.volume || 0);
    cumVol += (c.volume || 0);
    return { time: c.time, value: cumVol > 0 ? cumTPV / cumVol : c.close };
  });
}

// Full RSI(14) series (Wilder's smoothing) → [{ time, value }]
function rsiSeries(data, period = 14) {
  if (data.length < period + 1) return [];
  const out = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = data[i].close - data[i - 1].close;
    if (ch > 0) avgGain += ch; else avgLoss += -ch;
  }
  avgGain /= period; avgLoss /= period;
  const rsiAt = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out.push({ time: data[period].time, value: +rsiAt().toFixed(2) });
  for (let i = period + 1; i < data.length; i++) {
    const ch = data[i].close - data[i - 1].close;
    avgGain = (avgGain * (period - 1) + Math.max(0, ch)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -ch)) / period;
    out.push({ time: data[i].time, value: +rsiAt().toFixed(2) });
  }
  return out;
}

// Full MACD(12,26,9) → { macd, signal, hist }
function macdSeries(data) {
  if (data.length < 35) return { macd: [], signal: [], hist: [] };
  const e12 = ema(data, 12);
  const e26 = ema(data, 26);
  const m26 = new Map(e26.map(d => [d.time, d.value]));
  const macd = [];
  for (const d of e12) if (m26.has(d.time)) macd.push({ time: d.time, value: +(d.value - m26.get(d.time)).toFixed(4) });
  const signal = emaVals(macd, 9);
  const ms = new Map(signal.map(d => [d.time, d.value]));
  const hist = [];
  for (const d of macd) if (ms.has(d.time)) {
    const h = +(d.value - ms.get(d.time)).toFixed(4);
    hist.push({ time: d.time, value: h, color: h >= 0 ? "#22C55E88" : "#EF444488" });
  }
  return { macd, signal, hist };
}

// Last RSI value from a series (for the top-bar badge / evidence)
function lastVal(series) { return series.length ? series[series.length - 1].value : null; }

// Buy/Sell markers from a fast vs slow MA crossover
function crossMarkers(fast, slow) {
  const sm = new Map(slow.map(d => [d.time, d.value]));
  const out = [];
  let prev = null;
  for (const f of fast) {
    if (!sm.has(f.time)) continue;
    const diff = f.value - sm.get(f.time);
    if (prev != null) {
      if (prev <= 0 && diff > 0)
        out.push({ time: f.time, position: "belowBar", color: "#22C55E", shape: "arrowUp",   text: "Buy"  });
      else if (prev >= 0 && diff < 0)
        out.push({ time: f.time, position: "aboveBar", color: "#EF4444", shape: "arrowDown", text: "Sell" });
    }
    prev = diff;
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function signalColor(bias) {
  const b = String(bias || "").toUpperCase();
  if (b.includes("BULL") || b === "BUY" || b === "STRONG_BUY") return "text-positive";
  if (b.includes("BEAR") || b === "SELL" || b === "STRONG_SELL") return "text-negative";
  return "text-warning";
}

function signalIcon(bias) {
  const b = String(bias || "").toUpperCase();
  if (b.includes("BULL") || b === "BUY") return <TrendingUp size={13} />;
  if (b.includes("BEAR") || b === "SELL") return <TrendingDown size={13} />;
  return <Minus size={13} />;
}

function changePct(q) {
  return Number(q?.change_pct ?? q?.changePercent ?? 0);
}

function pctValue(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function confidencePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
}

function Pill({ children, active, onClick, color, title }) {
  return (
    <button onClick={onClick} title={title} className={cn(
      "px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
      active
        ? color ? `bg-${color}/20 text-${color} border border-${color}/40` : "bg-accent text-white"
        : "bg-surface text-muted hover:text-ink border border-line",
    )}>{children}</button>
  );
}

function IconToggle({ active, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} className={cn(
      "p-1.5 rounded-md transition-colors border",
      active ? "bg-accent text-white border-accent" : "bg-surface text-muted hover:text-ink border-line",
    )}>{children}</button>
  );
}

// ── TradingView embedded widgets (free, no API key) ──────────────────────────

function TVWidget({ src, config, className, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    el.appendChild(inner);
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify(config);
    el.appendChild(s);
    return () => { el.innerHTML = ""; };
  }, [src, JSON.stringify(config)]);
  return <div ref={ref} className={cn("tradingview-widget-container", className)} style={style} />;
}

// Aggregate Buy/Sell/Neutral gauge — second opinion beside our own signal.
// Needs ~300px width to render the speedometer without clipping, so it lives
// in the full-width bottom "Consensus" tab rather than the narrow side panel.
function TAGauge({ symbol, height = 360 }) {
  return (
    <TVWidget
      src="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js"
      style={{ height, width: "100%" }}
      config={{
        interval: "1D",
        width: "100%",
        height,
        isTransparent: true,
        symbol,
        showIntervalTabs: true,
        displayMode: "multiple",
        locale: "en",
        colorTheme: isDarkMode() ? "dark" : "light",
      }}
    />
  );
}

function ConsensusTab({ sym }) {
  return (
    <div className="px-3 py-2 h-full">
      <TAGauge symbol={sym} height={260} />
    </div>
  );
}

// Top Stories news timeline for the symbol
function TVTopStories({ symbol }) {
  return (
    <TVWidget
      src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js"
      style={{ height: 420, width: "100%" }}
      config={{
        feedMode: "symbol",
        symbol: tvSymbol(symbol),
        isTransparent: true,
        displayMode: "regular",
        width: "100%",
        height: 420,
        colorTheme: isDarkMode() ? "dark" : "light",
        locale: "en",
      }}
    />
  );
}

// Full fundamentals: income statement, balance sheet, cash flow, statistics
function TVFundamentals({ symbol }) {
  return (
    <TVWidget
      src="https://s3.tradingview.com/external-embedding/embed-widget-financials.js"
      style={{ height: 490, width: "100%" }}
      config={{
        isTransparent: true,
        largeChartUrl: "",
        displayMode: "regular",
        width: "100%",
        height: 490,
        colorTheme: isDarkMode() ? "dark" : "light",
        symbol,
        locale: "en",
      }}
    />
  );
}

// Full TradingView chart with drawing tools / Fibonacci / 100+ indicators
function ProChart({ symbol }) {
  return (
    <TVWidget
      src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
      style={{ height: "100%", width: "100%" }}
      config={{
        autosize: true,
        symbol,
        interval: "D",
        timezone: "Etc/UTC",
        theme: isDarkMode() ? "dark" : "light",
        style: "1",
        locale: "en",
        allow_symbol_change: true,
        withdateranges: true,
        hide_side_toolbar: false,
        details: true,
        support_host: "https://www.tradingview.com",
      }}
    />
  );
}

// ── Chart hook ────────────────────────────────────────────────────────────────

function useChart(containerRef) {
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);
  const barRef       = useRef(null);
  const areaRef      = useRef(null);
  const baselineRef  = useRef(null);
  const volRef       = useRef(null);
  const sma20Ref     = useRef(null);
  const ema9Ref      = useRef(null);
  const vwapRef      = useRef(null);
  const rsiRef       = useRef(null);
  const macdRef      = useRef(null);
  const macdSignalRef= useRef(null);
  const macdHistRef  = useRef(null);
  const markersRef   = useRef(null);
  const watermarkRef = useRef(null);

  const [legend, setLegend] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const dark = isDarkMode();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: dark ? "#9CA3AF" : "#6B7280",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        panes: { separatorColor: dark ? "#374151" : "#E5E7EB", separatorHoverColor: "rgba(59,130,246,0.2)" },
      },
      grid: {
        vertLines: { color: dark ? "#1F2937" : "#F3F4F6" },
        horzLines: { color: dark ? "#1F2937" : "#F3F4F6" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: dark ? "#374151" : "#E5E7EB" },
      timeScale: { borderColor: dark ? "#374151" : "#E5E7EB", timeVisible: true, secondsVisible: false },
    });

    // ── Main price series (pane 0) — one visible at a time ──
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#22C55E", downColor: "#EF4444",
      borderUpColor: "#22C55E", borderDownColor: "#EF4444",
      wickUpColor: "#22C55E", wickDownColor: "#EF4444",
    });
    barRef.current = chart.addSeries(BarSeries, {
      upColor: "#22C55E", downColor: "#EF4444", visible: false,
    });
    areaRef.current = chart.addSeries(AreaSeries, {
      lineColor: "#3B82F6", topColor: "rgba(59,130,246,0.4)", bottomColor: "rgba(59,130,246,0.02)",
      lineWidth: 2, visible: false, priceLineVisible: false,
    });
    baselineRef.current = chart.addSeries(BaselineSeries, {
      topLineColor: "#22C55E", topFillColor1: "rgba(34,197,94,0.28)", topFillColor2: "rgba(34,197,94,0.02)",
      bottomLineColor: "#EF4444", bottomFillColor1: "rgba(239,68,68,0.02)", bottomFillColor2: "rgba(239,68,68,0.28)",
      visible: false, priceLineVisible: false,
    });

    // Volume overlay on the main pane (bottom 22%)
    volRef.current = chart.addSeries(HistogramSeries, {
      color: "#3B82F680", priceFormat: { type: "volume" }, priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

    // Overlays (hidden until toggled)
    sma20Ref.current = chart.addSeries(LineSeries, {
      color: "#F59E0B", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerVisible: false, visible: false, title: "SMA 20",
    });
    ema9Ref.current = chart.addSeries(LineSeries, {
      color: "#8B5CF6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerVisible: false, visible: false, title: "EMA 9",
    });
    vwapRef.current = chart.addSeries(LineSeries, {
      color: "#06B6D4", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerVisible: false, visible: false, title: "VWAP", lineStyle: LineStyle.Dashed,
    });

    // ── RSI pane (1) ──
    rsiRef.current = chart.addSeries(LineSeries, {
      color: "#EAB308", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: "RSI",
    }, 1);
    rsiRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    rsiRef.current.createPriceLine({ price: 70, color: "#EF444466", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    rsiRef.current.createPriceLine({ price: 30, color: "#22C55E66", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });
    rsiRef.current.createPriceLine({ price: 50, color: "#9CA3AF44", lineWidth: 1, lineStyle: LineStyle.Dotted });

    // ── MACD pane (2) ──
    macdHistRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "price", precision: 4, minMove: 0.0001 }, priceLineVisible: false }, 2);
    macdRef.current = chart.addSeries(LineSeries, { color: "#3B82F6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: "MACD" }, 2);
    macdSignalRef.current = chart.addSeries(LineSeries, { color: "#F59E0B", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: "Signal" }, 2);

    // Pane sizing: price gets the lion's share
    try {
      const panes = chart.panes();
      panes[0]?.setStretchFactor(4);
      panes[1]?.setStretchFactor(1);
      panes[2]?.setStretchFactor(1);
    } catch { /* older builds */ }

    // Markers attach to candle series
    markersRef.current = createSeriesMarkers(candleRef.current, []);

    // Watermark (symbol + timeframe)
    try {
      watermarkRef.current = createTextWatermark(chart.panes()[0], {
        horzAlign: "center", vertAlign: "center",
        lines: [{ text: "", color: "rgba(150,150,150,0.16)", fontSize: 44, fontStyle: "bold" }],
      });
    } catch { /* watermark optional */ }

    chartRef.current = chart;

    // Crosshair legend
    const onMove = (param) => {
      if (!param || !param.time || !param.point) { setLegend(null); return; }
      const main =
        param.seriesData.get(candleRef.current) ||
        param.seriesData.get(barRef.current) ||
        param.seriesData.get(areaRef.current) ||
        param.seriesData.get(baselineRef.current);
      if (!main) { setLegend(null); return; }
      const v = param.seriesData.get(volRef.current);
      const r = param.seriesData.get(rsiRef.current);
      const m = param.seriesData.get(macdRef.current);
      setLegend({
        o: main.open, h: main.high, l: main.low,
        c: main.close ?? main.value,
        vol: v?.value, rsi: r?.value, macd: m?.value,
      });
    };
    chart.subscribeCrosshairMove(onMove);

    const syncChartSize = () => {
      const el = containerRef.current;
      if (!el) return;
      chart.applyOptions({ width: el.clientWidth || 0, height: el.clientHeight || 0 });
    };
    syncChartSize();
    const ro = new ResizeObserver(syncChartSize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  return {
    chartRef, candleRef, barRef, areaRef, baselineRef, volRef,
    sma20Ref, ema9Ref, vwapRef, rsiRef, macdRef, macdSignalRef, macdHistRef,
    markersRef, watermarkRef, legend,
  };
}

// ── Crosshair legend overlay ──────────────────────────────────────────────────

function LegendOverlay({ sym, legend }) {
  if (!legend) return null;
  const up = legend.c != null && legend.o != null ? legend.c >= legend.o : true;
  const fmt = (n) => (n == null ? "—" : Number(n).toFixed(2));
  const fmtVol = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`);
  return (
    <div className="absolute top-2 left-2 z-20 bg-canvas/85 backdrop-blur-sm border border-line rounded-md px-2.5 py-1.5 text-2xs font-mono pointer-events-none">
      <span className="font-bold text-ink mr-2">{sym}</span>
      {legend.o != null && <span className="text-muted mr-1.5">O<span className={up ? "text-positive" : "text-negative"}>{fmt(legend.o)}</span></span>}
      {legend.h != null && <span className="text-muted mr-1.5">H<span className="text-ink">{fmt(legend.h)}</span></span>}
      {legend.l != null && <span className="text-muted mr-1.5">L<span className="text-ink">{fmt(legend.l)}</span></span>}
      <span className="text-muted mr-1.5">C<span className={up ? "text-positive" : "text-negative"}>{fmt(legend.c)}</span></span>
      {legend.vol != null && <span className="text-muted mr-1.5">V<span className="text-ink">{fmtVol(legend.vol)}</span></span>}
      {legend.rsi != null && <span className="text-muted mr-1.5">RSI<span className="text-ink">{Number(legend.rsi).toFixed(1)}</span></span>}
      {legend.macd != null && <span className="text-muted">MACD<span className="text-ink">{Number(legend.macd).toFixed(3)}</span></span>}
    </div>
  );
}

// ── Evidence panel ────────────────────────────────────────────────────────────

function EvidencePanel({ sym, full, indicators, loadingFull, rsiVal, macdVal }) {
  if (loadingFull) {
    return (
      <div className="p-3 space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 bg-surface animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }
  if (!full) return <div className="p-3 text-muted text-xs">No data</div>;

  const signal      = full.signal || full.blendedSignal || {};
  const bias        = signal.bias || signal.direction || signal.action || "NEUTRAL";
  const confidence  = confidencePct(signal.confidence ?? signal.score);
  const patterns    = Array.isArray(full.patterns) ? full.patterns : [];
  const levels      = full.levels || {};
  const supports    = levels.supports || levels.support || [];
  const resistances = levels.resistances || levels.resistance || [];
  const seasonality = full.seasonality || {};
  const monthBias   = seasonality.currentMonthBias || seasonality.bias || null;

  const ind     = indicators || {};
  const rsiDisp = rsiVal != null ? rsiVal.toFixed(1) : ind.rsi?.toFixed(1) ?? null;
  const macdDisp = macdVal || ind.macd || null;

  return (
    <div className="p-2.5 space-y-2 text-xs overflow-y-auto">
      {/* Signal */}
      <div className="bg-surface rounded-lg p-2.5 border border-line">
        <div className="text-2xs text-subtle uppercase tracking-wider mb-1.5">Signal</div>
        <div className={cn("flex items-center gap-1.5 font-semibold", signalColor(bias))}>
          {signalIcon(bias)}
          <span>{bias}</span>
          {confidence != null && (
            <span className="ml-auto text-muted text-2xs font-normal">{Number(confidence).toFixed(1)}%</span>
          )}
        </div>
      </div>

      {/* RSI + MACD */}
      {(rsiDisp || macdDisp) && (
        <div className="bg-surface rounded-lg p-2.5 border border-line">
          <div className="text-2xs text-subtle uppercase tracking-wider mb-1.5">Momentum</div>
          {rsiDisp && (
            <div className="flex justify-between text-2xs py-0.5">
              <span className="text-muted">RSI(14)</span>
              <span className={cn("font-mono font-medium",
                Number(rsiDisp) > 70 ? "text-negative" :
                Number(rsiDisp) < 30 ? "text-positive" : "text-ink"
              )}>{rsiDisp}
                {Number(rsiDisp) > 70 ? " OB" : Number(rsiDisp) < 30 ? " OS" : ""}
              </span>
            </div>
          )}
          {macdDisp && (
            <>
              <div className="flex justify-between text-2xs py-0.5">
                <span className="text-muted">MACD</span>
                <span className={cn("font-mono font-medium", macdDisp.macd >= 0 ? "text-positive" : "text-negative")}>
                  {macdDisp.macd}
                </span>
              </div>
              <div className="flex justify-between text-2xs py-0.5">
                <span className="text-muted">Histogram</span>
                <span className={cn("font-mono font-medium", macdDisp.histogram >= 0 ? "text-positive" : "text-negative")}>
                  {macdDisp.histogram}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Key levels */}
      {(resistances.length > 0 || supports.length > 0) && (
        <div className="bg-surface rounded-lg p-2.5 border border-line">
          <div className="text-2xs text-subtle uppercase tracking-wider mb-1.5">Key Levels</div>
          {resistances.slice(0, 2).map((r, i) => {
            const val = typeof r === "number" ? r : r?.level ?? r;
            return (
              <div key={i} className="flex justify-between py-0.5 text-2xs">
                <span className="text-muted">Resistance</span>
                <span className="text-negative font-mono">${Number(val).toFixed(2)}</span>
              </div>
            );
          })}
          {supports.slice(0, 2).map((s, i) => {
            const val = typeof s === "number" ? s : s?.level ?? s;
            return (
              <div key={i} className="flex justify-between py-0.5 text-2xs">
                <span className="text-muted">Support</span>
                <span className="text-positive font-mono">${Number(val).toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Patterns */}
      {patterns.length > 0 && (
        <div className="bg-surface rounded-lg p-2.5 border border-line">
          <div className="text-2xs text-subtle uppercase tracking-wider mb-1.5">Patterns</div>
          {patterns.slice(0, 4).map((p, i) => {
            const name = p.pattern || p.name || p.type || String(p);
            const bull = String(p.bias || p.direction || "").toUpperCase().includes("BULL");
            return (
              <div key={i} className="flex items-center gap-1.5 py-0.5">
                {bull ? <CheckCircle size={10} className="text-positive shrink-0" /> : <XCircle size={10} className="text-negative shrink-0" />}
                <span className="text-2xs text-ink truncate">{name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Seasonality */}
      {monthBias && (
        <div className="bg-surface rounded-lg p-2.5 border border-line">
          <div className="text-2xs text-subtle uppercase tracking-wider mb-1">Seasonality</div>
          <div className={cn("text-xs font-medium", signalColor(monthBias))}>{monthBias}</div>
          {seasonality.avgReturn != null && (
            <div className="text-2xs text-muted mt-0.5">
              Avg this month: {(Number(seasonality.avgReturn) * 100).toFixed(1)}%
            </div>
          )}
        </div>
      )}

      {/* Regime */}
      {full.regime && (
        <div className="bg-surface rounded-lg p-2.5 border border-line">
          <div className="text-2xs text-subtle uppercase tracking-wider mb-1">Regime</div>
          <div className="text-xs text-ink">{full.regime}</div>
        </div>
      )}

      <div className="text-2xs text-subtle px-1 flex items-center gap-1">
        <Gauge size={10} /> TradingView consensus → Consensus tab below
      </div>
    </div>
  );
}

// ── Bottom tabs ───────────────────────────────────────────────────────────────

function NewsTab({ sym }) {
  return (
    <div className="px-3 py-2">
      <div className="text-2xs text-subtle uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <Newspaper size={10} /> Top Stories · TradingView
      </div>
      <TVTopStories symbol={sym} />
    </div>
  );
}

function OptionsTab({ sym, quote }) {
  const [ideas, setIdeas]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState(null);

  useEffect(() => {
    if (!sym) return;
    const spot = quote?.price || 150;
    const vol  = quote?.impliedVol || 0.3;
    setLoading(true); setErr(null);
    fetch(`${ANALYSIS_URL}/api/analysis/options/ideas/${sym}?spot=${spot}&vol=${vol}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setIdeas(d ? (Array.isArray(d) ? d : d.ideas || []) : []))
      .catch(() => setErr("Options ideas unavailable"))
      .finally(() => setLoading(false));
  }, [sym, quote?.price]);

  if (loading) return <div className="p-3 text-muted text-xs animate-pulse">Generating ideas…</div>;
  if (err)     return <div className="p-3 text-muted text-xs">{err}</div>;
  if (!ideas.length) return <div className="p-3 text-muted text-xs">No high-quality options ideas for {sym}.</div>;

  return (
    <div className="divide-y divide-line/70">
      {ideas.map((idea, i) => (
        <div key={i} className="grid grid-cols-1 lg:grid-cols-[minmax(9rem,0.7fr)_minmax(14rem,1.5fr)_minmax(12rem,0.8fr)] gap-2 lg:gap-3 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink truncate">{idea.structure}</div>
            <div className={cn("text-2xs font-medium mt-0.5", signalColor(idea.direction))}>{idea.direction}</div>
          </div>

          <div className="min-w-0 text-2xs text-muted space-y-0.5">
            {idea.legs && <div className="truncate">Legs: <span className="text-ink">{idea.legs}</span></div>}
            {idea.rationale && <div className="text-ink line-clamp-1">Why: {idea.rationale}</div>}
            {idea.invalidation && <div className="text-negative line-clamp-1">Invalidated if: {idea.invalidation}</div>}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-2xs text-muted tabular">
            <div>DTE <span className="text-ink">{idea.dte}</span></div>
            <div>BE <span className="text-ink">${idea.breakeven}</span></div>
            <div>Risk <span className="text-negative">${idea.maxLoss}</span></div>
            <div>Reward <span className="text-positive">{idea.maxProfit?.startsWith?.("U") ? "Unlimited" : `$${idea.maxProfit}`}</span></div>
            <div className="col-span-2">Liquidity <span className="text-ink">{idea.liquidityScore}/10</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FinancialsTab({ sym }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sym) return;
    setLoading(true);
    fetch(`${LIVE_DATA_URL}/company/${sym}`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [sym]);

  const metrics = !data ? [] : [
    ["Market Cap",      data.marketCap        ? `$${(data.marketCap / 1e9).toFixed(1)}B`    : null],
    ["P/E Ratio",       data.peRatio          ? data.peRatio.toFixed(1)                     : null],
    ["EPS (TTM)",       data.eps              ? `$${data.eps.toFixed(2)}`                   : null],
    ["Revenue",         data.revenue          ? `$${(data.revenue / 1e9).toFixed(1)}B`      : null],
    ["Gross Margin",    data.grossMargin      ? `${(data.grossMargin * 100).toFixed(1)}%`   : null],
    ["Profit Margin",   data.profitMargin     ? `${(data.profitMargin * 100).toFixed(1)}%`  : null],
    ["Debt/Equity",     data.debtToEquity     ? data.debtToEquity.toFixed(2)                : null],
    ["Div Yield",       data.dividendYield    ? `${(data.dividendYield * 100).toFixed(2)}%` : null],
    ["52W High",        data.fiftyTwoWeekHigh ? `$${data.fiftyTwoWeekHigh.toFixed(2)}`      : null],
    ["52W Low",         data.fiftyTwoWeekLow  ? `$${data.fiftyTwoWeekLow.toFixed(2)}`       : null],
    ["Avg Vol (3M)",    data.avgVolume        ? `${(data.avgVolume / 1e6).toFixed(1)}M`     : null],
    ["Beta",            data.beta             ? data.beta.toFixed(2)                        : null],
  ].filter(([, v]) => v != null);

  return (
    <div className="px-3 py-2.5">
      {/* Our quick snapshot */}
      {loading && <div className="text-muted text-xs animate-pulse mb-2">Loading snapshot…</div>}
      {!loading && data?.name && <div className="text-xs font-semibold text-ink mb-2">{data.name}{data.sector ? ` · ${data.sector}` : ""}</div>}
      {metrics.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {metrics.map(([label, val]) => (
            <div key={label} className="bg-surface rounded p-1.5 border border-line">
              <div className="text-2xs text-muted">{label}</div>
              <div className="text-xs font-semibold text-ink">{val}</div>
            </div>
          ))}
        </div>
      )}
      {data?.description && (
        <p className="text-2xs text-muted mt-2 line-clamp-3">{data.description}</p>
      )}

      {/* TradingView full fundamentals — always available */}
      <div className="mt-3 pt-2 border-t border-line">
        <div className="text-2xs text-subtle uppercase tracking-wider mb-1.5 flex items-center gap-1">
          <DollarSign size={10} /> Fundamentals · TradingView
        </div>
        <TVFundamentals symbol={sym} />
      </div>
    </div>
  );
}

function BacktestTab({ sym }) {
  const [results, setResults]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [strategy, setStrategy] = useState("SMA_CROSSOVER");

  const run = useCallback(() => {
    if (!sym) return;
    setLoading(true);
    fetch(`${BACKTEST_URL}/api/backtest/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, strategy, capital: 10000, positionPct: 0.95, commission: 1.0, slippage: 5 }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(setResults)
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [sym, strategy]);

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <select
          value={strategy}
          onChange={e => setStrategy(e.target.value)}
          className="text-xs bg-surface border border-line rounded px-2 py-1 text-ink"
        >
          {["SMA_CROSSOVER","RSI_MEAN_REVERSION","MACD_CROSSOVER","BOLLINGER_BOUNCE","BUY_AND_HOLD"].map(s => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={loading}
          className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run"}
        </button>
      </div>
      {results && (
        <div className="grid grid-cols-3 gap-1.5">
          {[
            ["Return",     pctValue(results.totalPnlPct),                  Number(results.totalPnlPct) > 0],
            ["Sharpe",     results.sharpeRatio?.toFixed(2),               (results.sharpeRatio || 0) > 1],
            ["Win Rate",   pctValue(results.winRate, 0),                  (results.winRate || 0) > 50],
            ["Max DD",     pctValue(results.maxDrawdownPct),              (results.maxDrawdownPct || 0) < 15],
            ["Trades",     results.totalTrades,                            null],
            ["P. Factor",  results.profitFactor?.toFixed(2),             (results.profitFactor || 0) > 1.5],
          ].map(([label, val, good]) => (
            <div key={label} className="bg-surface rounded p-1.5 border border-line">
              <div className="text-2xs text-muted">{label}</div>
              <div className={cn("text-xs font-semibold", good == null ? "text-ink" : good ? "text-positive" : "text-negative")}>
                {val ?? "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact evidence summary — a few hundred bytes instead of the full ~30KB
// research-brief JSON, so CPU-bound local models can respond within timeout.
function memoContext(sym, full) {
  if (!full) return `Ticker: ${sym}. No analysis available.`;
  const s = full.signal || full.blendedSignal || {};
  const bias = s.bias || s.direction || s.action || "NEUTRAL";
  const conf = s.confidence ?? s.score;
  const levels = full.levels || {};
  const num = x => (typeof x === "number" ? x : x?.level);
  const sup = (levels.supports || levels.support || []).map(num).filter(Boolean).slice(0, 3);
  const res = (levels.resistances || levels.resistance || []).map(num).filter(Boolean).slice(0, 3);
  const pats = (full.patterns || []).map(p => p.pattern || p.name || p.type).filter(Boolean).slice(0, 4);
  const seas = full.seasonality?.currentMonthBias || full.seasonality?.bias;
  const wk = full.weeklySignal?.bias || full.weeklySignal?.action;
  return [
    `Ticker: ${sym}`,
    `Signal: ${bias}${conf != null ? ` (confidence ${conf})` : ""}`,
    full.regime ? `Regime: ${full.regime}` : null,
    wk ? `Weekly bias: ${wk}` : null,
    res.length ? `Resistance: ${res.map(n => `$${Number(n).toFixed(2)}`).join(", ")}` : null,
    sup.length ? `Support: ${sup.map(n => `$${Number(n).toFixed(2)}`).join(", ")}` : null,
    pats.length ? `Patterns: ${pats.join(", ")}` : null,
    seas ? `Seasonality: ${seas}` : null,
    full.verdict ? `Verdict: ${full.verdict}` : null,
  ].filter(Boolean).join("; ");
}

function AIMemoTab({ sym, full }) {
  const [memo, setMemo]       = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(() => {
    if (!sym) return;
    setLoading(true);
    fetch(`${AI_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        watchSymbols: [sym],
        includeForecast: false,
        messages: [{
          role: "user",
          content: `Write a concise 3-4 sentence stock research memo for ${sym} based on this evidence. ${memoContext(sym, full)}`,
        }],
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setMemo(d?.reply || d?.memo || d?.response || (typeof d === "string" ? d : null)))
      .catch(() => setMemo(null))
      .finally(() => setLoading(false));
  }, [sym, full]);

  return (
    <div className="px-3 py-2.5 space-y-3">
      <ForecastWidget symbol={sym} />

      <div className="bg-surface rounded-lg border border-line p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">AI Research Memo</div>
            <div className="text-2xs text-muted mt-0.5">Uses the current chart evidence, C++ signals, patterns, levels, and regime.</div>
          </div>
          {!memo && !loading && (
            <button onClick={generate} className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/90">
              Generate
            </button>
          )}
        </div>
        {loading && <div className="text-muted text-xs animate-pulse">Generating...</div>}
        {memo && <p className="text-xs text-ink leading-relaxed">{memo}</p>}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const CHART_TYPES = [
  { id: "candles",  icon: CandlestickChart, title: "Candlesticks" },
  { id: "bars",     icon: BarChart2,        title: "OHLC bars"    },
  { id: "area",     icon: LineChart,        title: "Area"         },
  { id: "baseline", icon: Activity,         title: "Baseline"     },
];

export function Markets() {
  const containerRef  = useRef(null);
  const priceLineRefs = useRef([]);  // support/resistance
  const targetLineRefs = useRef([]); // entry/stop/target
  const candleDataRef = useRef([]);  // latest OHLC for series swaps
  const rangeStore    = useRef({});  // saved visible ranges per sym|period

  const [sym,          setSym]         = useState(loadSelectedSymbol);
  const [searchVal,    setSearchVal]   = useState("");
  const [periodIdx,    setPeriodIdx]   = useState(5);  // 1Y default
  const [indicators,   setIndicators]  = useState({ sma20: false, ema9: false, vwap: false });
  const [chartType,    setChartType]   = useState("candles");
  const [chartMode,    setChartMode]   = useState("lite"); // lite | pro
  const [logScale,     setLogScale]    = useState(false);
  const [showTargets,  setShowTargets] = useState(false);
  const [showMarkers,  setShowMarkers] = useState(true);
  const [watchlist,    setWatchlist]   = useState(() => {
    const selected = loadSelectedSymbol();
    const saved = loadWatchlist();
    return saved.includes(selected) ? saved : [selected, ...saved];
  });
  const [addVal,       setAddVal]      = useState("");
  const [quotes,       setQuotes]      = useState({});
  const [full,         setFull]        = useState(null);
  const [indData,      setIndData]     = useState(null);
  const [loadingFull,  setLoadingFull] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [activeTab,    setActiveTab]   = useState("news");
  const [rsiVal,       setRsiVal]      = useState(null);
  const [macdVal,      setMacdVal]     = useState(null);

  const {
    chartRef, candleRef, barRef, areaRef, baselineRef, volRef,
    sma20Ref, ema9Ref, vwapRef, rsiRef, macdRef, macdSignalRef, macdHistRef,
    markersRef, watermarkRef, legend,
  } = useChart(containerRef);

  const rangeKey = `${sym}|${periodIdx}`;

  // ── Save visible range on user pan/zoom ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onRange = (range) => { if (range) rangeStore.current[rangeKey] = range; };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
  }, [rangeKey]);

  // ── Candle fetch + overlays + panes + markers ──
  useEffect(() => {
    if (!sym) return;
    const { period, interval } = PERIODS[periodIdx];
    setLoadingChart(true);
    fetch(`${LIVE_DATA_URL}/history/${sym}?period=${period}&interval=${interval}`)
      .then(r => r.ok ? r.json() : [])
      .then(raw => {
        const arr = Array.isArray(raw) ? raw : raw.bars || raw.candles || raw.history || [];
        const candleData = arr.map(c => ({
          time:   c.time  || Math.floor(new Date(c.timestamp || c.date).getTime() / 1000),
          open:   Number(c.open),
          high:   Number(c.high),
          low:    Number(c.low),
          close:  Number(c.close),
          volume: Number(c.volume || 0),
        }));
        candleDataRef.current = candleData;

        const lineData = candleData.map(c => ({ time: c.time, value: c.close }));
        const volData = candleData.map(c => ({
          time:  c.time,
          value: c.volume,
          color: c.close >= c.open ? "#22C55E40" : "#EF444440",
        }));

        candleRef.current?.setData(candleData);
        barRef.current?.setData(candleData);
        areaRef.current?.setData(lineData);
        baselineRef.current?.setData(lineData);
        volRef.current?.setData(volData);

        // Baseline pivots on the first close in view
        if (candleData.length) {
          baselineRef.current?.applyOptions({ baseValue: { type: "price", price: candleData[0].close } });
        }

        // Overlays
        const sma20 = candleData.length >= 20 ? sma(candleData, 20) : [];
        const ema9  = candleData.length >= 9  ? ema(candleData, 9)  : [];
        sma20Ref.current?.setData(sma20);
        ema9Ref.current?.setData(ema9);
        if (candleData.length >= 2) vwapRef.current?.setData(vwap(candleData));

        // RSI + MACD panes
        const rsiArr = rsiSeries(candleData);
        rsiRef.current?.setData(rsiArr);
        const { macd, signal, hist } = macdSeries(candleData);
        macdRef.current?.setData(macd);
        macdSignalRef.current?.setData(signal);
        macdHistRef.current?.setData(hist);

        // Crossover markers (EMA9 × SMA20)
        const markers = (ema9.length && sma20.length) ? crossMarkers(ema9, sma20) : [];
        markersRef.current?.setMarkers(showMarkers ? markers : []);

        // Evidence badges
        setRsiVal(lastVal(rsiArr));
        setMacdVal(macd.length && signal.length ? {
          macd: macd[macd.length - 1].value,
          histogram: hist.length ? hist[hist.length - 1].value : null,
        } : null);

        // Restore saved range, else fit
        const saved = rangeStore.current[`${sym}|${periodIdx}`];
        if (saved) chartRef.current?.timeScale().setVisibleLogicalRange(saved);
        else chartRef.current?.timeScale().fitContent();
      })
      .catch(() => {})
      .finally(() => setLoadingChart(false));
  }, [sym, periodIdx]);

  // ── Marker visibility ──
  useEffect(() => {
    if (!markersRef.current) return;
    const data = candleDataRef.current;
    if (!showMarkers || data.length < 20) { markersRef.current.setMarkers([]); return; }
    markersRef.current.setMarkers(crossMarkers(ema(data, 9), sma(data, 20)));
  }, [showMarkers]);

  // ── Chart-type visibility ──
  useEffect(() => {
    candleRef.current?.applyOptions({ visible: chartType === "candles" });
    barRef.current?.applyOptions({ visible: chartType === "bars" });
    areaRef.current?.applyOptions({ visible: chartType === "area" });
    baselineRef.current?.applyOptions({ visible: chartType === "baseline" });
  }, [chartType]);

  // ── Log / linear price scale ──
  useEffect(() => {
    candleRef.current?.priceScale().applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  // ── Watermark text ──
  useEffect(() => {
    watermarkRef.current?.applyOptions?.({
      lines: [
        { text: sym, color: "rgba(150,150,150,0.16)", fontSize: 46, fontStyle: "bold" },
        { text: PERIODS[periodIdx].label, color: "rgba(150,150,150,0.12)", fontSize: 18 },
      ],
    });
  }, [sym, periodIdx, chartMode]);

  // ── Support / resistance price lines ──
  useEffect(() => {
    if (!candleRef.current) return;
    priceLineRefs.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    priceLineRefs.current = [];
    if (!full) return;
    const levels = full.levels || {};
    const supports    = (levels.supports || levels.support || []).slice(0, 3);
    const resistances = (levels.resistances || levels.resistance || []).slice(0, 3);
    supports.forEach(s => {
      const price = typeof s === "number" ? s : s?.level ?? null;
      if (price == null) return;
      priceLineRefs.current.push(candleRef.current.createPriceLine({
        price, color: "#22C55E", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "S",
      }));
    });
    resistances.forEach(r => {
      const price = typeof r === "number" ? r : r?.level ?? null;
      if (price == null) return;
      priceLineRefs.current.push(candleRef.current.createPriceLine({
        price, color: "#EF4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "R",
      }));
    });
  }, [full]);

  // ── Entry / Stop / Target lines (trade plan) ──
  useEffect(() => {
    if (!candleRef.current) return;
    targetLineRefs.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    targetLineRefs.current = [];
    const price = Number(quotes[sym]?.price || 0);
    if (!showTargets || !full || !price) return;

    const levels = full.levels || {};
    const supports    = (levels.supports || levels.support || []).map(s => (typeof s === "number" ? s : s?.level)).filter(Boolean);
    const resistances = (levels.resistances || levels.resistance || []).map(r => (typeof r === "number" ? r : r?.level)).filter(Boolean);
    const stop   = supports.filter(s => s < price).sort((a, b) => b - a)[0] ?? +(price * 0.95).toFixed(2);
    const target = resistances.filter(r => r > price).sort((a, b) => a - b)[0] ?? +(price * 1.08).toFixed(2);

    const add = (p, color, title) => targetLineRefs.current.push(
      candleRef.current.createPriceLine({ price: p, color, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title })
    );
    add(price,  "#3B82F6", "Entry");
    add(stop,   "#EF4444", "Stop");
    add(target, "#22C55E", "Target");
  }, [showTargets, full, sym, quotes]);

  // ── Indicator overlay toggles ──
  useEffect(() => { sma20Ref.current?.applyOptions({ visible: indicators.sma20 }); }, [indicators.sma20]);
  useEffect(() => { ema9Ref.current?.applyOptions({ visible: indicators.ema9 });   }, [indicators.ema9]);
  useEffect(() => { vwapRef.current?.applyOptions({ visible: indicators.vwap });   }, [indicators.vwap]);

  // ── Full analysis + indicators ──
  useEffect(() => {
    if (!sym) return;
    setLoadingFull(true); setFull(null); setIndData(null);
    Promise.allSettled([
      fetch(`${ANALYSIS_URL}/api/analysis/research-brief/${sym}`).then(r => r.ok ? r.json() : null),
      fetch(`${ANALYSIS_URL}/api/analysis/${sym}/indicators`).then(r => r.ok ? r.json() : null),
    ]).then(([fullRes, indRes]) => {
      setFull(fullRes.status === "fulfilled" ? fullRes.value : null);
      setIndData(indRes.status === "fulfilled" ? indRes.value : null);
    }).finally(() => setLoadingFull(false));
  }, [sym]);

  // ── Watchlist quotes ──
  useEffect(() => {
    const fetchAll = () => {
      watchlist.forEach(t => {
        fetch(`${LIVE_DATA_URL}/quote/${t}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => d && setQuotes(prev => ({ ...prev, [t]: d })))
          .catch(() => {});
      });
    };
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [watchlist]);

  const quote = quotes[sym] || null;

  // ── Watchlist: Postgres is the source of truth, localStorage is the offline fallback ──
  const watchlistHydrated = useRef(false);
  useEffect(() => {
    fetch(`${ANALYSIS_URL}/api/analysis/watchlist`)
      .then(r => (r.ok ? r.json() : null))
      .then(list => { if (Array.isArray(list) && list.length) setWatchlist(list); })
      .catch(() => { /* backend unreachable → keep localStorage list */ })
      .finally(() => { watchlistHydrated.current = true; });
  }, []);

  // Persist edits: localStorage always (instant/offline), PUT to Postgres once hydrated
  useEffect(() => {
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); } catch { /* ignore */ }
    if (!watchlistHydrated.current) return;
    fetch(`${ANALYSIS_URL}/api/analysis/watchlist`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: watchlist }),
    }).catch(() => { /* offline → localStorage already holds the edit */ });
  }, [watchlist]);

  useEffect(() => {
    try { if (sym) localStorage.setItem(SELECTED_SYMBOL_KEY, sym); } catch { /* ignore */ }
  }, [sym]);

  const addTicker = useCallback((raw, { select = false } = {}) => {
    const v = String(raw || "").trim().toUpperCase();
    if (!v || !/^[A-Z0-9.\-]{1,8}$/.test(v)) return;
    setWatchlist(w => (w.includes(v) ? w : [...w, v]));
    if (select) setSym(v);
  }, []);

  const removeTicker = useCallback((t) => {
    setWatchlist(w => {
      const next = w.filter(x => x !== t);
      if (t === sym) setSym(next[0] || "");
      return next;
    });
  }, [sym]);

  function handleSearch(e) {
    e.preventDefault();
    addTicker(searchVal, { select: true });
    setSearchVal("");
  }

  function handleAdd(e) {
    e.preventDefault();
    addTicker(addVal);
    setAddVal("");
  }

  const tabs = [
    { id: "news",       icon: Newspaper,   label: "News"       },
    { id: "consensus",  icon: Gauge,       label: "Consensus"  },
    { id: "options",    icon: Layers,      label: "Options"    },
    { id: "financials", icon: DollarSign,  label: "Financials" },
    { id: "backtest",   icon: BarChart2,   label: "Backtest"   },
    { id: "ai",         icon: Brain,       label: "AI Memo"    },
  ];

  return (
    <div className="flex flex-col gap-0 -mx-4 sm:-mx-6 lg:-mx-9 -mt-6 lg:-mt-8" style={{ height: "calc(100vh - 5rem)" }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-canvas shrink-0 flex-wrap">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={searchVal}
              onChange={e => setSearchVal(e.target.value.toUpperCase())}
              placeholder="Ticker…"
              className="pl-6 pr-2 py-1 text-xs bg-surface border border-line rounded text-ink w-24 focus:outline-none focus:border-accent/50"
            />
          </div>
        </form>

        <span className="text-xs font-mono font-bold text-ink">{sym}</span>

        {quote && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-ink">${Number(quote.price).toFixed(2)}</span>
            {quote.change != null && (
              <span className={Number(quote.change) >= 0 ? "text-positive" : "text-negative"}>
                {Number(quote.change) >= 0 ? "+" : ""}{Number(quote.change).toFixed(2)} ({changePct(quote).toFixed(2)}%)
              </span>
            )}
          </div>
        )}

        <div className="h-4 w-px bg-line" />

        {PERIODS.map((p, i) => (
          <Pill key={p.label} active={periodIdx === i} onClick={() => setPeriodIdx(i)}>{p.label}</Pill>
        ))}

        <div className="h-4 w-px bg-line" />

        {/* Chart type */}
        <div className="flex items-center gap-1">
          {CHART_TYPES.map(t => (
            <IconToggle key={t.id} active={chartType === t.id} onClick={() => setChartType(t.id)} title={t.title}>
              <t.icon size={13} />
            </IconToggle>
          ))}
        </div>

        <div className="h-4 w-px bg-line" />

        <Pill active={indicators.sma20} onClick={() => setIndicators(s => ({ ...s, sma20: !s.sma20 }))}>SMA 20</Pill>
        <Pill active={indicators.ema9}  onClick={() => setIndicators(s => ({ ...s, ema9:  !s.ema9  }))}>EMA 9</Pill>
        <Pill active={indicators.vwap}  onClick={() => setIndicators(s => ({ ...s, vwap:  !s.vwap  }))}>VWAP</Pill>

        <div className="h-4 w-px bg-line" />

        <Pill active={logScale} onClick={() => setLogScale(v => !v)} title="Logarithmic price scale">Log</Pill>
        <Pill active={showMarkers} onClick={() => setShowMarkers(v => !v)} title="Buy/Sell crossover markers">Signals</Pill>
        <Pill active={showTargets} onClick={() => setShowTargets(v => !v)} title="Entry / Stop / Target lines">
          <span className="inline-flex items-center gap-1"><TargetIcon size={11} /> Plan</span>
        </Pill>

        {rsiVal != null && (
          <span className={cn(
            "text-xs font-mono px-2 py-0.5 rounded bg-surface border border-line",
            rsiVal > 70 ? "text-negative" : rsiVal < 30 ? "text-positive" : "text-muted"
          )}>
            RSI {rsiVal.toFixed(1)}
          </span>
        )}

        {/* Lite / Pro */}
        <div className="ml-auto flex items-center gap-1">
          {loadingChart && <RefreshCw size={12} className="text-muted animate-spin mr-1" />}
          <div className="flex items-center rounded-md border border-line overflow-hidden">
            <button
              onClick={() => setChartMode("lite")}
              className={cn("px-2 py-1 text-xs font-medium", chartMode === "lite" ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink")}
            >Lite</button>
            <button
              onClick={() => setChartMode("pro")}
              className={cn("px-2 py-1 text-xs font-medium", chartMode === "pro" ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink")}
              title="Full TradingView chart with drawing tools & 100+ indicators"
            >Pro</button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* Watchlist */}
        <div className="w-40 shrink-0 border-r border-line bg-canvas overflow-y-auto flex flex-col">
          <div className="px-2 py-1.5 text-2xs font-medium text-subtle uppercase tracking-wider border-b border-line flex items-center justify-between">
            <span>Watchlist</span>
            <span className="text-subtle normal-case font-normal">{watchlist.length}</span>
          </div>

          {/* Add ticker */}
          <form onSubmit={handleAdd} className="flex items-center gap-1 px-2 py-1.5 border-b border-line">
            <div className="relative flex-1">
              <Plus size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={addVal}
                onChange={e => setAddVal(e.target.value.toUpperCase())}
                placeholder="Add symbol"
                maxLength={8}
                className="w-full pl-5 pr-1.5 py-1 text-2xs bg-surface border border-line rounded text-ink placeholder:text-subtle focus:outline-none focus:border-accent/50"
              />
            </div>
            <button
              type="submit"
              disabled={!addVal.trim()}
              className="px-1.5 py-1 text-2xs font-medium rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
              title="Add to watchlist"
            >Add</button>
          </form>

          {watchlist.map(ticker => {
            const q   = quotes[ticker];
            const pos = (q?.change ?? changePct(q)) >= 0;
            return (
              <div
                key={ticker}
                className={cn(
                  "group relative border-b border-line/40 hover:bg-surface/60 transition-colors",
                  sym === ticker && "bg-surface border-l-2 border-l-accent",
                )}
              >
                <button onClick={() => setSym(ticker)} className="w-full px-2 py-1.5 text-left">
                  <div className="flex justify-between items-baseline gap-1 pr-4">
                    <span className={cn("text-xs font-bold", sym === ticker ? "text-ink" : "text-muted")}>{ticker}</span>
                    {(q?.change_pct ?? q?.changePercent) != null && (
                      <span className={cn("text-2xs font-mono", pos ? "text-positive" : "text-negative")}>
                        {pos ? "+" : ""}{changePct(q).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {q?.price != null && (
                    <div className="text-2xs text-muted font-mono">${Number(q.price).toFixed(2)}</div>
                  )}
                </button>
                <button
                  onClick={() => removeTicker(ticker)}
                  className="absolute right-1 top-1 p-0.5 rounded text-subtle opacity-0 group-hover:opacity-100 hover:text-negative hover:bg-negative/10 transition-opacity"
                  title={`Remove ${ticker}`}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}

          {watchlist.length === 0 && (
            <div className="px-2 py-4 text-2xs text-subtle text-center">
              Watchlist empty. Add a symbol above.
            </div>
          )}
        </div>

        {/* Chart + evidence */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex flex-1 min-h-0">

            {/* Chart area */}
            <div className="flex-1 relative min-w-0 overflow-hidden">
              <div ref={containerRef} className={cn("absolute inset-0", chartMode === "pro" && "invisible")} />
              {chartMode === "lite" && <LegendOverlay sym={sym} legend={legend} />}
              {chartMode === "pro" && (
                <div className="absolute inset-0"><ProChart symbol={sym} /></div>
              )}
              {loadingChart && chartMode === "lite" && (
                <div className="absolute inset-0 flex items-center justify-center bg-canvas/70 backdrop-blur-sm z-10">
                  <RefreshCw size={20} className="text-muted animate-spin" />
                </div>
              )}
            </div>

            {/* Evidence panel */}
            <div className="w-52 shrink-0 border-l border-line bg-canvas overflow-y-auto">
              <div className="px-2 py-1.5 text-2xs font-medium text-subtle uppercase tracking-wider border-b border-line flex items-center gap-1">
                <Activity size={10} /> Evidence · {sym}
              </div>
              <EvidencePanel
                sym={sym}
                full={full}
                indicators={indData}
                loadingFull={loadingFull}
                rsiVal={rsiVal}
                macdVal={macdVal}
              />
            </div>
          </div>

          {/* Bottom tabs */}
          <div
            className="relative z-10 border-t border-line bg-canvas shrink-0 flex flex-col"
            style={{ height: "clamp(220px, 30vh, 300px)" }}
          >
            <div className="flex border-b border-line shrink-0 overflow-x-auto">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    "flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors border-b-2 shrink-0",
                    activeTab === t.id ? "text-ink border-accent" : "text-muted border-transparent hover:text-ink",
                  )}
                >
                  <t.icon size={11} />{t.label}
                </button>
              ))}
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 bg-canvas">
              {activeTab === "news"       && <NewsTab sym={sym} />}
              {activeTab === "consensus"  && <ConsensusTab sym={sym} />}
              {activeTab === "options"    && <OptionsTab sym={sym} quote={quote} />}
              {activeTab === "financials" && <FinancialsTab sym={sym} />}
              {activeTab === "backtest"   && <BacktestTab sym={sym} />}
              {activeTab === "ai"         && <AIMemoTab sym={sym} full={full} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
