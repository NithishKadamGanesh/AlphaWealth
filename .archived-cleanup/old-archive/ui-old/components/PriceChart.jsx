import React from 'react';
import { AreaSeries, createChart } from 'lightweight-charts';

export default function PriceChart({ trades, activeSymbol, liveQuote }) {
  const chartContainerRef = React.useRef(null);
  const chartRef = React.useRef(null);
  const areaSeriesRef = React.useRef(null);
  const hasFittedRef = React.useRef(false);
  const [liveHistory, setLiveHistory] = React.useState([]);

  React.useEffect(() => {
    setLiveHistory([]);
    hasFittedRef.current = false;
  }, [activeSymbol]);

  React.useEffect(() => {
    if (liveQuote?.last) {
      setLiveHistory((prev) => {
        const next = [
          ...prev,
          {
            time: Math.floor(Date.now() / 1000),
            value: Number(liveQuote.last),
          },
        ];
        return next.slice(-120);
      });
    }
  }, [liveQuote?.last]);

  const seriesData = React.useMemo(() => {
    const tradeSeries = trades
      .filter((trade) => trade.symbol === activeSymbol && trade.ts)
      .slice(-120)
      .map((trade) => ({
        time: Math.floor(new Date(trade.ts).getTime() / 1000),
        value: Number(trade.price),
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));

    if (tradeSeries.length > 2) return dedupePoints(tradeSeries);
    if (liveHistory.length > 2) return dedupePoints(liveHistory);
    return [];
  }, [activeSymbol, liveHistory, trades]);
  const hasChartData = seriesData.length > 1;

  const firstPrice = seriesData[0]?.value ?? Number(liveQuote?.last || 0);
  const lastPrice = seriesData[seriesData.length - 1]?.value ?? Number(liveQuote?.last || 0);
  const delta = lastPrice - firstPrice;
  const deltaPct = firstPrice ? (delta / firstPrice) * 100 : 0;
  const high = seriesData.length ? Math.max(...seriesData.map((point) => point.value)) : lastPrice;
  const low = seriesData.length ? Math.min(...seriesData.map((point) => point.value)) : lastPrice;
  const printCount = trades.filter((trade) => trade.symbol === activeSymbol).length;

  React.useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return undefined;

    const chart = createChart(chartContainerRef.current, {
      autoSize: true,
      height: 340,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8ea0ba',
        fontFamily: 'IBM Plex Mono',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        minimumWidth: 74,
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.12)', labelBackgroundColor: '#151A25' },
        horzLine: { color: 'rgba(255,255,255,0.12)', labelBackgroundColor: '#151A25' },
      },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2.5,
      lineColor: delta >= 0 ? '#52d48d' : '#ff6a84',
      topColor: delta >= 0 ? 'rgba(82,212,141,0.30)' : 'rgba(255,106,132,0.28)',
      bottomColor: delta >= 0 ? 'rgba(82,212,141,0.04)' : 'rgba(255,106,132,0.04)',
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    chartRef.current = chart;
    areaSeriesRef.current = series;

    return () => {
      areaSeriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  React.useEffect(() => {
    if (!chartContainerRef.current || !chartRef.current) return;
    chartContainerRef.current.style.opacity = hasChartData ? '1' : '0';
  }, [hasChartData]);

  React.useEffect(() => {
    if (!areaSeriesRef.current || !chartRef.current) return;
    areaSeriesRef.current.setData(seriesData);
    areaSeriesRef.current.applyOptions({
      lineColor: delta >= 0 ? '#52d48d' : '#ff6a84',
      topColor: delta >= 0 ? 'rgba(82,212,141,0.30)' : 'rgba(255,106,132,0.28)',
      bottomColor: delta >= 0 ? 'rgba(82,212,141,0.04)' : 'rgba(255,106,132,0.04)',
    });
    if (seriesData.length > 1 && !hasFittedRef.current) {
      chartRef.current.timeScale().fitContent();
      hasFittedRef.current = true;
    }
  }, [delta, seriesData]);

  return (
    <section className="panel h-full">
      <div className="panel-header justify-between">
        <div className="flex items-center gap-3">
          <div className="dot" />
          Market focus
        </div>
        <div className="flex items-center gap-2">
          <span className="metric-chip">{activeSymbol}</span>
          <span className={`metric-chip ${delta >= 0 ? 'positive' : 'negative'}`}>
            {lastPrice ? `$${lastPrice.toFixed(2)}` : 'Waiting'}
          </span>
        </div>
      </div>

      <div className="card-body price-chart-body">
        <div className="price-chart-topline">
          <div>
            <div className="kicker">Intraday texture</div>
            <div className="hero-value">{lastPrice ? `$${lastPrice.toFixed(2)}` : 'No ticks yet'}</div>
            <div className={`mono text-sm ${delta >= 0 ? 'positive' : 'negative'}`}>
              {lastPrice ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} | ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}% from session sample start` : 'Waiting for stream'}
            </div>
          </div>
          <div className="price-chart-stats">
            <div className="summary-card">
              <div className="summary-label">High</div>
              <div className="summary-value blue">{high ? `$${high.toFixed(2)}` : 'N/A'}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Low</div>
              <div className="summary-value gold">{low ? `$${low.toFixed(2)}` : 'N/A'}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Trade prints</div>
              <div className="summary-value accent">{printCount}</div>
            </div>
          </div>
        </div>

        <div className="soft-block price-chart-surface">
          <div ref={chartContainerRef} className="lightweight-chart-host" />
          {!hasChartData && (
            <div className="panel-empty price-chart-empty-overlay">
              <div>
                <div className="section-title">Waiting for market texture</div>
                <p className="spark-note" style={{ marginTop: 12 }}>Live ticks or matching trades will populate this canvas shortly.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function dedupePoints(points) {
  const deduped = [];
  const seen = new Set();
  for (const point of points) {
    const key = `${point.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(point);
  }
  return deduped;
}
