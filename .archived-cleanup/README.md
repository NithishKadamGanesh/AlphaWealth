# Archived (dead code, safe to delete)

This folder holds files that were referenced by older versions of the project
but are no longer used by anything in the current architecture. Nothing in
`docker-compose.yml`, the React UI, or the Java reactor imports any of these.

This was confirmed by exhaustive grep across all 13 React pages, all 14
backend services, both compose files, and the Maven reactor.

If everything is still working a few weeks from now, delete this whole folder:

```cmd
rmdir /s /q .archived-cleanup
```

Or via git:

```cmd
git rm -rf .archived-cleanup
```

## What's here and why it was removed

### `ui-hooks/`

- **useWebSocket.js** - hooked up to the legacy trading-engine WebSocket at
  `ws://localhost:8085/ws/trades` for real-time fill/order/book updates. Not
  imported by App.jsx or any page since the pivot to monitoring-only.
- **useMarketData.js** - simulator hook that produced fake price ticks for
  the original prototype shell. Replaced entirely by `useLiveQuotes.js`,
  which talks to the real `live-data-svc:8096` (yfinance) and exposes a
  `dataMode` field so the UI can show LIVE/STALE/SIMULATED honestly.

### `ui-lib/`

- **api.js** - GraphQL/WebSocket client and query strings for the trading
  engine (orders, positions, trades). Only consumed by the (now-archived)
  useWebSocket.js. Trading is gated behind `--profile trading` in compose
  and the UI no longer surfaces it.
- **marketdata.js** - random-walk price simulator backing the old
  useMarketData.js. Dead alongside it.
- **platform.js** - HTTP client for the original Spring Boot
  `market-data-svc:8087`. Confirmed dead: every page now uses direct
  `fetch()` calls to the current services. The Java `market-data-svc` is
  itself dead (still in the Maven reactor, but not in compose; superseded
  by the Python `live-data-svc`).

### `root-scripts/`

- **start.cmd**, **stop.cmd** - Windows launchers that ran each Java service
  as a `mvnw spring-boot:run` background process. Pre-pivot: launches the
  trading services, references the old port 8087 for market-data, doesn't
  know about the Python services (live-data, sentiment, fingpt) or the C++
  engine. Replaced by `docker compose up -d`.
- **test-smoke.cmd**, **test-smoke.sh** - End-to-end smoke tests for the
  trading pipeline (BUY/SELL/positions/trades). Most of what they exercise
  is now under `--profile trading` or no longer exists. The current smoke
  test for the AlphaWealth product is the Java integration test in
  `modules/ai-advisor-svc/src/test/java/com/alphatrade/advisor/AdvisorContextIntegrationTest.java`.
- **setup-dirs.ps1** - One-shot scaffolding script that pre-created Java
  module directory layouts. Already run; directories exist; useless going
  forward.
- **preview.html** - Self-contained static HTML mockup used before the
  React app was built. Superseded by the actual UI at port 3000.
- **architecture.png**, **alphatrade_architecture.svg** - Architecture
  diagrams from the trading-engine era. They show the trading pipeline
  (order-gateway / risk-svc / match-engine / portfolio-svc / GraphQL) but
  miss every service added during the AlphaWealth pivot. ARCHITECTURE.md
  is now the canonical architecture doc.
- **clientportal.gw.zip** - Downloaded copy of IBKR's Client Portal Gateway.
  Not used: ibkr-sync-svc connects to the standard TWS API on port 7497
  via the Python `ib_insync` library, not via Client Portal Gateway.

### `old-archive/`

The previous `_archive/` directory at the repo root, consolidated here
so all dead code lives in one place. Contains earlier versions of UI
components/pages and another copy of `preview.html`. Same disposition
as everything else: safe to delete.
