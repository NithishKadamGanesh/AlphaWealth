import React from 'react';

export default function TradeBlotter({ trades, wsTrades }) {
  const allTrades = React.useMemo(() => {
    const wsTradeIds = new Set(wsTrades.map((t) => t.tradeId));
    const merged = [
      ...wsTrades.map((t) => ({ ...t, _live: true })),
      ...trades.filter((t) => !wsTradeIds.has(t.tradeId)),
    ];
    return merged.slice(0, 100);
  }, [trades, wsTrades]);

  return (
    <section className="panel h-full">
      <div className="panel-header justify-between">
        <div className="flex items-center gap-3">
          <div className="dot" />
          Fill stream
        </div>
        <span className="metric-chip">{allTrades.length} prints</span>
      </div>

      <div className="table-head" style={{ gridTemplateColumns: '1fr 0.9fr 0.8fr 0.9fr 0.9fr 1.2fr' }}>
        <span>Time</span>
        <span>Symbol</span>
        <span>Side</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Price</span>
        <span>Trade id</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 blotter-body">
        {allTrades.map((trade, i) => {
          const side = trade.side || trade.aggressorSide;
          const isBuy = side === 'BUY';
          return (
            <div
              key={trade.tradeId || i}
              className={`table-row blotter-row ${trade._live ? 'row-flash' : ''}`}
              style={{ gridTemplateColumns: '1fr 0.9fr 0.8fr 0.9fr 0.9fr 1.2fr' }}
            >
              <span className="mono text-sm neutral">
                {trade.ts ? new Date(trade.ts).toLocaleTimeString('en-US', { hour12: false }) : ''}
              </span>
              <span className="mono text-sm">{trade.symbol}</span>
              <span className={`mono text-sm font-semibold ${isBuy ? 'positive' : 'negative'}`}>{side}</span>
              <span className="mono text-sm text-right">{Number(trade.qty).toLocaleString()}</span>
              <span className="mono text-sm text-right">{Number(trade.price).toFixed(2)}</span>
              <span className="mono text-sm neutral">{(trade.tradeId || '').slice(-10)}</span>
            </div>
          );
        })}

        {allTrades.length === 0 && (
          <div className="panel-empty">
            <p className="spark-note">Match two compatible orders to watch the fill stream come alive.</p>
          </div>
        )}
      </div>
    </section>
  );
}
