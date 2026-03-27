import React from 'react';

const STATUS_CLASSES = {
  NEW: 'blue',
  ACCEPTED: 'accent',
  REJECTED: 'negative',
  FILLED: 'positive',
  PARTIALLY_FILLED: 'gold',
  CANCELLED: 'neutral',
};

export default function OrderFeed({ updates }) {
  return (
    <section className="panel h-full">
      <div className="panel-header justify-between">
        <div className="flex items-center gap-3">
          <div className="dot" />
          Order lifecycle
        </div>
        <span className="metric-chip">{updates.length}</span>
      </div>

      <div className="table-head" style={{ gridTemplateColumns: '0.9fr 1.2fr 1fr 0.9fr' }}>
        <span>Time</span>
        <span>Order</span>
        <span>Status</span>
        <span className="text-right">Symbol</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 order-feed-body">
        {updates.map((order, index) => {
          const ts = order.ts
            ? new Date(order.ts).toLocaleTimeString('en-US', { hour12: false })
            : '';
          const color = STATUS_CLASSES[order.status] || 'neutral';

          return (
            <div
              key={`${order.orderId}-${order.status}-${index}`}
              className="table-row animate-slide-up order-feed-row"
              style={{ gridTemplateColumns: '0.9fr 1.2fr 1fr 0.9fr' }}
            >
              <span className="mono text-sm neutral">{ts}</span>
              <span className="mono text-sm">{(order.orderId || '').slice(-10)}</span>
              <span className={`mono text-sm font-semibold ${color}`}>{order.status}</span>
              <span className="mono text-sm neutral text-right">{order.symbol} {order.side}</span>
            </div>
          );
        })}

        {updates.length === 0 && (
          <div className="panel-empty">
            <p className="spark-note">Order state transitions will appear here in real time.</p>
          </div>
        )}
      </div>
    </section>
  );
}
