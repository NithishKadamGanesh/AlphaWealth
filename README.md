# AlphaTrade Engine

A **quantitative trading platform** built as a microservices architecture with real-time order matching, risk validation, portfolio tracking, research services, observability, and a live trading terminal UI.

The repo now also includes:
- a dedicated `python-research/` workspace for NumPy/Pandas/SciPy/Numba-based research
- a Python model inference service for live technical suggestions
- TimescaleDB-compatible persistence via PostgreSQL
- Prometheus and Grafana for backend observability
- additional services for market data, analysis, and backtesting

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  React UI   │────▶│ Order Gateway│────▶│   Redpanda    │────▶│   Risk SVC   │
│  (port 3000)│     │  (port 8081) │     │ (port 19092)  │     │  (port 8082) │
└──────┬──────┘     └──────────────┘     └───────┬───────┘     └──────┬───────┘
       │                                         │                     │
       │  WebSocket + GraphQL                    │                     │
       │                                         │              orders.valid
       ▼                                         ▼                     │
┌──────────────┐     ┌──────────────┐     ┌───────────────┐           │
│  GraphQL API │◀───▶│  PostgreSQL  │◀────│ Portfolio SVC │◀──────────┤
│  (port 8085) │     │  (port 5432) │     │  (port 8084)  │           │
└──────────────┘     └──────────────┘     └───────────────┘           │
                                                ▲                      │
                                          trades.fills                 ▼
                                                │              ┌───────────────┐
                                                └──────────────│ Match Engine  │
                                                               │  (port 8083)  │
                                                               └───────────────┘
```

**Data Flow**: Order Gateway → `orders.raw` → Risk SVC → `orders.valid` → Match Engine → `trades.fills` → Portfolio SVC → PostgreSQL → GraphQL API → React UI

## Tech Stack

| Layer         | Technology                            |
|---------------|---------------------------------------|
| Language      | Java 21, Spring Boot 3.3              |
| Build         | Maven multi-module                    |
| Messaging     | Redpanda (Kafka-compatible)           |
| Database      | PostgreSQL 16                         |
| Cache         | Redis 7 (available for extension)     |
| Query API     | Spring GraphQL                        |
| Real-time     | WebSocket (Kafka → browser)           |
| Frontend      | React 18, Vite, Tailwind, Recharts    |
| Containers    | Docker Compose                        |

## Services

| Service             | Port | Responsibility                                                      |
|---------------------|------|---------------------------------------------------------------------|
| `order-gateway-svc` | 8081 | REST POST `/api/v1/orders` → publishes to `orders.raw`             |
| `risk-svc`          | 8082 | Validates orders (qty, price, notional) → `orders.valid`/`reject`  |
| `match-engine-svc`  | 8083 | Price-time priority matching → `trades.fills` + `orders.updates`   |
| `portfolio-svc`     | 8084 | Consumes fills → upserts positions and trades into PostgreSQL      |
| `api-gw-graphql`    | 8085 | GraphQL queries + WebSocket bridge for real-time UI feed           |
| `ui`                | 3000 | React trading terminal dashboard                                    |

## Kafka Topics

| Topic             | Key       | Purpose                              |
|-------------------|-----------|--------------------------------------|
| `orders.raw`      | orderId   | Raw orders from gateway              |
| `orders.valid`    | orderId   | Risk-approved orders                 |
| `orders.reject`   | orderId   | Risk-rejected orders                 |
| `orders.updates`  | orderId   | Order status changes                 |
| `trades.fills`    | symbol    | Executed trade fills                 |
| `book.snapshots`  | symbol    | Order book depth snapshots           |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Java 21 (for local dev only)
- Maven 3.9+ (for local dev only)
- Node.js 20+ (for local UI dev only)

### Option 1: Full Docker Compose (recommended)

```bash
# Clone and enter the repo
cd alphatrade-engine

# Build and start everything
docker compose up --build -d

# Wait ~60s for all services to initialize, then run the smoke test
chmod +x test-smoke.sh
./test-smoke.sh
```

Services will be available at:
- **Trading UI**: http://localhost:3000
- **GraphiQL**: http://localhost:8085/graphiql
- **Order Gateway**: http://localhost:8081/api/v1/orders
- **Health checks**: http://localhost:8081/actuator/health

### Option 2: Infrastructure in Docker, services locally

```bash
# Start only infrastructure
docker compose up redpanda redpanda-init postgres redis -d

# Wait for Redpanda to be healthy
sleep 15

# Build all Java modules
mvn clean install -DskipTests

# Start each service in a separate terminal
cd modules/order-gateway-svc && mvn spring-boot:run
cd modules/risk-svc && mvn spring-boot:run
cd modules/match-engine-svc && mvn spring-boot:run
cd modules/portfolio-svc && mvn spring-boot:run
cd modules/api-gw-graphql && mvn spring-boot:run

# Start the UI dev server (separate terminal)
cd ui && npm install && npm run dev
```

## Testing the Flow

### Manual curl test

```bash
# 1. Submit a LIMIT BUY
curl -X POST http://localhost:8081/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "ALICE",
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "qty": 100,
    "price": 150.00,
    "timeInForce": "DAY"
  }'

# 2. Submit a LIMIT SELL that crosses (same or lower price)
curl -X POST http://localhost:8081/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "BOB",
    "symbol": "AAPL",
    "side": "SELL",
    "type": "LIMIT",
    "qty": 100,
    "price": 150.00,
    "timeInForce": "DAY"
  }'

# Wait 2-3 seconds, then query positions
curl -X POST http://localhost:8085/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ positions { accountId symbol qty avgPx realizedPnl } }"}'

# Query trades
curl -X POST http://localhost:8085/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ trades { tradeId symbol side qty price ts } }"}'
```

### Automated smoke test

```bash
chmod +x test-smoke.sh
./test-smoke.sh
```

## Matching Engine Design

The matching engine implements **price-time priority** (FIFO):

- **Bids** sorted highest price first (TreeMap with reverse comparator)
- **Asks** sorted lowest price first (TreeMap with natural ordering)
- At the same price level, orders are matched in arrival order (LinkedList FIFO)
- **LIMIT orders**: match only if prices cross (bid >= ask)
- **MARKET orders**: match against best available price
- **Fill price**: always the passive (resting) order's price (maker price)
- **Time-in-Force**: DAY (rest on book), IOC (cancel remaining), FOK (fill completely or cancel)

The engine is designed as a standalone component behind a Kafka consume/produce contract, so it can be replaced by a C++ implementation without changing upstream or downstream services.

## Database Schema

```sql
positions(account_id, symbol, qty, avg_px, realized_pnl)
  PK: (account_id, symbol)

trades(trade_id, order_id, account_id, symbol, side, qty, price, ts)
  PK: trade_id
  IDX: (account_id, symbol, ts)
```

## UI Features

The React trading terminal includes:

- **Order Entry** panel with BUY/SELL toggle, order type, TIF, quick-qty buttons
- **Order Book** depth visualization with bid/ask bars and spread indicator
- **Price Chart** using Recharts with real-time tick data
- **Trade Blotter** showing executed fills with live flash animation
- **Positions** panel with PnL tracking
- **Order Feed** showing real-time order status transitions
- **System Status** with WebSocket connection indicator
- **Real-time WebSocket** feed bridging Kafka → browser

## Extension Points

This platform is designed for the following enhancements:

- **C++ matching engine**: Replace `match-engine-svc` with a native engine; the Kafka contract (`orders.valid` in → `trades.fills` + `orders.updates` out) stays the same
- **Avro/Protobuf**: Swap JSON serialization for schema-registry-backed Avro
- **Redis caching**: Add order state caching and rate limiting via the Redis instance
- **Market data**: Add a market data feed service generating synthetic prices
- **Strategy engine**: Build algorithmic trading strategies that consume market data and emit orders
- **Authentication**: Add JWT-based auth to the API gateway
- **Horizontal scaling**: Run multiple match engine instances with symbol-based partition assignment
- **Metrics**: Add Prometheus + Grafana dashboards for latency, throughput, and fill rates

## Platform Additions

### Python research workspace

Use the new `python-research/` directory for strategy prototyping and numerical analysis:

```bash
cd python-research
python -m venv .venv
.venv\Scripts\activate
pip install -e .
python -m alphatrade_research.examples.sma_backtest
```

Run the model inference service locally:

```bash
cd python-research
python -m alphatrade_research.model_service
```

### Observability

The Docker stack now includes:
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001

Spring services expose metrics through `/actuator/prometheus`.

### Environment setup

Start from `.env.example` when configuring local secrets and API keys.
