# AlphaTrade Platform Architecture

AlphaTrade is evolving from a trading-simulator MVP into a broader quant platform. The repo now has a clear separation between execution services, market-data/research services, and platform infrastructure.

## Current platform layers

### Execution and portfolio services
- `order-gateway-svc`: accepts orders and publishes them to Kafka/Redpanda
- `risk-svc`: applies pre-trade risk validation
- `match-engine-svc`: performs price-time-priority matching
- `portfolio-svc`: persists fills, positions, and realized PnL
- `api-gw-graphql`: exposes GraphQL queries and a WebSocket event bridge

### Research and market-data services
- `market-data-svc`: ingests and stores OHLCV data
- `analysis-svc`: computes indicators, patterns, and signals
- `backtest-svc`: runs strategy backtests

### Frontend
- `ui`: React/Vite trading terminal for live monitoring, order entry, positions, and execution flow

### Shared runtime and infra
- `modules/common`: shared Kafka topics, models, and JSON serialization
- `Redpanda`: event backbone for orders, fills, and book snapshots
- `TimescaleDB/PostgreSQL`: primary transactional and time-series persistence
- `Prometheus + Grafana`: service metrics and dashboarding

## Target technology map

Not every tool belongs in the critical path. The intended direction for this repo is:

- `Java/Spring Boot`: service orchestration, APIs, risk, portfolio, integration
- `Python (NumPy/Pandas/SciPy/Numba)`: research, analytics, fast iteration, batch backtests
- `C++`: future low-latency matching or pricing engines behind stable service contracts
- `Kafka/Redpanda`: event-driven market and order workflows
- `TimescaleDB`: durable historical and time-series storage
- `Prometheus/Grafana`: metrics, SLOs, capacity visibility
- `FIX/QuickFIX`: optional future execution connectivity when institutional routing is added
- `QuantLib` / `TA-Lib`: optional domain libraries for derivatives analytics and indicators

## Recommended next phases

1. Harden core order lifecycle, schemas, and test coverage.
2. Expand the Python research workspace and mirror strategy logic there.
3. Add richer market-data ingestion and downsampling jobs.
4. Introduce a native C++ engine only for latency-sensitive flows.
5. Add execution connectivity and deeper observability dashboards.
