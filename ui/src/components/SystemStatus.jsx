import React, { useState, useEffect } from 'react';
import { config } from '../lib/api';

export default function SystemStatus({ wsConnected, trades, dataSource }) {
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="panel h-full">
      <div className="panel-header">
        <div className="dot" />
        Platform health
      </div>

      <div className="card-body status-stack">
        <div className="status-grid">
          <HealthRow label="Market source" value={dataSource === 'alphavantage' ? 'Alpha Vantage' : 'Simulator'} tone={dataSource === 'alphavantage' ? 'accent' : 'blue'} />
          <HealthRow label="Websocket" value={wsConnected ? 'Connected' : 'Reconnecting'} tone={wsConnected ? 'positive' : 'gold'} />
          <HealthRow label="Session uptime" value={formatTime(uptime)} tone="neutral" />
          <HealthRow label="Observed fills" value={String(trades.length)} tone="positive" />
          <HealthRow label="Research stack" value="Python model online" tone="accent" />
        </div>

        <div className="soft-block status-observability">
          <div className="summary-label">Observability</div>
          <div className="status-observability-links">
            <a className="btn btn-ghost" href={config.prometheus} target="_blank" rel="noreferrer">Prometheus</a>
            <a className="btn btn-ghost" href={config.grafana} target="_blank" rel="noreferrer">Grafana</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function HealthRow({ label, value, tone }) {
  const className =
    tone === 'positive' ? 'positive' :
    tone === 'negative' ? 'negative' :
    tone === 'gold' ? 'gold' :
    tone === 'blue' ? 'blue' :
    tone === 'accent' ? 'accent' :
    'neutral';

  return (
    <div className="soft-block health-row">
      <span className="summary-label">{label}</span>
      <span className={`mono text-sm ${className}`}>{value}</span>
    </div>
  );
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
