import React from 'react';
import { config } from '../lib/api';

const TABS = [
  { id: 'ops', label: 'Ops' },
  { id: 'research', label: 'Research stack' },
  { id: 'services', label: 'Service map' },
];

const SERVICES = [
  ['Order Gateway', '8081', 'Order intake and event publish'],
  ['Risk Service', '8082', 'Pre-trade risk checks'],
  ['Match Engine', '8083', 'Order matching and execution'],
  ['Portfolio Service', '8084', 'Positions, trades, realized pnl'],
  ['GraphQL Gateway', '8085', 'Queries and websocket bridge'],
  ['Market Data', '8087', 'Historical candles and ingestion'],
  ['Analysis Service', '8088', 'Signals, patterns, levels'],
  ['Backtest Service', '8089', 'Strategy evaluation'],
];

export default function PlatformPage({ wsConnected, dataSource }) {
  const [tab, setTab] = React.useState('ops');

  return (
    <main className="page-grid page-grid-2">
      <section className="workspace-hero page-span-2">
        <div>
          <div className="workspace-kicker">Platform Workspace</div>
          <div className="workspace-title">Infrastructure health, research stack, and service topology</div>
          <p className="workspace-note">
            This view is the operational surface for the whole stack, from quote source and analytics services to research tooling and service layout.
          </p>
        </div>
        <div className="workspace-hero-stats">
          <div className="workspace-stat">
            <div className="summary-label">Websocket</div>
            <div className={`workspace-stat-value ${wsConnected ? 'positive' : 'gold'}`}>{wsConnected ? 'Live' : 'Retrying'}</div>
          </div>
          <div className="workspace-stat">
            <div className="summary-label">Quotes</div>
            <div className="workspace-stat-value">{dataSource === 'alphavantage' ? 'Alpha Vantage' : 'Simulator'}</div>
          </div>
          <div className="workspace-stat">
            <div className="summary-label">Model service</div>
            <div className="workspace-stat-value positive">Enabled</div>
          </div>
        </div>
      </section>

      <section className="panel page-span-2">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-3">
            <div className="dot" />
            Platform operations
          </div>
          <div className="flex gap-2 flex-wrap">
            {TABS.map((item) => (
              <button key={item.id} className={`pill ${tab === item.id ? 'status-accent' : ''}`} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {tab === 'ops' && (
            <div className="grid grid-cols-3 gap-4">
              <OpsCard label="Websocket" value={wsConnected ? 'Connected' : 'Retrying'} tone={wsConnected ? 'positive' : 'gold'} />
              <OpsCard label="Quote source" value={dataSource === 'alphavantage' ? 'Alpha Vantage' : 'Simulator'} tone={dataSource === 'alphavantage' ? 'accent' : 'blue'} />
              <OpsCard label="Inference" value="Python model service" tone="positive" />
            </div>
          )}
          {tab === 'research' && (
            <div className="grid gap-4">
              <div className="soft-block p-5">
                <div className="summary-label">Quant stack roadmap</div>
                <div className="mt-3 grid gap-2 mono text-sm">
                  <div>Java + Spring Boot for runtime services</div>
                  <div>Python workspace for numerical research and strategy prototypes</div>
                  <div>Alpha Vantage for market data ingestion and indicator inputs</div>
                  <div>TimescaleDB for historical persistence</div>
                  <div>Prometheus + Grafana for metrics and dashboards</div>
                  <div>C++ still reserved for future latency-sensitive engines</div>
                </div>
              </div>
            </div>
          )}
          {tab === 'services' && (
            <div className="grid gap-3">
              {SERVICES.map(([name, port, purpose]) => (
                <div key={name} className="soft-block p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="summary-label">Port {port}</div>
                    <div className="mono text-lg">{name}</div>
                    <div className="spark-note">{purpose}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="dot" />
          Observability links
        </div>
        <div className="card-body flex gap-3 flex-wrap">
          <a className="btn btn-primary" href={config.grafana} target="_blank" rel="noreferrer">Open Grafana</a>
          <a className="btn btn-ghost" href={config.prometheus} target="_blank" rel="noreferrer">Open Prometheus</a>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="dot" />
          Notes
        </div>
        <div className="card-body">
          <p className="spark-note">
            This page is where we can grow deeper ops features next: service health polling, topic lag, DB status,
            alert summaries, and research pipeline visibility.
          </p>
        </div>
      </section>
    </main>
  );
}

function OpsCard({ label, value, tone }) {
  const className =
    tone === 'positive' ? 'positive' :
    tone === 'negative' ? 'negative' :
    tone === 'blue' ? 'blue' :
    tone === 'accent' ? 'accent' :
    'gold';

  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className={`summary-value ${className}`}>{value}</div>
    </div>
  );
}
