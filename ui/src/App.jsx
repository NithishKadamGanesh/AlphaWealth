import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useMarketData } from './hooks/useMarketData';
import { queryGraphQL, QUERIES } from './lib/api';
import Header from './components/Header';

const TradingPage = lazy(() => import('./pages/TradingPage'));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'));
const BacktestingPage = lazy(() => import('./pages/BacktestingPage'));
const PlatformPage = lazy(() => import('./pages/PlatformPage'));

export default function App() {
  const ws = useWebSocket();
  const { quotes, dataSource } = useMarketData();
  const [positions, setPositions] = useState([]);
  const [dbTrades, setDbTrades] = useState([]);
  const [activeSymbol, setActiveSymbol] = useState('AAPL');
  const [activeAccount, setActiveAccount] = useState('');
  const [notification, setNotification] = useState(null);
  const [activePage, setActivePage] = useState('trading');
  const [densityMode, setDensityMode] = useState('compact');

  const fetchPositions = useCallback(async () => {
    try {
      const data = await queryGraphQL(QUERIES.positions, { accountId: activeAccount || null });
      setPositions(data.positions || []);
    } catch {}
  }, [activeAccount]);

  const fetchTrades = useCallback(async () => {
    try {
      const data = await queryGraphQL(QUERIES.trades, { accountId: activeAccount || null });
      setDbTrades(data.trades || []);
    } catch {}
  }, [activeAccount]);

  useEffect(() => {
    fetchPositions();
    fetchTrades();
    const interval = setInterval(() => {
      fetchPositions();
      fetchTrades();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchPositions, fetchTrades]);

  useEffect(() => {
    if (ws.lastTrade) {
      setTimeout(() => {
        fetchPositions();
        fetchTrades();
      }, 500);
    }
  }, [ws.lastTrade, fetchPositions, fetchTrades]);

  useEffect(() => {
    if (ws.lastTrade) {
      const t = ws.lastTrade;
      setNotification({ message: `Fill ${t.symbol} ${t.qty} @ ${t.price}`, ts: Date.now() });
      const timeout = setTimeout(() => setNotification(null), 3500);
      return () => clearTimeout(timeout);
    }
  }, [ws.lastTrade]);

  const liveQuote = quotes[activeSymbol];

  const summary = useMemo(() => {
    const totalRealized = positions.reduce((acc, p) => acc + Number(p.realizedPnl || 0), 0);
    const grossQty = positions.reduce((acc, p) => acc + Math.abs(Number(p.qty || 0)), 0);
    const fillCount = dbTrades.length + ws.trades.length;
    return {
      totalRealized,
      grossQty,
      fillCount,
    };
  }, [positions, dbTrades.length, ws.trades.length]);

  return (
    <div className={`app-shell density-${densityMode} page-${activePage}`}>
      <div className="app-backdrop" />
      <div className="app-backdrop-grid" />
      <div className="app-backdrop-orb orb-a" />
      <div className="app-backdrop-orb orb-b" />
      <div className="app-backdrop-orb orb-c" />
      <div className="app-page-halo" />
      <div className="app-grid">
        <Header
          activePage={activePage}
          onPageChange={setActivePage}
          activeSymbol={activeSymbol}
          onSymbolChange={setActiveSymbol}
          notification={notification}
          wsConnected={ws.connected}
          dataSource={dataSource}
          summary={summary}
          densityMode={densityMode}
          onDensityModeChange={setDensityMode}
        />

        <Suspense fallback={<PageLoading />}>
          <div key={activePage} className="page-stage animate-page-switch">
            {activePage === 'trading' && (
              <TradingPage
                activeSymbol={activeSymbol}
                activeAccount={activeAccount}
                onAccountChange={setActiveAccount}
                liveQuote={liveQuote}
                ws={ws}
                dbTrades={dbTrades}
                positions={positions}
                dataSource={dataSource}
              />
            )}

            {activePage === 'analysis' && (
              <AnalysisPage
                activeSymbol={activeSymbol}
                liveQuote={liveQuote}
                quotes={quotes}
                onSymbolChange={setActiveSymbol}
              />
            )}

            {activePage === 'backtesting' && (
              <BacktestingPage activeSymbol={activeSymbol} />
            )}

            {activePage === 'platform' && (
              <PlatformPage wsConnected={ws.connected} dataSource={dataSource} />
            )}
          </div>
        </Suspense>
      </div>
    </div>
  );
}

function PageLoading() {
  return (
    <main className="page-grid page-grid-2">
      <section className="panel page-span-2">
        <div className="card-body">
          <p className="spark-note">Loading workspace...</p>
        </div>
      </section>
    </main>
  );
}
