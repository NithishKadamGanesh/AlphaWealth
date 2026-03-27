import React, { useState, useCallback } from 'react';
import { submitOrder } from '../lib/api';

export default function OrderEntry({ activeSymbol, activeAccount, onAccountChange, livePrice }) {
  const [side, setSide] = useState('BUY');
  const [type, setType] = useState('LIMIT');
  const [qty, setQty] = useState('100');
  const [price, setPrice] = useState('150.00');
  const [tif, setTif] = useState('DAY');
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (livePrice) setPrice(livePrice.toFixed(2));
  }, [activeSymbol, livePrice]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setStatus(null);

    try {
      const order = {
        clientId: activeAccount || 'TRADER-1',
        symbol: activeSymbol,
        side,
        type,
        qty: parseInt(qty, 10),
        price: type === 'LIMIT' ? parseFloat(price) : null,
        timeInForce: tif,
      };
      const res = await submitOrder(order);
      setStatus({ ok: true, msg: `${res.orderId} accepted` });
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setSubmitting(false);
    }
  }, [activeAccount, activeSymbol, price, qty, side, submitting, tif, type]);

  const notional = type === 'LIMIT' && qty && price ? parseFloat(qty || 0) * parseFloat(price || 0) : null;

  return (
    <section className="panel h-full">
      <div className="panel-header">
        <div className="dot" />
        Execution ticket
      </div>

      <div className="card-body order-entry-body">
        <div className="soft-block order-entry-hero">
          <div className="kicker">Selected symbol</div>
          <div className="order-entry-hero-row">
            <div>
              <div className="section-title">{activeSymbol}</div>
              <div className="spark-note">Route a discretionary order into the simulator pipeline.</div>
            </div>
            <div className="mono order-entry-live">
              <div className="order-entry-live-price">{livePrice ? `$${livePrice.toFixed(2)}` : 'Waiting'}</div>
              <div className="neutral text-xs">Live reference</div>
            </div>
          </div>
        </div>

        <div className="order-entry-block">
          <label className="label">Account</label>
          <input
            type="text"
            value={activeAccount}
            onChange={(e) => onAccountChange(e.target.value)}
            placeholder="TRADER-1"
          />
        </div>

        <div className="order-entry-side-switch">
          <button className={`btn ${side === 'BUY' ? 'btn-buy' : 'btn-ghost'}`} onClick={() => setSide('BUY')}>
            Buy
          </button>
          <button className={`btn ${side === 'SELL' ? 'btn-sell' : 'btn-ghost'}`} onClick={() => setSide('SELL')}>
            Sell
          </button>
        </div>

        <div className="order-entry-grid">
          <div>
            <label className="label">Order type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="LIMIT">Limit</option>
              <option value="MARKET">Market</option>
            </select>
          </div>
          <div>
            <label className="label">Time in force</label>
            <select value={tif} onChange={(e) => setTif(e.target.value)}>
              <option value="DAY">Day</option>
              <option value="IOC">IOC</option>
              <option value="FOK">FOK</option>
            </select>
          </div>
        </div>

        <div className={`order-entry-grid ${type === 'LIMIT' ? 'order-entry-grid-2' : 'order-entry-grid-1'}`}>
          <div>
            <label className="label">Quantity</label>
            <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          {type === 'LIMIT' && (
            <div>
              <label className="label">Limit price</label>
              <input type="number" min="0.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          )}
        </div>

        <div className="order-entry-size-row">
          {[25, 50, 100, 250, 500].map((value) => (
            <button key={value} className="btn btn-ghost" onClick={() => setQty(String(value))}>
              {value}
            </button>
          ))}
        </div>

        <div className="soft-block order-entry-summary">
          <div className="order-entry-grid">
            <div>
              <div className="summary-label">Estimated notional</div>
              <div className="summary-value">{notional ? `$${notional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Market order'}</div>
            </div>
            <div>
              <div className="summary-label">Intent</div>
              <div className={`summary-value ${side === 'BUY' ? 'positive' : 'negative'}`}>{side}</div>
            </div>
          </div>
        </div>

        <button className="btn btn-primary w-full" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting order...' : `${side} ${activeSymbol}`}
        </button>

        {status && (
          <div className={`soft-block order-entry-status mono text-sm animate-slide-up ${status.ok ? 'positive' : 'negative'}`}>
            {status.msg}
          </div>
        )}
      </div>
    </section>
  );
}
