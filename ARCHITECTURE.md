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

## Lineage

This repo originated as `alphatrade-engine`, a trading-simulator MVP
(order-gateway, risk service, matching engine, portfolio service, and a
GraphQL API). The project pivoted to personal-finance / advisory tooling, and
those legacy trading services have since been **removed** — the codebase is now
focused solely on the AlphaWealth monitoring/advisory product. If trading
execution is ever revived, it would be built fresh against a real broker
connector (e.g. IBKR FIX or REST) rather than the old simulator.

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
- `ibkr-sync-svc` (8091, Java): pulls IBKR positions via the Client Portal Web API
- `teller-banking-svc` (8092, Java): pulls bank accounts / transactions via Teller.io (mTLS)
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
  Gemini / Ollama). Builds RAG context from net-worth + IBKR + Teller +
  analysis-svc + sentiment-svc + cpp-signal-engine (regime), optionally
  including FinGPT forecasts. The C++ regime line is the only directional
  market signal that has no Java or Python equivalent in the stack.

### Shared runtime
- Redpanda (Kafka API, port 19092): event bus for IBKR/Teller balances,
  sentiment scores, forecasts, and net-worth snapshots
- TimescaleDB / Postgres (5432): persistent storage for net worth snapshots,
  positions, and transactions
- Redis (6379): cache layer
- Prometheus (9090) + Grafana (3001): metrics and dashboards

## Source of truth for service ports

| Port  | Service             | Status   |
|-------|---------------------|----------|
| 3000  | ui                  | default  |
| 3001  | grafana             | default  |
| 5432  | postgres            | default  |
| 6379  | redis               | default  |
| 8088  | analysis-svc        | default  |
| 8089  | backtest-svc        | default  |
| 8090  | model-svc           | default  |
| 8091  | ibkr-sync-svc       | default  |
| 8092  | teller-banking-svc  | default  |
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
  ibkr-sync-svc up but the Client Portal gateway not authenticated yet)

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

The personal-finance roadmap:

1. Add pgvector and a knowledge-base service for 10-K filings and earnings
   transcripts, fed to the AI advisor as RAG context. (This is the next
   meaningful capability gap.)
2. Expand real-broker / banking coverage (more IBKR account types, multiple
   Teller institutions) with richer credential UX.
3. Apply the dataMode pattern to the few remaining places that still display
   the legacy `isReal` boolean tag (the hooks already expose dataMode; some
   pages haven't been rewired to use the unified tag helper yet).

Recently shipped (no longer roadmap items):

- API token auth across all Java + Python services (opt-in via `API_TOKEN`)
- Prometheus metrics on the Python services; Grafana dashboards
- JUnit + pytest suites and a GitHub Actions CI pipeline
- Finance engine: portfolio rebalancing, FIFO capital-gains, dividend projection
- C++ engine wired into ai-advisor-svc and analysis-svc via a `/regime` endpoint
- AI advisor RAG context covered by integration smoke test
- Banking integration renamed Plaid → Teller.io (the implementation was always
  Teller); production mTLS support
- Legacy trading services (order-gateway, risk-svc, match-engine, portfolio-svc,
  api-gw-graphql, market-data-svc) and all archived dead code fully removed
