import React from 'react';

export default function OrderBook({ snapshot, activeSymbol }) {
  const bids = snapshot?.symbol === activeSymbol ? (snapshot.bids || []) : [];
  const asks = snapshot?.symbol === activeSymbol ? (snapshot.asks || []) : [];
  const maxQty = Math.max(...[...bids, ...asks].map((level) => Number(level.qty || 0)), 1);
  const spread =
    asks.length > 0 && bids.length > 0
      ? Number(asks[0].price) - Number(bids[0].price)
      : null;

  return (
    <section className="panel h-full">
      <div className="panel-header justify-between">
        <div className="flex items-center gap-3">
          <div className="dot" />
          Depth ladder
        </div>
        <span className="metric-chip">{activeSymbol}</span>
      </div>

      <div className="card-body depth-book-body">
        <div className="soft-block depth-spread-card">
          <div className="summary-label">Spread</div>
          <div className="summary-value gold">{spread != null ? spread.toFixed(2) : 'No book yet'}</div>
        </div>

        <div className="table-head" style={{ gridTemplateColumns: '1.2fr 1fr 0.8fr' }}>
          <span>Price</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Orders</span>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {[...asks].reverse().map((level, idx) => (
            <DepthRow key={`ask-${idx}`} level={level} maxQty={maxQty} tone="ask" />
          ))}

          <div className="depth-midpoint-wrap">
            <div className="soft-block depth-midpoint mono text-xs">
              <span className="neutral">Midpoint</span>
              <span>{spread != null ? ((Number(asks[0].price) + Number(bids[0].price)) / 2).toFixed(2) : 'Waiting'}</span>
            </div>
          </div>

          {bids.map((level, idx) => (
            <DepthRow key={`bid-${idx}`} level={level} maxQty={maxQty} tone="bid" />
          ))}

          {bids.length === 0 && asks.length === 0 && (
            <div className="panel-empty">
              <p className="spark-note">No orders are resting on the book yet.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DepthRow({ level, maxQty, tone }) {
  const width = `${(Number(level.qty || 0) / maxQty) * 100}%`;
  const fill = tone === 'bid' ? 'rgba(31,143,102,0.14)' : 'rgba(201,91,82,0.14)';
  const textClass = tone === 'bid' ? 'positive' : 'negative';

  return (
    <div className={`table-row relative overflow-hidden depth-row depth-row-${tone}`} style={{ gridTemplateColumns: '1.2fr 1fr 0.8fr' }}>
      <div className="absolute inset-y-2 rounded-full depth-row-fill" style={{ width, background: fill }} />
      <span className={`mono text-sm relative z-10 ${textClass}`}>{Number(level.price).toFixed(2)}</span>
      <span className="mono text-sm relative z-10 text-right">{Number(level.qty).toLocaleString()}</span>
      <span className="mono text-sm relative z-10 text-right neutral">{level.orderCount}</span>
    </div>
  );
}
