import { useEffect, useRef, useState, useCallback } from 'react';
import { config } from '../lib/api';

/**
 * WebSocket hook with resilient reconnection.
 * Silently retries without flooding the console.
 * Shows clean status to the UI.
 */
export function useWebSocket() {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastTrade, setLastTrade] = useState(null);
  const [lastOrderUpdate, setLastOrderUpdate] = useState(null);
  const [lastBookSnapshot, setLastBookSnapshot] = useState(null);
  const [trades, setTrades] = useState([]);
  const [orderUpdates, setOrderUpdates] = useState([]);
  const reconnectTimer = useRef(null);
  const retriesRef = useRef(0);
  const maxLoggedRetries = 3; // only log first few retries

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(config.ws);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retriesRef.current = 0;
        console.log('[WS] Connected to trade feed');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'TRADE':
              setLastTrade(msg.data);
              setTrades((prev) => [msg.data, ...prev].slice(0, 200));
              break;
            case 'ORDER_UPDATE':
              setLastOrderUpdate(msg.data);
              setOrderUpdates((prev) => [msg.data, ...prev].slice(0, 200));
              break;
            case 'BOOK_SNAPSHOT':
              setLastBookSnapshot(msg.data);
              break;
          }
        } catch (e) {
          // silently ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        retriesRef.current++;
        // Exponential backoff: 2s, 4s, 8s, max 15s
        const delay = Math.min(2000 * Math.pow(2, Math.min(retriesRef.current - 1, 3)), 15000);
        if (retriesRef.current <= maxLoggedRetries) {
          console.log(`[WS] Reconnecting in ${delay / 1000}s (attempt ${retriesRef.current})`);
        }
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // Don't log — onclose will handle reconnect
        ws.close();
      };
    } catch (e) {
      retriesRef.current++;
      const delay = Math.min(2000 * Math.pow(2, Math.min(retriesRef.current - 1, 3)), 15000);
      reconnectTimer.current = setTimeout(connect, delay);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on cleanup
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    connected,
    lastTrade,
    lastOrderUpdate,
    lastBookSnapshot,
    trades,
    orderUpdates,
  };
}
