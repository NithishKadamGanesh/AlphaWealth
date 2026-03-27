import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  Customized,
} from 'recharts';
import { getAnalysisFull, getAnalysisHistory, getCandles, getMarketDataStatus, ingestCandles } from '../lib/platform';

const TABS = [
  { id: 'signal', label: 'Signal' },
  { id: 'structure', label: 'Structure' },
  { id: 'model', label: 'Model' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'levels', label: 'Levels' },
  { id: 'seasonality', label: 'Seasonality' },
];

const WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'META', 'AMZN', 'GOOGL', 'TSLA', 'JPM'];

export default function AnalysisPage({ activeSymbol, liveQuote, quotes, onSymbolChange }) {
  const [tab, setTab] = React.useState('signal');
  const [candles, setCandles] = React.useState([]);
  const [analysis, setAnalysis] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [ingesting, setIngesting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const fallbackAnchorsRef = React.useRef({});

  React.useEffect(() => {
    if (!fallbackAnchorsRef.current[activeSymbol]) {
      const anchor = Number(liveQuote?.last || quotes?.[activeSymbol]?.last || 100);
      fallbackAnchorsRef.current[activeSymbol] = anchor;
    }
  }, [activeSymbol, liveQuote?.last, quotes]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const [candleResult, analysisResult, statusResult, historyResult] = await Promise.allSettled([
      getCandles(activeSymbol),
      getAnalysisFull(activeSymbol),
      getMarketDataStatus(activeSymbol),
      getAnalysisHistory(activeSymbol),
    ]);

    const candleData = candleResult.status === 'fulfilled' ? candleResult.value : [];
    const analysisData = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
    const statusData = statusResult.status === 'fulfilled' ? statusResult.value : null;
    const historyData = historyResult.status === 'fulfilled' ? historyResult.value : [];

    if (candleData?.length) {
      setCandles(candleData);
    } else {
      setCandles(buildFallbackCandles(activeSymbol, fallbackAnchorsRef.current[activeSymbol] || 100));
    }

    setAnalysis(analysisData);
    setStatus(statusData);
    setHistory(Array.isArray(historyData) ? historyData : []);

    if (!analysisData || !candleData?.length) {
      setError('Backend analysis services are unavailable. Showing local fallback market view.');
    }

    setLoading(false);
  }, [activeSymbol]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleIngest = async () => {
    setIngesting(true);
    try {
      await ingestCandles(activeSymbol, 'compact');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setIngesting(false);
    }
  };

  const chartData = React.useMemo(() => {
    const source = candles.slice(-120).map((candle, index) => ({
      idx: index,
      date: candle.date,
      close: Number(candle.close),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
    }));
    if (!source.length) return [];
    const ema = exponentialMovingAverage(source.map((point) => point.close), 21);
    const trendLines = analysis?.trendLines || analysis?.modelSuggestion?.trendLines || [];

    return source.map((point, index) => {
      return {
        ...point,
        ema21: ema[index],
        trendLower: valueForTrendLine(trendLines, 'SUPPORT', index),
        trendMid: valueForTrendLine(trendLines, 'MID', index),
        trendUpper: valueForTrendLine(trendLines, 'RESISTANCE', index),
      };
    });
  }, [candles, analysis]);

  const signal = analysis?.signal;
  const modelSuggestion = analysis?.modelSuggestion;
  const blendedSuggestion = analysis?.blendedSuggestion;
  const structure = analysis?.structure || modelSuggestion?.structure;
  const projection = analysis?.projection || modelSuggestion?.projection;
  const levels = analysis?.levels || [];
  const supportLevels = levels.filter((level) => level.type === 'SUPPORT').map((level) => Number(level.price)).sort((a, b) => b - a).slice(0, 2);
  const resistanceLevels = levels.filter((level) => level.type === 'RESISTANCE').map((level) => Number(level.price)).sort((a, b) => a - b).slice(0, 2);
  const currentPrice = chartData.length ? chartData[chartData.length - 1].close : null;
  const trendBias = structure?.trendState?.replaceAll('_', ' ') || 'Waiting';
  const closestSupport = projection?.buyZone?.low ?? supportLevels.find((level) => currentPrice != null && level <= currentPrice) ?? supportLevels[0] ?? null;
  const closestResistance = projection?.sellZone?.high ?? resistanceLevels.find((level) => currentPrice != null && level >= currentPrice) ?? resistanceLevels[0] ?? null;

  const signalMarkers = React.useMemo(() => {
    const latestByDate = new Map();
    history.forEach((item) => {
      if (!item.createdAt) return;
      const key = String(item.createdAt).slice(0, 10);
      if (!latestByDate.has(key)) latestByDate.set(key, item);
    });
    return chartData
      .map((candle) => {
        const snapshot = latestByDate.get(candle.date);
        return snapshot ? { date: candle.date, close: candle.close, action: snapshot.blendedAction } : null;
      })
      .filter(Boolean);
  }, [history, chartData]);

  const buyRegion = projection?.buyZone ? { y1: projection.buyZone.low, y2: projection.buyZone.high } : null;
  const sellRegion = projection?.sellZone ? { y1: projection.sellZone.low, y2: projection.sellZone.high } : null;
  const targetRegion = projection?.targetZone ? { y1: projection.targetZone.low, y2: projection.targetZone.high } : null;
  const stretchRegion = projection?.stretchZone ? { y1: projection.stretchZone.low, y2: projection.stretchZone.high } : null;
  const invalidationLevel = projection?.invalidationLevel ?? null;
  const swingHighMarkers = structure?.swingHighs || [];
  const swingLowMarkers = structure?.swingLows || [];

  return (
    <main className="page-grid page-grid-analysis-dark">
      <section className="analysis-hero page-span-2">
        <div>
          <div className="analysis-kicker">Technical Analysis Studio</div>
          <div className="analysis-title">{activeSymbol} trend structure, signal zones, and model-backed trade context</div>
        </div>
        <div className="analysis-actions">
          <button className="analysis-button analysis-button-muted" onClick={load} disabled={loading}>Refresh</button>
          <button className="analysis-button analysis-button-primary" onClick={handleIngest} disabled={ingesting}>
            {ingesting ? 'Syncing...' : 'Sync candles'}
          </button>
        </div>
      </section>

      <section className="analysis-chart-panel page-span-2">
        <div className="analysis-chart-main">
          <div className="analysis-chart-topbar">
            <div>
              <div className="analysis-symbol-row">
                <span className="analysis-symbol">{activeSymbol}</span>
                <span className="analysis-symbol-sub">Daily structure</span>
              </div>
              <div className="analysis-price-row">
                <span className="analysis-last">{liveQuote?.last ? `$${liveQuote.last.toFixed(2)}` : 'No live quote'}</span>
                <span className={Number(liveQuote?.change || 0) >= 0 ? 'analysis-up' : 'analysis-down'}>
                  {liveQuote?.last ? `${Number(liveQuote?.change || 0) >= 0 ? '+' : ''}${Number(liveQuote?.change || 0).toFixed(2)}` : ''}
                </span>
              </div>
              <div className="analysis-structure-row">
                <span className="analysis-structure-pill">{trendBias}</span>
                <span className="analysis-structure-pill">Nearest support {closestSupport != null ? closestSupport.toFixed(2) : 'N/A'}</span>
                <span className="analysis-structure-pill">Nearest resistance {closestResistance != null ? closestResistance.toFixed(2) : 'N/A'}</span>
                <span className="analysis-structure-pill">Destination {projection?.targetZone ? `${projection.targetZone.low.toFixed(2)} - ${projection.targetZone.high.toFixed(2)}` : 'N/A'}</span>
              </div>
            </div>

            <div className="analysis-badges">
              <span className="analysis-badge buy-zone">Buy zone</span>
              <span className="analysis-badge sell-zone">Sell zone</span>
              <span className="analysis-badge trend-line">Trend channel</span>
              <span className="analysis-badge ema-line">EMA 21</span>
              <span className="analysis-badge level-line">S/R levels</span>
              <span className="analysis-badge price-line">Current price</span>
              <span className="analysis-badge target-line">Target zone</span>
              <span className="analysis-badge invalidation-line">Invalidation</span>
            </div>
          </div>

          <div className="analysis-chart-canvas">
            {loading ? (
              <div className="analysis-empty">Loading chart...</div>
            ) : chartData.length > 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 18, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="analysisFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6E8BFF" stopOpacity={0.20} />
                      <stop offset="100%" stopColor="#6E8BFF" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#78849B', fontSize: 11, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tick={{ fill: '#78849B', fontSize: 11, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={false} width={72} domain={['dataMin - 10', 'dataMax + 10']} />
                  <Tooltip
                    contentStyle={{
                      background: '#151A25',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '16px',
                      color: '#F2F5FA',
                      fontFamily: 'IBM Plex Mono',
                    }}
                    formatter={(value) => [`${Number(value).toFixed(2)}`, '']}
                  />

                  {buyRegion && (
                    <ReferenceArea
                      y1={buyRegion.y1}
                      y2={buyRegion.y2}
                      fill="#3FBF7F"
                      fillOpacity={0.12}
                      strokeOpacity={0}
                    />
                  )}

                  {sellRegion && (
                    <ReferenceArea
                      y1={sellRegion.y1}
                      y2={sellRegion.y2}
                      fill="#FF5C7A"
                      fillOpacity={0.12}
                      strokeOpacity={0}
                    />
                  )}

                  {targetRegion && (
                    <ReferenceArea
                      y1={targetRegion.y1}
                      y2={targetRegion.y2}
                      fill="#5E86FF"
                      fillOpacity={0.10}
                      strokeOpacity={0}
                    />
                  )}

                  {stretchRegion && (
                    <ReferenceArea
                      y1={stretchRegion.y1}
                      y2={stretchRegion.y2}
                      fill="#A66BFF"
                      fillOpacity={0.06}
                      strokeOpacity={0}
                    />
                  )}

                  <Line type="monotone" dataKey="trendUpper" stroke="#FF4F6D" strokeWidth={3} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="trendMid" stroke="#95A7C5" strokeWidth={1.3} strokeDasharray="5 6" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="trendLower" stroke="#5BCF92" strokeWidth={3} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="ema21" stroke="#4B6BFF" strokeWidth={4} dot={false} isAnimationActive={false} />
                  {currentPrice != null && (
                    <ReferenceLine y={currentPrice} stroke="#AFC0D9" strokeWidth={1.2} strokeDasharray="4 4" />
                  )}
                  {invalidationLevel != null && (
                    <ReferenceLine y={invalidationLevel} stroke="#F08A46" strokeWidth={1.8} strokeDasharray="8 5" label={{ value: 'Invalidation', position: 'right', fill: '#F08A46', fontSize: 11 }} />
                  )}
                  {supportLevels.map((level, index) => (
                    <ReferenceLine key={`support-${index}`} y={level} stroke="#F4C152" strokeWidth={2.2} strokeDasharray="0" />
                  ))}
                  {resistanceLevels.map((level, index) => (
                    <ReferenceLine key={`resistance-${index}`} y={level} stroke="#FF4F6D" strokeWidth={2.2} strokeDasharray="0" />
                  ))}
                  {targetRegion && (
                    <ReferenceLine y={targetRegion.y2} stroke="#5E86FF" strokeWidth={1.4} strokeDasharray="4 4" label={{ value: 'Target 1', position: 'right', fill: '#7E9BFF', fontSize: 11 }} />
                  )}
                  {stretchRegion && (
                    <ReferenceLine y={stretchRegion.y2} stroke="#A66BFF" strokeWidth={1.2} strokeDasharray="4 4" label={{ value: 'Target 2', position: 'right', fill: '#A66BFF', fontSize: 11 }} />
                  )}
                  <Customized component={<CandlestickSeries data={chartData} />} />

                  {signalMarkers.map((marker, index) => (
                    <ReferenceDot
                      key={`${marker.date}-${index}`}
                      x={marker.date}
                      y={marker.close}
                      r={5}
                      fill={marker.action === 'BUY' ? '#3FBF7F' : marker.action === 'SELL' ? '#FF5C7A' : '#F4C152'}
                      stroke="#0E121A"
                      strokeWidth={2}
                    />
                  ))}
                  {swingHighMarkers.map((marker, index) => (
                    <ReferenceDot
                      key={`swing-high-${marker.date}-${index}`}
                      x={marker.date}
                      y={marker.price}
                      r={4}
                      fill="#FF728C"
                      stroke="#0E121A"
                      strokeWidth={2}
                    />
                  ))}
                  {swingLowMarkers.map((marker, index) => (
                    <ReferenceDot
                      key={`swing-low-${marker.date}-${index}`}
                      x={marker.date}
                      y={marker.price}
                      r={4}
                      fill="#63D89A"
                      stroke="#0E121A"
                      strokeWidth={2}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="analysis-empty">Sync market data to render the chart.</div>
            )}
          </div>

          {error && (
            <div className="analysis-inline-warning">
              {error}
            </div>
          )}

          <div className="analysis-zones">
            <ZoneCard
              label="Favorable buy region"
              value={buyRegion ? `${buyRegion.y1} - ${buyRegion.y2}` : 'Waiting'}
              note={projection?.buyZone?.label || (closestSupport != null ? `Buyer interest near ${closestSupport.toFixed(2)} support` : 'Support + lower channel overlap')}
              type="buy"
            />
            <ZoneCard
              label="Favorable sell region"
              value={sellRegion ? `${sellRegion.y1} - ${sellRegion.y2}` : 'Waiting'}
              note={projection?.sellZone?.label || (closestResistance != null ? `Seller pressure near ${closestResistance.toFixed(2)} resistance` : 'Resistance + upper channel overlap')}
              type="sell"
            />
            <ZoneCard
              label="Destination zone"
              value={targetRegion ? `${targetRegion.y1} - ${targetRegion.y2}` : (blendedSuggestion?.action || 'N/A')}
              note={projection?.targetZone?.label || blendedSuggestion?.summary || 'No recommendation yet'}
              type="neutral"
            />
          </div>
        </div>

        <aside className="analysis-watchlist">
          <div className="analysis-watchlist-title">Watchlist</div>
          <div className="analysis-watchlist-rows">
            {WATCHLIST.map((symbol) => {
              const quote = quotes?.[symbol];
              const change = Number(quote?.change || 0);
              return (
                <button
                  key={symbol}
                  onClick={() => onSymbolChange(symbol)}
                  className={`analysis-watch-item ${activeSymbol === symbol ? 'active' : ''}`}
                >
                  <span className="analysis-watch-symbol">{symbol}</span>
                  <span className="analysis-watch-last">{quote?.last ? quote.last.toFixed(2) : '—'}</span>
                  <span className={change >= 0 ? 'analysis-up' : 'analysis-down'}>
                    {quote?.last ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}` : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </section>

      <section className="panel page-span-2">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-3">
            <div className="dot" />
            Analysis tabs
          </div>
          <div className="flex gap-2 flex-wrap">
            {TABS.map((item) => (
              <button key={item.id} className={`pill ${tab === item.id ? 'status-accent' : ''}`} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {tab === 'signal' && <SignalTab signal={signal} />}
          {tab === 'structure' && <StructureTab structure={structure} projection={projection} />}
          {tab === 'model' && <ModelTab modelSuggestion={modelSuggestion} blendedSuggestion={blendedSuggestion} />}
          {tab === 'patterns' && <PatternsTab patterns={analysis?.patterns || []} />}
          {tab === 'levels' && <LevelsTab levels={levels} />}
          {tab === 'seasonality' && <SeasonalityTab seasonality={analysis?.seasonality} />}
        </div>
      </section>

      <section className="panel page-span-2">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-3">
            <div className="dot" />
            Signal history overlay
          </div>
          <span className="metric-chip">{history.length} snapshots</span>
        </div>
        <div className="table-head" style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr 0.8fr 1.4fr' }}>
          <span>Timestamp</span>
          <span>Rule</span>
          <span>Model</span>
          <span>Blend</span>
          <span>Summary</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {history.map((item) => (
            <div key={item.id} className="table-row" style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr 0.8fr 1.4fr' }}>
              <span className="mono text-sm neutral">{new Date(item.createdAt).toLocaleString('en-US', { hour12: false })}</span>
              <span className={`mono text-sm ${toneForAction(item.ruleAction)}`}>{item.ruleAction}</span>
              <span className={`mono text-sm ${toneForAction(item.modelAction)}`}>{item.modelAction || 'N/A'}</span>
              <span className={`mono text-sm ${toneForAction(item.blendedAction)}`}>{item.blendedAction}</span>
              <span className="mono text-sm neutral">{item.summary}</span>
            </div>
          ))}
          {!history.length && (
            <div className="h-full flex items-center justify-center p-8 text-center">
              <p className="spark-note">Signal snapshots will appear here after running analysis.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function SignalTab({ signal }) {
  if (!signal) return <p className="spark-note">No signal output yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-5">
      <div className="soft-block p-5">
        <div className="summary-label">Primary signal</div>
        <div className={`summary-value ${toneForAction(signal.action)}`}>{signal.action}</div>
        <p className="spark-note mt-3">{signal.rationale}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 mono text-sm">
          <div><span className="neutral">Entry range</span><div>{signal.entryLow} - {signal.entryHigh}</div></div>
          <div><span className="neutral">Target</span><div>{signal.target}</div></div>
          <div><span className="neutral">Stop loss</span><div>{signal.stopLoss}</div></div>
          <div><span className="neutral">Risk / reward</span><div>{signal.riskReward}</div></div>
        </div>
      </div>
      <div className="grid gap-4">
        <FactorList title="Bull factors" factors={signal.bullFactors || []} tone="positive" />
        <FactorList title="Bear factors" factors={signal.bearFactors || []} tone="negative" />
      </div>
    </div>
  );
}

function ModelTab({ modelSuggestion, blendedSuggestion }) {
  if (!modelSuggestion && !blendedSuggestion) return <p className="spark-note">No model-backed suggestion is available yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-5">
      <div className="soft-block p-5">
        <div className="summary-label">Python model suggestion</div>
        {modelSuggestion ? (
          <>
            <div className={`summary-value ${toneForAction(modelSuggestion.action)}`}>{modelSuggestion.action}</div>
            <p className="spark-note mt-3">
              {modelSuggestion.modelName} | {modelSuggestion.regime} regime | {Math.round((modelSuggestion.confidence || 0) * 100)}% confidence
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 mono text-sm">
              <div><span className="neutral">Expected move</span><div>{modelSuggestion.expectedMovePct}%</div></div>
              <div><span className="neutral">Horizon</span><div>{modelSuggestion.horizon}</div></div>
              <div><span className="neutral">Target</span><div>{modelSuggestion.target}</div></div>
              <div><span className="neutral">Stop</span><div>{modelSuggestion.stopLoss}</div></div>
              <div><span className="neutral">Trend state</span><div>{modelSuggestion.structure?.trendState || 'N/A'}</div></div>
              <div><span className="neutral">Destination zone</span><div>{formatZone(modelSuggestion.projection?.targetZone)}</div></div>
            </div>
            <div className="mt-4 soft-block p-4">
              <div className="summary-label">Native-assisted features</div>
              <div className="mt-3 grid grid-cols-2 gap-3 mono text-sm">
                <div><span className="neutral">Native trend score</span><div>{modelSuggestion.features?.native_trend_score ?? 0}</div></div>
                <div><span className="neutral">Native volatility</span><div>{modelSuggestion.features?.native_volatility_20 ?? 0}</div></div>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {(modelSuggestion.reasons || []).map((reason, idx) => (
                <div key={`${reason}-${idx}`} className="mono text-sm blue">{reason}</div>
              ))}
            </div>
          </>
        ) : (
          <p className="spark-note mt-3">Model service unavailable.</p>
        )}
      </div>
      <div className="soft-block p-5">
        <div className="summary-label">Blended recommendation</div>
        {blendedSuggestion ? (
          <>
            <div className={`summary-value ${toneForAction(blendedSuggestion.action)}`}>{blendedSuggestion.action}</div>
            <p className="spark-note mt-3">
              {blendedSuggestion.summary} Alignment: {blendedSuggestion.alignment}. Confidence: {Math.round((blendedSuggestion.confidence || 0) * 100)}%.
            </p>
            <div className="mt-4 grid gap-2">
              {(blendedSuggestion.reasons || []).map((reason, idx) => (
                <div key={`${reason}-${idx}`} className="mono text-sm accent">{reason}</div>
              ))}
            </div>
          </>
        ) : (
          <p className="spark-note mt-3">Blended recommendation unavailable.</p>
        )}
      </div>
    </div>
  );
}

function StructureTab({ structure, projection }) {
  if (!structure && !projection) return <p className="spark-note">No model structure is available yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-5">
      <div className="soft-block p-5">
        <div className="summary-label">Market structure</div>
        {structure ? (
          <>
            <div className="summary-value accent">{structure.trendState?.replaceAll('_', ' ')}</div>
            <p className="spark-note mt-3">
              Sequence {structure.swingSequence}. Last swing high {structure.lastSwingHigh ?? 'N/A'}, last swing low {structure.lastSwingLow ?? 'N/A'}.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 mono text-sm">
              <div><span className="neutral">Higher highs</span><div>{structure.higherHighs ? 'Yes' : 'No'}</div></div>
              <div><span className="neutral">Higher lows</span><div>{structure.higherLows ? 'Yes' : 'No'}</div></div>
              <div><span className="neutral">Lower highs</span><div>{structure.lowerHighs ? 'Yes' : 'No'}</div></div>
              <div><span className="neutral">Lower lows</span><div>{structure.lowerLows ? 'Yes' : 'No'}</div></div>
            </div>
            <div className="mt-4 grid gap-2">
              {[...(structure.swingHighs || []), ...(structure.swingLows || [])]
                .sort((a, b) => a.index - b.index)
                .slice(-6)
                .map((point, idx) => (
                  <div key={`${point.type}-${point.date}-${idx}`} className="mono text-sm neutral">
                    {point.date} {point.type} {point.price}
                  </div>
                ))}
            </div>
          </>
        ) : (
          <p className="spark-note mt-3">Structure data unavailable.</p>
        )}
      </div>
      <div className="soft-block p-5">
        <div className="summary-label">Projection map</div>
        {projection ? (
          <>
            <div className={`summary-value ${projection.direction === 'UP' ? 'positive' : projection.direction === 'DOWN' ? 'negative' : 'gold'}`}>
              {projection.direction}
            </div>
            <p className="spark-note mt-3">
              Horizon {projection.horizon}. Expected move {projection.expectedMovePct}% over {projection.horizonBars} bars.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 mono text-sm">
              <div><span className="neutral">Buy zone</span><div>{formatZone(projection.buyZone)}</div></div>
              <div><span className="neutral">Sell zone</span><div>{formatZone(projection.sellZone)}</div></div>
              <div><span className="neutral">Target zone</span><div>{formatZone(projection.targetZone)}</div></div>
              <div><span className="neutral">Invalidation</span><div>{projection.invalidationLevel}</div></div>
            </div>
            <div className="mt-4 grid gap-2">
              {(projection.notes || []).map((note, idx) => (
                <div key={`${note}-${idx}`} className="mono text-sm blue">{note}</div>
              ))}
            </div>
          </>
        ) : (
          <p className="spark-note mt-3">Projection data unavailable.</p>
        )}
      </div>
    </div>
  );
}

function CandlestickSeries({ data, xAxisMap, yAxisMap, offset }) {
  const xAxis = Object.values(xAxisMap || {})[0];
  const yAxis = Object.values(yAxisMap || {})[0];
  if (!xAxis || !yAxis || !offset || !data?.length) return null;

  const bandwidth = typeof xAxis.scale?.bandwidth === 'function' ? xAxis.scale.bandwidth() : 0;
  const candleWidth = Math.max(4, Math.min(10, bandwidth * 0.58 || 7));

  return (
    <g>
      {data.map((entry, index) => {
        const x = xAxis.scale(entry.date) + (bandwidth ? bandwidth / 2 : 0);
        const highY = yAxis.scale(entry.high);
        const lowY = yAxis.scale(entry.low);
        const openY = yAxis.scale(entry.open);
        const closeY = yAxis.scale(entry.close);
        const bullish = entry.close >= entry.open;
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
        const stroke = bullish ? '#63D89A' : '#FF728C';
        const fill = bullish ? 'rgba(99,216,154,0.25)' : 'rgba(255,114,140,0.22)';

        return (
          <g key={`${entry.date}-${index}`}>
            <line x1={x} x2={x} y1={highY} y2={lowY} stroke={stroke} strokeWidth={1.4} />
            <rect
              x={x - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              rx={1.5}
              fill={fill}
              stroke={stroke}
              strokeWidth={1.2}
            />
          </g>
        );
      })}
    </g>
  );
}

function PatternsTab({ patterns }) {
  if (!patterns.length) return <p className="spark-note">No recent chart patterns detected.</p>;
  return (
    <div className="grid gap-3">
      {patterns.map((pattern, index) => (
        <div key={`${pattern.name}-${index}`} className="soft-block p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="summary-label">{pattern.bias}</div>
              <div className="mono text-lg">{pattern.name}</div>
            </div>
            <div className="metric-chip">{Math.round((pattern.confidence || 0) * 100)}% confidence</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LevelsTab({ levels }) {
  if (!levels.length) return <p className="spark-note">No support or resistance levels available yet.</p>;
  return (
    <div className="grid gap-3">
      {levels.map((level, index) => (
        <div key={`${level.type}-${index}`} className="soft-block p-4 flex items-center justify-between gap-4">
          <div>
            <div className="summary-label">{level.type}</div>
            <div className="mono text-lg">{level.price}</div>
          </div>
          <div className="metric-chip">{Math.round((level.strength || 0) * 100)}% strength</div>
        </div>
      ))}
    </div>
  );
}

function SeasonalityTab({ seasonality }) {
  if (!seasonality) return <p className="spark-note">No seasonality snapshot available.</p>;
  return (
    <div className="soft-block p-5">
      <pre className="mono text-sm whitespace-pre-wrap">{JSON.stringify(seasonality, null, 2)}</pre>
    </div>
  );
}

function FactorList({ title, factors, tone }) {
  return (
    <div className="soft-block p-5">
      <div className="summary-label">{title}</div>
      <div className="mt-3 grid gap-2">
        {factors.length ? factors.map((factor, index) => (
          <div key={`${factor}-${index}`} className={`mono text-sm ${tone}`}>{factor}</div>
        )) : <div className="mono text-sm neutral">None flagged</div>}
      </div>
    </div>
  );
}

function MiniMetric({ label, value, tone }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className={`summary-value ${tone}`}>{value}</div>
    </div>
  );
}

function ZoneCard({ label, value, note, type }) {
  return (
    <div className={`analysis-zone-card ${type}`}>
      <div className="analysis-zone-label">{label}</div>
      <div className="analysis-zone-value">{value}</div>
      <div className="analysis-zone-note">{note}</div>
    </div>
  );
}

function toneForAction(action) {
  if (action === 'BUY') return 'positive';
  if (action === 'SELL') return 'negative';
  return 'gold';
}

function exponentialMovingAverage(values, period) {
  const multiplier = 2 / (period + 1);
  const ema = [];
  let prev = values[0] ?? 0;
  values.forEach((value, index) => {
    if (index === 0) {
      prev = value;
    } else {
      prev = (value - prev) * multiplier + prev;
    }
    ema.push(round(prev));
  });
  return ema;
}

function valueForTrendLine(lines, kind, index) {
  const line = (lines || []).find((item) => item.kind === kind);
  if (!line) return null;
  return round(Number(line.startPrice) + Number(line.slope) * (index - Number(line.startIndex)));
}

function formatZone(zone) {
  if (!zone) return 'N/A';
  return `${Number(zone.low).toFixed(2)} - ${Number(zone.high).toFixed(2)}`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function buildFallbackCandles(symbol, anchorPrice) {
  const base = Number(anchorPrice || 100);
  const candles = [];
  let price = base;
  const today = new Date();

  for (let i = 119; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);

    const drift = Math.sin((119 - i) / 11) * base * 0.0022;
    const noise = ((119 - i) % 7 - 3) * base * 0.0009;
    const open = price;
    const close = Math.max(1, open + drift + noise);
    const high = Math.max(open, close) + base * 0.006;
    const low = Math.min(open, close) - base * 0.006;

    candles.push({
      date: date.toISOString().slice(0, 10),
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: 1000000 + (119 - i) * 2500,
    });

    price = close;
  }

  return candles;
}
