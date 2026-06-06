# AlphaWealth Command Center

A self-hosted personal finance OS with live market intelligence and a
GPU-accelerated AI advisor. Default deployment is monitoring and analytics
only - it does not execute trades.

For the canonical architecture, service inventory, port map, and design
rationale, see [ARCHITECTURE.md](./ARCHITECTURE.md). This README is the
quick-start.

## What you get

- **Net worth** aggregator pulling IBKR holdings + Teller.io banking + manual entries
- **Markets** page with real yfinance candles, support/resistance overlays,
  multi-timeframe convergence, pattern detection
- **FinBERT** scoring every news headline (GPU, ~10ms per article)
- **FinGPT-Forecaster** generating next-week directional predictions on demand
- **AI Advisor** with 4 swappable LLM backends:
  - `claude` - Anthropic Claude Sonnet (paid, best quality)
  - `openai` - GPT-4o-mini (paid, cheap)
  - `gemini` - Gemini 2.0 Flash (free tier, 15 RPM)
  - `ollama` - Llama 3.1 8B Q5_K_M, local on your GPU (free, default)
- **Backtester** for 7 built-in strategies
- **Spending tracker**, **FIRE calculator**, **options analyzer**, **seasonality**
- **Portfolio tools**: rebalancing planner, FIFO capital-gains, dividend projection
- **Market regime** classification (BULL/BEAR/RANGING/HIGH_VOL) from the native C++ engine

The UI is 12 pages of React. Every backend hook exposes a `dataMode` field
(`live | stale | simulated | error`) and the `TickerTape` always shows the
current mode so you can never mistake fallback ticks for real prices.

## Hardware target

The AI stack is calibrated for **8GB GPUs**. Tested on RTX 2080 SUPER. Larger
cards (12-24GB) will work fine and let you run bigger Ollama models. CPU-only
deployments will work for everything except the LLM services.

## Quick start

```cmd
cd C:\Users\nithi\OneDrive\Desktop\alphatrade-engine

REM 1. Verify Docker can see your GPU (optional but recommended)
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi

REM 2. Configure secrets (all optional - defaults work)
copy .env.example .env

REM 3. Build the UI cleanly (first time, or after package.json changes)
cd ui
del /s /q node_modules 2>nul
del package-lock.json 2>nul
npm install
npm run build
cd ..

REM 4. Build and start everything
docker compose up --build -d

REM 5. Pull Ollama models one-time (~5.7GB)
docker exec alphawealth-ollama ollama pull llama3.1:8b-instruct-q5_K_M

REM 6. Open the UI
start http://localhost:3000
```

The first `/forecast/{symbol}` request triggers a one-time ~13GB FinGPT model
download. Subsequent forecasts run in 3-15 seconds.

## Optional integrations

Add to `.env`:

| Feature              | Variable(s)                                  | Cost         |
|----------------------|----------------------------------------------|--------------|
| Real IBKR holdings   | `IBKR_CP_GATEWAY_URL` + run Client Portal gateway | Free with IB |
| Real banks via Teller| `TELLER_APP_ID` + mTLS cert (dev/prod)       | Free tier    |
| Claude advisor       | `ANTHROPIC_API_KEY=sk-ant-...`               | Paid usage   |
| GPT-4 advisor        | `OPENAI_API_KEY=sk-...`                      | Paid usage   |
| Gemini advisor       | `GEMINI_API_KEY=...`                         | Free tier    |
| HuggingFace gated    | `HF_TOKEN=hf_...`                            | Free token   |
| Email alerts         | `RESEND_API_KEY`, `ALERT_TO_EMAIL`           | Free 3000/mo |

## Securing the API (recommended)

By default every service is open on localhost. To require authentication, set a
token in `.env`:

```
API_TOKEN=$(openssl rand -hex 32)   # any strong string
CORS_ALLOW_ORIGIN=http://localhost:3000
```

When `API_TOKEN` is set, all Java and Python services reject requests that don't
present `Authorization: Bearer <token>` (health and `/metrics` probes stay open).
Paste the same token into the UI under **Settings → Profile → API Token**; the
frontend then attaches it to every backend call automatically. Leave `API_TOKEN`
blank for open local-dev access.

## Metrics & dashboards

- Java services expose Micrometer metrics at `/actuator/prometheus`.
- Python services expose `/metrics` (request latency + custom counters:
  quote cache hit/miss, FinBERT articles classified, FinGPT forecast latency).
- Prometheus scrapes all of them; Grafana is at `http://localhost:3001`.

## Tests & CI

- Java: `mvn -pl modules/analysis-svc,modules/backtest-svc -am test`
  (Black-Scholes/IV, backtest P&L, rebalancing, FIFO capital-gains, dividends).
  **Requires JDK 21** — newer JDKs break Lombok annotation processing.
- Python: `cd modules/live-data-svc && pip install -r requirements.txt pytest && pytest -q`
- Frontend: `cd ui && npm ci && npm run build`
- GitHub Actions (`.github/workflows/ci.yml`) runs all three on push/PR.

## Troubleshooting

**Frontend `npm run build` fails with module-not-found errors**
The lockfile may be out of sync with `package.json`. Delete `ui/node_modules`
and `ui/package-lock.json`, then `npm install` again.

**Docker can't see GPU**
Verify with `docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi`.
On Windows, you need Docker Desktop with WSL2 backend and the
nvidia-container-toolkit installed inside WSL2.

**fingpt-svc OOMs on first forecast**
Lower `MAX_VRAM_GB` in `docker-compose.yml` from 6 to 5, or close other
GPU-using applications (games, browsers with hardware acceleration).

**Ollama: "model not found"**
Run `docker exec alphawealth-ollama ollama pull llama3.1:8b-instruct-q5_K_M`.

**UI shows STALE or SIMULATED badge**
The relevant backend service is unreachable. Check
`docker compose ps` and `docker compose logs <service>`. The UI is being
honest with you - it's not real data.

## Project layout

```
AlphaWealth/
  docker-compose.yml          service orchestration with GPU passthrough
  ARCHITECTURE.md             canonical architecture doc (read this)
  .env.example                all configuration knobs
  README.md                   you are here
  ui/                         React frontend (Vite, Tailwind, recharts)
  modules/
    live-data-svc/            yfinance bridge (Python)
    analysis-svc/             technical analytics (Java)
    backtest-svc/             strategy backtester (Java)
    ai-advisor-svc/           multi-LLM advisor with RAG (Java)
    sentiment-svc/            FinBERT GPU service (Python)
    fingpt-svc/               FinGPT-Forecaster GPU service (Python)
    ibkr-sync-svc/            IBKR integration (Java)
    teller-banking-svc/       Teller.io banking integration (Java)
    net-worth-svc/            aggregator (Java)
    alerts-svc/               Resend email (Java)
  python-research/            research model server
  cpp-native/                 C++ technical signal engine
  infra/                      postgres init, prometheus, grafana provisioning
```
