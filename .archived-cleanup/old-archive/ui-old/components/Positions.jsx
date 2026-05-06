import React from 'react';

export default function Positions({ positions }) {
  const totalPnl = positions.reduce((acc, pos) => acc + Number(pos.realizedPnl || 0), 0);
  const gross = positions.reduce((acc, pos) => acc + Math.abs(Number(pos.qty || 0)), 0);

  return (
    <section className="panel h-full">
      <div className="panel-header justify-between">
        <div className="flex items-center gap-3">
          <div className="dot" />
          Portfolio state
        </div>
        <span className={`metric-chip ${totalPnl >= 0 ? 'positive' : 'negative'}`}>
          {totalPnl >= 0 ? '+' : '-'}${Math.abs(totalPnl).toFixed(2)}
        </span>
      </div>

      <div className="card-body positions-top">
        <div className="positions-summary-grid">
          <div className="summary-card">
            <div className="summary-label">Open lines</div>
            <div className="summary-value blue">{positions.length}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Gross qty</div>
            <div className="summary-value accent">{gross.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="table-head" style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr 0.9fr 0.9fr' }}>
        <span>Account</span>
        <span>Symbol</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Avg</span>
        <span className="text-right">PnL</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 positions-body">
        {positions.map((pos) => {
          const pnl = Number(pos.realizedPnl || 0);
          const qty = Number(pos.qty || 0);
          return (
            <div
              key={`${pos.accountId}-${pos.symbol}`}
              className="table-row positions-row"
              style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr 0.9fr 0.9fr' }}
            >
              <span className="mono text-sm blue truncate">{pos.accountId}</span>
              <span className="mono text-sm">{pos.symbol}</span>
              <span className={`mono text-sm text-right ${qty >= 0 ? 'positive' : 'negative'}`}>
                {qty > 0 ? '+' : ''}{qty}
              </span>
              <span className="mono text-sm text-right">{Number(pos.avgPx || 0).toFixed(2)}</span>
              <span className={`mono text-sm text-right ${pnl >= 0 ? 'positive' : 'negative'}`}>
                {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}
              </span>
            </div>
          );
        })}

        {positions.length === 0 && (
          <div className="panel-empty">
            <p className="spark-note">No simulated positions yet. Your next fill will populate this ledger.</p>
          </div>
        )}
      </div>
    </section>
  );
}
