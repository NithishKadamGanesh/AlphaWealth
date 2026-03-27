import React from 'react';
import OrderEntry from '../components/OrderEntry';
import OrderBook from '../components/OrderBook';
import PriceChart from '../components/PriceChart';
import TradeBlotter from '../components/TradeBlotter';
import Positions from '../components/Positions';
import OrderFeed from '../components/OrderFeed';
import SystemStatus from '../components/SystemStatus';

export default function TradingPage({
  activeSymbol,
  activeAccount,
  onAccountChange,
  liveQuote,
  ws,
  dbTrades,
  positions,
  dataSource,
}) {
  return (
    <main className="page-grid">
      <section className="workspace-hero">
        <div>
          <div className="workspace-kicker">Execution Workspace</div>
          <div className="workspace-title">{activeSymbol} live execution, order flow, and portfolio reaction</div>
          <p className="workspace-note">
            This screen is tuned for fast discretionary trading: ticket on the left, market context in the middle, and account impact on the right.
          </p>
        </div>
        <div className="workspace-hero-stats">
          <div className="workspace-stat">
            <div className="summary-label">Last price</div>
            <div className="workspace-stat-value">{liveQuote?.last ? `$${liveQuote.last.toFixed(2)}` : 'Waiting'}</div>
          </div>
          <div className="workspace-stat">
            <div className="summary-label">Orders</div>
            <div className="workspace-stat-value">{ws.orderUpdates.length}</div>
          </div>
          <div className="workspace-stat">
            <div className="summary-label">Positions</div>
            <div className="workspace-stat-value">{positions.length}</div>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="workspace-left">
          <OrderEntry
            activeSymbol={activeSymbol}
            activeAccount={activeAccount}
            onAccountChange={onAccountChange}
            livePrice={liveQuote?.last}
          />
          <OrderBook snapshot={ws.lastBookSnapshot} activeSymbol={activeSymbol} />
        </aside>

        <section className="workspace-center">
          <PriceChart trades={ws.trades} activeSymbol={activeSymbol} liveQuote={liveQuote} />
          <TradeBlotter trades={dbTrades} wsTrades={ws.trades} />
        </section>

        <aside className="workspace-right">
          <Positions positions={positions} />
          <OrderFeed updates={ws.orderUpdates} />
          <SystemStatus wsConnected={ws.connected} trades={ws.trades} dataSource={dataSource} />
        </aside>
      </section>
    </main>
  );
}
