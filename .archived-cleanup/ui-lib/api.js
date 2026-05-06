// API endpoints — these respect Vite proxy in dev, direct URLs in production
const API_BASE = import.meta.env.VITE_API_BASE || '';
const GW_BASE = import.meta.env.VITE_GW_BASE || '';
const WS_BASE = import.meta.env.VITE_WS_BASE || '';
const PROM_BASE = import.meta.env.VITE_PROMETHEUS_BASE || 'http://localhost:9090';
const GRAFANA_BASE = import.meta.env.VITE_GRAFANA_BASE || 'http://localhost:3001';

export const config = {
  orderGateway: GW_BASE || 'http://localhost:8081',
  graphql: API_BASE || 'http://localhost:8085',
  ws: WS_BASE || 'ws://localhost:8085/ws/trades',
  prometheus: PROM_BASE,
  grafana: GRAFANA_BASE,
};

export async function submitOrder(order) {
  const res = await fetch(`${config.orderGateway}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
  if (!res.ok) throw new Error(`Order submit failed: ${res.status}`);
  return res.json();
}

export async function queryGraphQL(query, variables = {}) {
  const res = await fetch(`${config.graphql}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL query failed: ${res.status}`);
  const data = await res.json();
  if (data.errors) {
    console.error('GraphQL errors:', data.errors);
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

export const QUERIES = {
  positions: `query($accountId: String) {
    positions(accountId: $accountId) {
      accountId symbol qty avgPx realizedPnl
      totalBuyQty totalSellQty totalBuyNotional totalSellNotional
    }
  }`,
  trades: `query($accountId: String, $symbol: String) {
    trades(accountId: $accountId, symbol: $symbol) {
      tradeId orderId accountId symbol side qty price ts
    }
  }`,
};
