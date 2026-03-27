import React from 'react';

const PAGES = [
  { id: 'trading', label: 'Trading' },
  { id: 'analysis', label: 'Technical Analysis' },
  { id: 'backtesting', label: 'Backtesting' },
  { id: 'platform', label: 'Platform Ops' },
];

const SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM'];

export default function Header({
  activePage,
  onPageChange,
  activeSymbol,
  onSymbolChange,
  notification,
  wsConnected,
  dataSource,
  summary,
  densityMode,
  onDensityModeChange,
}) {
  return (
    <header className="top-shell">
      <div className="top-shell-row">
        <div className="brand-lockup">
          <div className="brand-mark-wrap">
            <div className="brand-mark">AT</div>
            <div className="brand-mark-glow" />
          </div>
          <div>
            <div className="kicker">AlphaTrade Studio</div>
            <div className="top-shell-title">Trading, research, analytics, and platform intelligence in one workspace.</div>
          </div>
        </div>

        <div className="top-shell-meta">
          <div className="glass-stat">
            <div className="summary-label">Realized pnl</div>
            <div className={`glass-stat-value ${Number(summary?.totalRealized || 0) >= 0 ? 'positive' : 'negative'}`}>
              {formatCurrency(summary?.totalRealized)}
            </div>
          </div>
          <div className="glass-stat">
            <div className="summary-label">Fill count</div>
            <div className="glass-stat-value">{Number(summary?.fillCount || 0).toLocaleString('en-US')}</div>
          </div>
          <div className="glass-stat">
            <div className="summary-label">Focus</div>
            <div className="glass-stat-value">{activeSymbol}</div>
          </div>
        </div>
      </div>

      <div className="top-shell-status-row">
        <div className="top-shell-statuses">
          <span className={`status-badge ${wsConnected ? 'status-buy' : 'status-sell'}`}>
            {wsConnected ? 'Websocket live' : 'Websocket reconnecting'}
          </span>
          <span className={`status-badge ${dataSource === 'alphavantage' ? 'status-accent' : 'btn-ghost'}`}>
            {dataSource === 'alphavantage' ? 'Alpha Vantage market data' : 'Simulator quotes'}
          </span>
          <span className="status-badge btn-ghost">Workspace focus {activeSymbol}</span>
          {notification && <span className="status-badge status-buy animate-slide-up">{notification.message}</span>}
        </div>
      </div>

      <div className="top-shell-nav-block">
        <nav className="nav-strip">
          {PAGES.map((page) => (
            <button
              key={page.id}
              onClick={() => onPageChange(page.id)}
              className={`workspace-tab ${activePage === page.id ? 'active' : ''}`}
            >
              {page.label}
            </button>
          ))}
        </nav>

        <div className="symbol-strip">
          {SYMBOLS.map((symbol) => (
            <button
              key={symbol}
              onClick={() => onSymbolChange(symbol)}
              className={`symbol-chip ${activeSymbol === symbol ? 'active' : ''}`}
            >
              {symbol}
            </button>
          ))}
        </div>

        <div className="density-strip">
          <span className="summary-label">Density</span>
          <div className="density-switch">
            <button
              onClick={() => onDensityModeChange('comfortable')}
              className={`density-toggle ${densityMode === 'comfortable' ? 'active' : ''}`}
            >
              Comfortable
            </button>
            <button
              onClick={() => onDensityModeChange('compact')}
              className={`density-toggle ${densityMode === 'compact' ? 'active' : ''}`}
            >
              Compact
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function formatCurrency(value) {
  const num = Number(value || 0);
  return `${num >= 0 ? '+' : '-'}$${Math.abs(num).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
