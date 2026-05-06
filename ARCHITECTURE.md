# AlphaWealth Command Center - Architecture

This document is the canonical source of truth for what this repo is, how it's
organized, and what each service does. README.md gives a quick-start; this file
explains the system.

## What this repo is now

AlphaWealth is a self-hosted personal-finance and market-intelligence platform.
The default deployment is **monitoring and analytics only - it does not execute
trades**. Its purpose is to give one user (the operator) a unified view of:

- Net worth across brokerages, banking, retirement, and property
- Live market data, technical analysis, and pattern detection
- News-headline sentiment scoring (FinBERT, GPU-accelerated)
- Forward-looking directional forecasts (FinGPT-Forecaster, GPU)
- Native C++ market-regime classification fed into the advisor's RAG context
- A multi-model AI advisor (Claude / OpenAI / Gemini / local Llama 3.1) with
  RAG context built from all of the above

The frontend is a 12-page React app served at port 3000.

## Lineage: the trading-engine layer

This repo originated as `alphatrade-engine`, a trading-simulator MVP with an
order-gateway, risk service, matching engine, portfolio service, and GraphQL
API. Those services still exist in the codebase and still build, but they are
**disabled by default** and gated behind `docker compose --profile trading`.

Treat them as a preserved capability, not part of the headline product. The
project pivoted toward personal-finance / advisory tooling. Trading-execution
work would resume by re-enabling the profile and replacing the simulated
match-engine with a real broker connector (most likely IBKR FIX or REST).

## Current platform layers

### Frontend
- `ui` (port 3000): React + Vite. Pages for Dashboard, Net Worth, Portfolio,
  Markets, Banking, Patterns, Seasonality, Options, Backtest, AI Advisor, FIRE,
  Settings. Hooks under `ui/src/hooks/` wrap each backend service with a
  `dataMode` field (`live | stale | simulated | error | disconnected`) so the
  UI can always surface backend health honestly. The global `TickerTape`
  renders a fixed LIVE / STALE / SIMULATED badge and dims the tape opacity
  when not live.

### Personal-finance services
- `net-worth-svc` (8093, Java): aggregates account balances and computes net
  worth snapshots
- `ibkr-sync-svc` (8091, Java): pulls IBKR positions via the TWS API
- `plaid-banking-svc` (8092, Java): pulls Chase / banking transactions via Plaid
- `alerts-svc` (8095, Java): email alerts via Resend

### Market and analytics services
- `live-data-svc` (8096, Python): yfinance bridge for quotes, history, news
- `analysis-svc` (8088, Java): support/resistance, multi-timeframe convergence,
  pattern detection, indicators, options Greeks
- `backtest-svc` (8089, Java): strategy backtester (7 built-in strategies)
- `model-svc` (8090, Python): research model server
- `cpp-signal-engine` (9000, C++): native indicators **plus** market-regime
  classification. The `/regime` endpoint accepts daily closes and returns a
  `{regime, direction, confidence, snapshot}` shape consumed by ai-advisor-svc
  during RAG context build. Regime labels: `BULL_TREND` / `BEAR_TREND` /
  `RANGING` / `HIGH_VOL` / `INSUFFICIENT_DATA`.

### AI services (all GPU-accelerated, tested on RTX 2080 SUPER 8GB)
- `sentiment-svc` (8097, Python): FinBERT classifier on CUDA, ~10ms/article
- `fingpt-svc` (8098, Python): FinGPT-Forecaster 7B with bnb_4bit quantization,
  ~5GB VRAM, lazy-loaded on first request
- `ollama` (11434): Llama 3.1 8B Q5_K_M chat model, ~5.7GB VRAM, auto-swaps
  with FinGPT when needed (8GB cannot hold both at once)
- `ai-advisor-svc` (8094, Java): multi-provider router (Claude / OpenAI /
  Gemini / Ollama). Builds RAG context from net-worth + IBKR + Plaid +
  analysis-svc + sentiment-svc + cpp-signal-engine (regime), optionally
  including FinGPT forecasts. The C++ regime line is the only directional
  market signal that has no Java or Python equivalent in the stack.

### Legacy trading services (profile: trading, off by default)
- `order-gateway-svc` (8081, Java): order intake, publishes to Kafka
- `risk-svc` (8082, Java): pre-trade risk checks
- `match-engine-svc` (8083, Java): price-time-priority matching simulator
- `portfolio-svc` (8084, Java): fills, positions, realized PnL
- `api-gw-graphql` (8085, Java): GraphQL + WebSocket bridge

### Shared runtime
- Redpanda (Kafka API, port 19092): event bus for market ticks, sentiment
  scores, forecasts, and (when trading profile is on) orders/fills
- TimescaleDB / Postgres (5432): persistent storage for net worth snapshots,
  positions, transactions, and trading data
- Redis (6379): cache layer
- Prometheus (9090) + Grafana (3001): metrics and dashboards

## Source of truth for service ports

| Port  | Service             | Status   |
|-------|---------------------|----------|
| 3000  | ui                  | default  |
| 3001  | grafana             | default  |
| 5432  | postgres            | default  |
| 6379  | redis               | default  |
| 8081  | order-gateway       | trading  |
| 8082  | risk-svc            | trading  |
| 8083  | match-engine        | trading  |
| 8084  | portfolio-svc       | trading  |
| 8085  | api-gw-graphql      | default  |
| 8088  | analysis-svc        | default  |
| 8089  | backtest-svc        | default  |
| 8090  | model-svc           | default  |
| 8091  | ibkr-sync-svc       | default  |
| 8092  | plaid-banking-svc   | default  |
| 8093  | net-worth-svc       | default  |
| 8094  | ai-advisor-svc      | default  |
| 8095  | alerts-svc          | default  |
| 8096  | live-data-svc       | default  |
| 8097  | sentiment-svc       | default GPU |
| 8098  | fingpt-svc          | default GPU |
| 9000  | cpp-signal-engine   | default  |
| 9090  | prometheus          | default  |
| 11434 | ollama              | default GPU |
| 19092 | redpanda kafka      | default  |

Every service has a healthcheck and `restart: unless-stopped` set in
`docker-compose.yml`. The orchestrator restarts crashed services
automatically and the health probes surface in `docker compose ps`.

## Technology choices and rationale

| Layer                  | Tech                          | Why                                    |
|------------------------|-------------------------------|----------------------------------------|
| Service orchestration  | Java / Spring Boot            | Type safety, ecosystem, easy to staff  |
| Research and ML        | Python                        | NumPy / pandas / transformers / PEFT   |
| Native compute         | C++                           | Deterministic perf, regime + indicators|
| LLM serving (chat)     | Ollama                        | Local, free, GPU-accelerated, simple   |
| LLM serving (forecast) | HuggingFace transformers + PEFT | Required for LoRA adapters           |
| Sentiment              | FinBERT via transformers      | Best-in-class for financial text       |
| Event bus              | Redpanda (Kafka API)          | Single binary, lighter than Kafka      |
| Persistence            | TimescaleDB                   | Time-series + relational in one        |
| Metrics                | Prometheus + Grafana          | Standard, low-friction                 |

## Frontend data-source discipline

A common failure mode in dashboards: silently fall back to synthetic data when
a backend is down, so the UI looks alive even though the user is being lied to.

Every hook in `ui/src/hooks/` exposes a `dataMode` field with consistent vocabulary:

- `live` - backend reachable, data is real
- `stale` - last fetch failed once, showing cached values
- `simulated` - backend unreachable for >= 2 polls, showing seed/mock data
- `error` - request failed, no data shown (used by hooks that should never
  fabricate, like `useSentiment` and `useForecast`)
- `disconnected` - service reachable but external dependency offline (e.g.
  ibkr-sync-svc up but TWS Gateway not running)

Pages render mode tags via a shared helper. The `TickerTape` shows the global
quote-feed mode at the top of every page. Hooks `console.warn` with a reason
the first time they fall back to simulated data, so the dev console always
explains the dim/yellow/red state on screen.

If you add a new hook, follow the same convention. Never let the UI quietly
fabricate numbers without telling the user. The advisor's RAG context
assembly is covered by an integration smoke test in
`modules/ai-advisor-svc/src/test/java/com/alphatrade/advisor/AdvisorContextIntegrationTest.java`
that mocks all six backing services and asserts every expected section
appears in the prompt.

## VRAM budget on a single 8GB GPU

The default AI stack is calibrated for an 8GB consumer GPU (tested on
RTX 2080 SUPER). Everything fits if you respect this budget:

|                  | Idle | Chat active | Forecast active |
|------------------|------|-------------|-----------------|
| FinBERT          | 0.5  | 0.5         | 0.5             |
| Ollama (Llama)   | 0    | 5.7         | 0 (unloaded)    |
| FinGPT (Llama-2) | 0    | 0           | ~5.0            |
| Total VRAM       | 0.5  | 6.2         | 5.5             |

Both LLMs cannot coexist in 8GB. Ollama auto-unloads when idle; FinGPT loads
on first `/forecast/{symbol}` request and stays resident.

## Recommended next phases

The original ARCHITECTURE.md listed trading-platform next steps. Those still
apply if and when the trading profile is revived. The current personal-finance
roadmap is:

1. Add pgvector and a knowledge-base service for 10-K filings and earnings
   transcripts, fed to the AI advisor as RAG context. (This is the next
   meaningful capability gap.)
2. Add real IBKR positions and real Plaid banking with proper credential UX,
   replacing the current sandbox defaults.
3. Apply the dataMode pattern to the few remaining places that still display
   the legacy `isReal` boolean tag (the hooks already expose dataMode; some
   pages haven't been rewired to use the unified tag helper yet).
4. Optional: re-enable the trading profile with a real broker execution
   connector if the project ever returns to that direction.

Recently shipped (no longer roadmap items):

- Frontend `npm run build` works cleanly; framer-motion and other unused
  deps removed; Sidebar uses CSS transitions
- README, ARCHITECTURE, pom, and docker-compose now tell one coherent
  trading-vs-monitoring story
- All hooks expose `dataMode`; UI surfaces it via the TickerTape badge and
  per-page tags
- Every service has restart policies + healthchecks in docker-compose
- C++ engine wired into ai-advisor-svc via a new `/regime` endpoint
  (Phase 2 of the C++ integration plan; other phases deliberately skipped)
- AI advisor RAG context covered by integration smoke test
- Dead code removed: useWebSocket, useMarketData, lib/api.js, lib/marketdata.js,
  lib/platform.js, plus the trading-era root scripts (start/stop/test-smoke)
  and static preview.html. All moved to `.archived-cleanup/` for review.
