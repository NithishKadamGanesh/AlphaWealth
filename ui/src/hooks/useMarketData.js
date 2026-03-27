import { useState, useEffect } from 'react';
import { getAllSimQuotes, tickSymbol } from '../lib/marketdata';

const SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM'];

/**
 * Local market-data hook for the frontend simulator shell.
 * The backend can still provide candles and analytics, but the shell
 * never depends on a brokerage connection.
 */
export function useMarketData() {
  const [quotes, setQuotes] = useState(() => getAllSimQuotes(SYMBOLS));
  const [dataSource] = useState('sim');

  useEffect(() => {
    const interval = setInterval(() => {
      setQuotes((prev) => {
        const next = { ...prev };
        SYMBOLS.forEach((sym) => {
          next[sym] = tickSymbol(sym);
        });
        return next;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return {
    quotes,
    dataSource,
  };
}
