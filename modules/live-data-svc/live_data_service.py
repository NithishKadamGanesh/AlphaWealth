"""
modules/live-data-svc/live_data_service.py
Free live market data using yfinance — no API keys required
Replaces Polygon.io WebSocket with yfinance polling
Also scrapes free news, Fear & Greed Index, sector performance

Run locally:
    pip install -r requirements.txt
    python live_data_service.py

Run in Docker (handled by docker-compose):
    docker-compose up live-data-svc
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import requests
from bs4 import BeautifulSoup
import asyncio
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote as url_quote
import uvicorn

from starlette.responses import JSONResponse

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="AlphaWealth Live Data Service", version="1.0.0")
app.add_middleware(CORSMiddleware,
                   allow_origins=["*"],
                   allow_methods=["*"],
                   allow_headers=["*"])

# ─── API token auth (opt-in: enforced only when API_TOKEN is set) ──
API_TOKEN = os.getenv("API_TOKEN", "").strip()
_AUTH_PUBLIC_PATHS = {"/", "/health", "/ready", "/metrics", "/docs", "/openapi.json", "/redoc"}
if API_TOKEN:
    log.info("API token auth ENABLED — requests require Authorization: Bearer <token> or X-API-Token")
else:
    log.warning("API_TOKEN not set — auth DISABLED (open access). Set API_TOKEN to require a token.")


@app.middleware("http")
async def _token_auth(request, call_next):
    if API_TOKEN and request.method != "OPTIONS" and request.url.path not in _AUTH_PUBLIC_PATHS:
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else request.headers.get("x-api-token", "")
        if token != API_TOKEN:
            origin = request.headers.get("origin", "*")
            return JSONResponse(
                status_code=401,
                content={"error": "unauthorized", "detail": "missing or invalid API token"},
                headers={"Access-Control-Allow-Origin": origin, "Vary": "Origin"},
            )
    return await call_next(request)


# ─── Prometheus metrics (/metrics) — guarded so the service still runs
#     even if the instrumentator package isn't installed. ──────────────
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    from prometheus_client import Counter

    QUOTE_CACHE_HITS = Counter("livedata_quote_cache_hits_total", "Quote cache hits")
    QUOTE_CACHE_MISSES = Counter("livedata_quote_cache_misses_total", "Quote cache misses")
    UPSTREAM_FETCH_ERRORS = Counter("livedata_upstream_fetch_errors_total", "Upstream (yfinance) fetch errors")

    Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    log.info("Prometheus metrics exposed at /metrics")
    _METRICS = True
except Exception as e:  # pragma: no cover
    log.warning(f"Prometheus instrumentation unavailable: {e}")
    QUOTE_CACHE_HITS = QUOTE_CACHE_MISSES = UPSTREAM_FETCH_ERRORS = None
    _METRICS = False


def _metric_inc(counter):
    if counter is not None:
        try:
            counter.inc()
        except Exception:
            pass

executor = ThreadPoolExecutor(max_workers=8)
_quote_cache: dict = {}
_bars_cache: dict = {}
_fear_greed_cache: dict = {}
_quote_cache_ttl = 5       # seconds
_bars_cache_ttl = 300      # seconds
_fear_greed_ttl = 900      # seconds

FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "").strip()
PANDAPROXY_URL = os.getenv("PANDAPROXY_URL", "").strip().rstrip("/")
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "alphawealth")
DB_USER = os.getenv("DB_USER", "alphatrade")
DB_PASSWORD = os.getenv("DB_PASSWORD", "alphatrade123")
_news_schema_ready = False
_pandaproxy_disabled = False


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _publish_kafka_record(topic: str, key: str, value: dict) -> None:
    global _pandaproxy_disabled
    if _pandaproxy_disabled or not PANDAPROXY_URL:
        return
    try:
        res = requests.post(
            f"{PANDAPROXY_URL}/topics/{topic}",
            headers={"Content-Type": "application/vnd.kafka.json.v2+json"},
            data=json.dumps({"records": [{"key": key, "value": value}]}, default=str),
            timeout=1.0,
        )
        if res.status_code >= 300:
            log.debug("Pandaproxy publish to %s returned HTTP %s: %s", topic, res.status_code, res.text[:200])
    except Exception as exc:
        _pandaproxy_disabled = True
        log.warning("Pandaproxy publishing disabled: %s", exc)


def _publish_market_tick(quote: dict) -> None:
    try:
        symbol = quote.get("symbol", "")
        _publish_kafka_record("market.ticks", symbol, {
            "symbol": quote.get("symbol"),
            "price": quote.get("price"),
            "change": quote.get("change"),
            "changePct": quote.get("change_pct"),
            "volume": quote.get("volume"),
            "timestamp": quote.get("timestamp") or datetime.now().isoformat(),
            "source": "live-data-svc",
        })
    except Exception as exc:
        log.debug("Failed to publish market tick for %s: %s", quote.get("symbol"), exc)


def _parse_date(value: str | None, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}. Use YYYY-MM-DD.")


def _parse_as_of(value: str | None) -> datetime:
    if not value:
        return _utc_now()
    try:
        if len(value) == 10:
            return datetime.fromisoformat(value).replace(tzinfo=timezone.utc) + timedelta(days=1)
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid as_of: {value}. Use ISO datetime or YYYY-MM-DD.")


def _db_conn():
    import psycopg2
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=3,
    )


def _ensure_news_schema() -> bool:
    global _news_schema_ready
    if _news_schema_ready:
        return True
    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS news_articles (
                        id                  BIGSERIAL PRIMARY KEY,
                        symbol              VARCHAR(16) NOT NULL,
                        source              VARCHAR(32) NOT NULL,
                        source_external_id  VARCHAR(128),
                        source_name         VARCHAR(128),
                        category            VARCHAR(64),
                        document_type       VARCHAR(32) NOT NULL DEFAULT 'news',
                        title               TEXT NOT NULL,
                        summary             TEXT,
                        url                 TEXT,
                        published_at        TIMESTAMPTZ NOT NULL,
                        ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        raw                 JSONB
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_news_articles_source_id
                        ON news_articles(source, source_external_id, symbol)
                        WHERE source_external_id IS NOT NULL;
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_news_articles_url_symbol
                        ON news_articles(symbol, url)
                        WHERE url IS NOT NULL;
                    CREATE INDEX IF NOT EXISTS idx_news_articles_symbol_published
                        ON news_articles(symbol, published_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_news_articles_type_published
                        ON news_articles(document_type, published_at DESC);
                """)
        _news_schema_ready = True
        return True
    except Exception as e:
        log.warning(f"News storage unavailable: {e}")
        return False


@app.on_event("startup")
def _startup_news_schema():
    _ensure_news_schema()


# ─── Models ──────────────────────────────────────────────────

class Quote(BaseModel):
    symbol: str
    price: float
    change: float
    change_pct: float
    open: float
    high: float
    low: float
    prev_close: float
    volume: int
    market_cap: Optional[int] = None
    pe_ratio: Optional[float] = None
    day_range: str
    year_range: str
    timestamp: str


class CompanyProfile(BaseModel):
    symbol: str
    name: str
    sector: str
    industry: str
    description: Optional[str]
    employees: Optional[int]
    website: Optional[str]
    country: Optional[str]
    # Financial metrics
    marketCap: Optional[float] = None
    peRatio: Optional[float] = None
    eps: Optional[float] = None
    revenue: Optional[float] = None
    grossMargin: Optional[float] = None
    profitMargin: Optional[float] = None
    debtToEquity: Optional[float] = None
    dividendYield: Optional[float] = None
    fiftyTwoWeekHigh: Optional[float] = None
    fiftyTwoWeekLow: Optional[float] = None
    avgVolume: Optional[float] = None
    beta: Optional[float] = None
    # Earnings
    nextEarningsDate: Optional[str] = None
    earningsDaysOut: Optional[int] = None


# ─── Live Quotes ─────────────────────────────────────────────

def _cache_is_fresh(entry: Optional[dict], ttl_seconds: int) -> bool:
    return bool(entry) and (datetime.now() - entry["fetched"]).total_seconds() < ttl_seconds


def _cache_put(cache: dict, key: str, data: dict | list) -> dict | list:
    cache[key] = {"data": data, "fetched": datetime.now()}
    return data


def _fetch_yahoo_chart(symbol: str, period: str, interval: str) -> dict:
    encoded = url_quote(symbol, safe="")
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}"
        f"?range={period}&interval={interval}&includePrePost=false&events=div,splits"
    )
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    r.raise_for_status()
    payload = r.json()
    chart = payload.get("chart", {})
    if chart.get("error"):
        raise ValueError(chart["error"].get("description") or f"Yahoo chart error for {symbol}")
    result = (chart.get("result") or [None])[0]
    if not result:
        raise ValueError(f"No chart data for {symbol}")
    return result


def _bars_from_chart(chart: dict, interval: str) -> list:
    timestamps = chart.get("timestamp") or []
    quote = ((chart.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    bars = []
    for i, ts in enumerate(timestamps):
        close = closes[i] if i < len(closes) else None
        open_ = opens[i] if i < len(opens) else None
        high = highs[i] if i < len(highs) else None
        low = lows[i] if i < len(lows) else None
        if close is None or open_ is None or high is None or low is None:
            continue

        dt = datetime.fromtimestamp(ts)
        label = dt.strftime("%Y-%m-%d")
        if interval.endswith("m") or interval.endswith("h"):
            label = dt.isoformat(timespec="minutes")

        bars.append({
            "date": label,
            "open": round(float(open_), 2),
            "high": round(float(high), 2),
            "low": round(float(low), 2),
            "close": round(float(close), 2),
            "volume": int(volumes[i] or 0) if i < len(volumes) else 0,
        })
    return bars


def _quote_from_chart(symbol: str, chart: dict) -> dict:
    bars = _bars_from_chart(chart, "1d")
    if not bars:
        raise ValueError(f"No quote bars for {symbol}")

    meta = chart.get("meta") or {}
    last_bar = bars[-1]
    prev_close = meta.get("chartPreviousClose")
    if prev_close in (None, 0) and len(bars) > 1:
        prev_close = bars[-2]["close"]
    if prev_close in (None, 0):
        prev_close = last_bar["close"]

    current = meta.get("regularMarketPrice", last_bar["close"])
    change = float(current) - float(prev_close)
    change_pct = (change / float(prev_close) * 100) if prev_close else 0

    year_low = meta.get("fiftyTwoWeekLow", last_bar["low"])
    year_high = meta.get("fiftyTwoWeekHigh", last_bar["high"])

    return {
        "symbol": symbol.upper(),
        "price": round(float(current), 2),
        "change": round(float(change), 2),
        "change_pct": round(float(change_pct), 2),
        "open": last_bar["open"],
        "high": last_bar["high"],
        "low": last_bar["low"],
        "prev_close": round(float(prev_close), 2),
        "volume": int(meta.get("regularMarketVolume") or last_bar["volume"] or 0),
        "market_cap": meta.get("marketCap"),
        "pe_ratio": None,
        "day_range": f"{last_bar['low']:.2f} - {last_bar['high']:.2f}",
        "year_range": f"{float(year_low):.2f} - {float(year_high):.2f}",
        "timestamp": datetime.now().isoformat(),
    }


def _fetch_quote_sync(symbol: str) -> dict:
    cache_key = f"quote:{symbol}"
    cached = _quote_cache.get(cache_key)
    if _cache_is_fresh(cached, _quote_cache_ttl):
        _metric_inc(QUOTE_CACHE_HITS)
        data = cached["data"]
        _publish_market_tick(data)
        return data

    _metric_inc(QUOTE_CACHE_MISSES)
    try:
        data = _quote_from_chart(symbol, _fetch_yahoo_chart(symbol, "5d", "1d"))
        data = _cache_put(_quote_cache, cache_key, data)
        _publish_market_tick(data)
        return data
    except Exception as e:
        _metric_inc(UPSTREAM_FETCH_ERRORS)
        if cached:
            log.warning(f"Using cached quote for {symbol} after live fetch failed: {e}")
            return {**cached["data"], "stale": True, "timestamp": datetime.now().isoformat()}
        log.error(f"Failed to fetch {symbol}: {e}")
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found or fetch failed")


@app.get("/quote/{symbol}", response_model=Quote)
async def get_quote(symbol: str):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch_quote_sync, symbol)


@app.get("/quotes")
async def get_multiple_quotes(symbols: str):
    """Bulk quote fetch.

    Returns a dict shape that always reports partial-success state so the frontend
    can distinguish "all good" from "5 of 10 silently failed". The legacy flat
    {symbol: quote} shape is kept under the `quotes` key for backwards compat —
    new callers should read `meta` to learn what failed.
    """
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return {"quotes": {}, "meta": {"requested": 0, "succeeded": 0, "failed": [], "status": "ok"}}

    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, _fetch_quote_sync, s) for s in syms]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    quotes: dict = {}
    failed: list = []
    for sym, r in zip(syms, results):
        if isinstance(r, Exception):
            quotes[sym] = {"error": str(r), "symbol": sym}
            failed.append({"symbol": sym, "error": str(r)})
        else:
            quotes[sym] = r

    succeeded = len(syms) - len(failed)
    if failed:
        # Loud warning so operators see partial failures in logs instead of silently
        # returning a shorter list to clients.
        log.warning(
            "Bulk quote partial failure: %d of %d failed (%s)",
            len(failed), len(syms), ", ".join(f["symbol"] for f in failed),
        )

    status = "ok" if not failed else ("partial" if succeeded > 0 else "error")
    payload = {
        **quotes,  # legacy flat shape for back-compat
        "quotes": quotes,
        "meta": {
            "requested": len(syms),
            "succeeded": succeeded,
            "failed": failed,
            "status": status,
        },
    }
    return payload


def _bars_for(symbol: str, period: str, interval: str) -> list:
    """Common bar fetcher used by /history, /api/marketdata/candles."""
    cache_key = f"bars:{symbol}:{period}:{interval}"
    cached = _bars_cache.get(cache_key)
    if _cache_is_fresh(cached, _bars_cache_ttl):
        return cached["data"]

    try:
        bars = _bars_from_chart(_fetch_yahoo_chart(symbol, period, interval), interval)
        if not bars:
            raise ValueError(f"No bars for {symbol} {period}/{interval}")
        return _cache_put(_bars_cache, cache_key, bars)
    except Exception as e:
        if cached:
            log.warning(f"Using cached bars for {symbol} {period}/{interval} after live fetch failed: {e}")
            return cached["data"]
        log.error(f"History fetch failed for {symbol} {period}/{interval}: {e}")
        return []


@app.get("/history/{symbol}")
async def get_history(symbol: str, period: str = "1mo", interval: str = "1d"):
    loop = asyncio.get_event_loop()
    bars = await loop.run_in_executor(executor, _bars_for, symbol, period, interval)
    return {"symbol": symbol.upper(), "period": period, "interval": interval, "bars": bars}


# ─── Bridge endpoints for analysis-svc and backtest-svc ─────
# These Java services expect /api/marketdata/candles/{symbol} returning a flat array of bars

@app.get("/api/marketdata/candles/{symbol}")
async def candles_compat(symbol: str, period: str = "2y", interval: str = "1d"):
    """Daily candles - compat shape (flat array, not wrapped)"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _bars_for, symbol, period, interval)


@app.get("/api/marketdata/candles/{symbol}/weekly")
async def candles_weekly_compat(symbol: str, period: str = "5y"):
    """Weekly candles for multi-timeframe analysis"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _bars_for, symbol, period, "1wk")


# ─── Company Info ────────────────────────────────────────────

@app.get("/company/{symbol}", response_model=CompanyProfile)
async def get_company(symbol: str):
    def _fetch():
        from datetime import date, timedelta
        ticker = yf.Ticker(symbol)
        info = ticker.info

        # Next earnings date
        next_earnings = None
        earnings_days_out = None
        try:
            cal = ticker.calendar
            if cal is not None and not cal.empty:
                ed_col = [c for c in cal.columns if "Earnings Date" in str(c)]
                if ed_col:
                    ed_val = cal[ed_col[0]].iloc[0]
                    if hasattr(ed_val, "date"):
                        next_earnings = str(ed_val.date())
                        earnings_days_out = (ed_val.date() - date.today()).days
        except Exception:
            pass

        return {
            "symbol":      symbol.upper(),
            "name":        info.get("longName", info.get("shortName", symbol)),
            "sector":      info.get("sector", "Unknown"),
            "industry":    info.get("industry", "Unknown"),
            "description": (info.get("longBusinessSummary") or "")[:500],
            "employees":   info.get("fullTimeEmployees"),
            "website":     info.get("website"),
            "country":     info.get("country"),
            # Financial metrics
            "marketCap":        info.get("marketCap"),
            "peRatio":          info.get("trailingPE") or info.get("forwardPE"),
            "eps":              info.get("trailingEps"),
            "revenue":          info.get("totalRevenue"),
            "grossMargin":      info.get("grossMargins"),
            "profitMargin":     info.get("profitMargins"),
            "debtToEquity":     info.get("debtToEquity"),
            "dividendYield":    info.get("dividendYield"),
            "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow":  info.get("fiftyTwoWeekLow"),
            "avgVolume":        info.get("averageVolume"),
            "beta":             info.get("beta"),
            "nextEarningsDate": next_earnings,
            "earningsDaysOut":  earnings_days_out,
        }
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch)


# ─── Top Movers / Trending ──────────────────────────────────

@app.get("/movers")
async def get_movers():
    universe = ["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "TSLA",
                "AMD", "INTC", "AVGO", "CRM", "NFLX", "PYPL", "DIS", "BA",
                "JPM", "BAC", "GS", "WMT", "TGT", "COST", "HD", "NKE"]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, _fetch_quote_sync, s) for s in universe]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    valid = [r for r in results if not isinstance(r, Exception)]
    return {
        "gainers":     sorted(valid, key=lambda q: q["change_pct"], reverse=True)[:5],
        "losers":      sorted(valid, key=lambda q: q["change_pct"])[:5],
        "most_active": sorted(valid, key=lambda q: q["volume"], reverse=True)[:5],
    }


@app.get("/indices")
async def get_indices():
    indices = {"^GSPC": "S&P 500", "^DJI": "Dow Jones", "^IXIC": "Nasdaq",
               "^RUT": "Russell 2000", "^VIX": "VIX"}
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, _fetch_quote_sync, s) for s in indices]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return {s: {"name": name, **(r if not isinstance(r, Exception) else {})}
            for (s, name), r in zip(indices.items(), results)}


@app.get("/sectors")
async def get_sectors():
    sectors = {
        "XLK": "Technology", "XLV": "Healthcare", "XLF": "Financials",
        "XLY": "Consumer Discretionary", "XLP": "Consumer Staples",
        "XLE": "Energy", "XLI": "Industrials", "XLU": "Utilities",
        "XLB": "Materials", "XLRE": "Real Estate", "XLC": "Communication"
    }
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, _fetch_quote_sync, s) for s in sectors]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [{"ticker": s, "sector": name, **(r if not isinstance(r, Exception) else {})}
            for (s, name), r in zip(sectors.items(), results)]


@app.get("/news/{symbol}")
async def get_news(symbol: str, limit: int = 10, as_of: str | None = None, stored_only: bool = False):
    def _fetch():
        sym = symbol.upper()
        as_of_dt = _parse_as_of(as_of)
        if _ensure_news_schema():
            stored = _read_stored_news(sym, limit=max(1, min(limit, 100)), as_of=as_of_dt)
            if stored or stored_only:
                return stored
        if stored_only:
            return []

        try:
            ticker = yf.Ticker(sym)
            news = ticker.news[:limit]
            return [_normalize_yahoo_news(sym, n) for n in news]
        except Exception as e:
            log.error(f"News fetch failed for {sym}: {e}")
            return []
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch)


def _normalize_yahoo_news(symbol: str, item: dict) -> dict:
    published_ts = item.get("providerPublishTime") or 0
    published = datetime.fromtimestamp(published_ts, tz=timezone.utc) if published_ts else _utc_now()
    return {
        "symbol": symbol.upper(),
        "title": item.get("title", ""),
        "source": item.get("publisher", "Yahoo Finance"),
        "source_name": item.get("publisher", "Yahoo Finance"),
        "url": item.get("link", ""),
        "published": published.isoformat(),
        "published_at": published.isoformat(),
        "summary": (item.get("summary", "") or "")[:300],
        "category": item.get("type", "news"),
        "document_type": "news",
    }


def _classify_doc_type(item: dict) -> str:
    haystack = " ".join(str(item.get(k, "") or "") for k in ("category", "source", "headline", "summary", "url")).lower()
    if "press release" in haystack or "press-release" in haystack or "globenewswire" in haystack or "pr newswire" in haystack:
        return "press_release"
    return "news"


def _normalize_finnhub_news(symbol: str, item: dict) -> dict:
    published_ts = item.get("datetime") or 0
    published = datetime.fromtimestamp(published_ts, tz=timezone.utc) if published_ts else _utc_now()
    return {
        "symbol": symbol.upper(),
        "source": "finnhub",
        "source_external_id": str(item.get("id")) if item.get("id") is not None else None,
        "source_name": item.get("source"),
        "category": item.get("category"),
        "document_type": _classify_doc_type(item),
        "title": item.get("headline") or item.get("title") or "",
        "summary": item.get("summary") or "",
        "url": item.get("url"),
        "published_at": published,
        "published": published.isoformat(),
        "raw": item,
    }


def _finnhub_company_news(symbol: str, start: date, end: date) -> list[dict]:
    if not FINNHUB_API_KEY:
        raise HTTPException(status_code=400, detail="FINNHUB_API_KEY is not configured.")
    r = requests.get(
        "https://finnhub.io/api/v1/company-news",
        params={
            "symbol": symbol.upper(),
            "from": start.isoformat(),
            "to": end.isoformat(),
            "token": FINNHUB_API_KEY,
        },
        timeout=20,
    )
    if r.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Finnhub rejected the API key.")
    r.raise_for_status()
    payload = r.json()
    if isinstance(payload, dict) and payload.get("error"):
        raise HTTPException(status_code=502, detail=f"Finnhub error: {payload['error']}")
    if not isinstance(payload, list):
        raise HTTPException(status_code=502, detail="Unexpected Finnhub company-news response.")
    return [_normalize_finnhub_news(symbol, item) for item in payload if item.get("headline") or item.get("summary")]


def _chunk_dates(start: date, end: date, days: int = 30):
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=days - 1), end)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def _store_news_articles(articles: list[dict]) -> dict:
    if not articles or not _ensure_news_schema():
        return {"inserted": 0, "updated": 0}

    from psycopg2.extras import Json

    inserted = 0
    updated = 0
    with _db_conn() as conn:
        with conn.cursor() as cur:
            for a in articles:
                cur.execute("""
                    INSERT INTO news_articles (
                        symbol, source, source_external_id, source_name, category,
                        document_type, title, summary, url, published_at, raw
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (source, source_external_id, symbol)
                    WHERE source_external_id IS NOT NULL
                    DO UPDATE SET
                        source_name = EXCLUDED.source_name,
                        category = EXCLUDED.category,
                        document_type = EXCLUDED.document_type,
                        title = EXCLUDED.title,
                        summary = EXCLUDED.summary,
                        url = EXCLUDED.url,
                        published_at = EXCLUDED.published_at,
                        raw = EXCLUDED.raw
                    RETURNING (xmax = 0) AS inserted
                """, (
                    a["symbol"], a["source"], a.get("source_external_id"),
                    a.get("source_name"), a.get("category"), a.get("document_type", "news"),
                    a.get("title", ""), a.get("summary"), a.get("url"), a.get("published_at"),
                    Json(a.get("raw") or {}),
                ))
                if cur.fetchone()[0]:
                    inserted += 1
                else:
                    updated += 1
    return {"inserted": inserted, "updated": updated}


def _row_to_article(row) -> dict:
    return {
        "id": row[0],
        "symbol": row[1],
        "source": row[2],
        "source_external_id": row[3],
        "source_name": row[4],
        "category": row[5],
        "document_type": row[6],
        "title": row[7],
        "summary": row[8],
        "url": row[9],
        "published": row[10].isoformat(),
        "published_at": row[10].isoformat(),
        "ingested_at": row[11].isoformat(),
    }


def _read_stored_news(symbol: str, limit: int, as_of: datetime) -> list[dict]:
    if not _ensure_news_schema():
        return []
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, symbol, source, source_external_id, source_name, category,
                       document_type, title, summary, url, published_at, ingested_at
                FROM news_articles
                WHERE symbol = %s
                  AND published_at <= %s
                ORDER BY published_at DESC
                LIMIT %s
            """, (symbol.upper(), as_of, limit))
            return [_row_to_article(row) for row in cur.fetchall()]


@app.post("/news/ingest/{symbol}")
async def ingest_symbol_news(
    symbol: str,
    years: int = 3,
    from_date: str | None = None,
    to_date: str | None = None,
    max_chunks: int = 40,
):
    """Backfill Finnhub company news into timestamp-safe storage.

    Uses publish timestamps as the backtest availability boundary. Finnhub plan
    limits still apply; free plans may return a shorter history than requested.
    """
    def _ingest():
        sym = symbol.upper()
        end = _parse_date(to_date, _utc_now().date())
        start = _parse_date(from_date, end - timedelta(days=max(1, years) * 365))
        if start > end:
            raise HTTPException(status_code=400, detail="from_date must be before to_date.")
        if not _ensure_news_schema():
            raise HTTPException(status_code=503, detail="News storage is unavailable.")

        fetched = []
        chunks = list(_chunk_dates(start, end))[:max(1, max_chunks)]
        for chunk_start, chunk_end in chunks:
            fetched.extend(_finnhub_company_news(sym, chunk_start, chunk_end))
        stored = _store_news_articles(fetched)
        return {
            "symbol": sym,
            "source": "finnhub",
            "requested_from": start.isoformat(),
            "requested_to": end.isoformat(),
            "chunks": len(chunks),
            "fetched": len(fetched),
            **stored,
            "note": "Backtests must query with as_of and only use published_at <= decision time.",
        }

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _ingest)


@app.get("/news/features/{symbol}")
async def news_features(symbol: str, as_of: str | None = None, window_days: int = 7):
    def _features():
        sym = symbol.upper()
        end = _parse_as_of(as_of)
        start = end - timedelta(days=max(1, min(window_days, 1_095)))
        if not _ensure_news_schema():
            return {"symbol": sym, "available": False, "error": "news storage unavailable"}
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*)::INT AS article_count,
                        COUNT(*) FILTER (WHERE document_type = 'press_release')::INT AS press_release_count,
                        COUNT(DISTINCT source_name)::INT AS source_count,
                        MAX(published_at) AS latest_published_at
                    FROM news_articles
                    WHERE symbol = %s
                      AND published_at > %s
                      AND published_at <= %s
                """, (sym, start, end))
                count, pr_count, source_count, latest = cur.fetchone()
        return {
            "symbol": sym,
            "available": True,
            "as_of": end.isoformat(),
            "window_days": window_days,
            "article_count": count,
            "press_release_count": pr_count,
            "source_count": source_count,
            "latest_published_at": latest.isoformat() if latest else None,
        }

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _features)


@app.get("/news")
async def get_market_news():
    def _fetch():
        try:
            r = requests.get("https://finance.yahoo.com/news/", timeout=10,
                             headers={"User-Agent": "Mozilla/5.0"})
            soup = BeautifulSoup(r.text, "html.parser")
            articles = []
            for h3 in soup.find_all("h3", limit=15):
                link = h3.find("a")
                if link and link.get("href"):
                    href = link["href"]
                    articles.append({
                        "title":     h3.get_text(strip=True),
                        "url":       "https://finance.yahoo.com" + href if href.startswith("/") else href,
                        "source":    "Yahoo Finance",
                        "published": datetime.now().isoformat(),
                    })
            return articles[:10]
        except Exception as e:
            log.error(f"Market news scrape failed: {e}")
            return []
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch)


@app.get("/fear-greed")
async def get_fear_greed():
    def _fetch():
        cached = _fear_greed_cache.get("current")
        if _cache_is_fresh(cached, _fear_greed_ttl):
            return cached["data"]
        try:
            r = requests.get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
                             headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            r.raise_for_status()
            data = r.json()
            current = data.get("fear_and_greed", {})
            score = current.get("score")
            if score is None:
                raise ValueError("Fear & Greed score missing from response")
            payload = {
                "score":             current.get("score", 50),
                "rating":            current.get("rating", "neutral"),
                "previous_close":    current.get("previous_close"),
                "previous_1_week":   current.get("previous_1_week"),
                "previous_1_month":  current.get("previous_1_month"),
                "timestamp":         current.get("timestamp"),
                "available":         True,
            }
            return _cache_put(_fear_greed_cache, "current", payload)
        except Exception as e:
            log.error(f"Fear & Greed fetch failed: {e}")
            if cached:
                return {**cached["data"], "available": True, "stale": True}
            return {"available": False, "error": str(e)}
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch)


@app.get("/crypto")
async def get_crypto():
    cryptos = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD", "DOGE-USD"]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, _fetch_quote_sync, s) for s in cryptos]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if not isinstance(r, Exception)]


@app.get("/forex")
async def get_forex():
    pairs = ["EURUSD=X", "GBPUSD=X", "USDJPY=X", "USDCAD=X", "AUDUSD=X"]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, _fetch_quote_sync, p) for p in pairs]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if not isinstance(r, Exception)]


@app.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket):
    await websocket.accept()
    symbols = []
    try:
        init = await websocket.receive_json()
        symbols = init.get("symbols", ["AAPL", "NVDA", "MSFT"])
        log.info(f"WebSocket subscribed: {symbols}")
        while True:
            loop = asyncio.get_event_loop()
            tasks = [loop.run_in_executor(executor, _fetch_quote_sync, s) for s in symbols]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            payload = {s: r for s, r in zip(symbols, results) if not isinstance(r, Exception)}
            await websocket.send_json({"type": "QUOTES", "data": payload, "ts": datetime.now().isoformat()})
            await asyncio.sleep(3)
    except WebSocketDisconnect:
        log.info("WebSocket disconnected")
    except Exception as e:
        log.error(f"WebSocket error: {e}")


@app.get("/earnings/{symbol}")
async def get_earnings_date(symbol: str):
    """Return the next earnings date and days until it for catalyst-risk scoring."""
    def _fetch():
        from datetime import date
        ticker = yf.Ticker(symbol.upper())
        try:
            cal = ticker.calendar
            if cal is not None and not cal.empty:
                ed_col = [c for c in cal.columns if "Earnings Date" in str(c)]
                if ed_col:
                    ed_val = cal[ed_col[0]].iloc[0]
                    if hasattr(ed_val, "date"):
                        days_out = (ed_val.date() - date.today()).days
                        return {
                            "symbol":          symbol.upper(),
                            "nextEarningsDate": str(ed_val.date()),
                            "daysOut":          days_out,
                            "catalystRisk":     days_out <= 14 if days_out is not None else False,
                            "catalystLabel":    f"Earnings in {days_out}d" if days_out is not None and days_out >= 0 else "Earnings passed",
                        }
        except Exception as e:
            log.warning(f"Earnings date fetch failed for {symbol}: {e}")
        return {"symbol": symbol.upper(), "nextEarningsDate": None, "daysOut": None, "catalystRisk": False}
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch)


@app.get("/intraday/{symbol}/rvol")
async def get_intraday_rvol(symbol: str, sessions: int = 14):
    """
    Compute first-5-minute relative volume for the opening RVOL scanner.

    Returns:
        symbol, openRvol, openRangeHigh, openRangeLow, breakoutDirection,
        followThrough, price, riskFlags
    """
    try:
        import yfinance as yf
        from datetime import datetime
        from zoneinfo import ZoneInfo
        import statistics

        tk = yf.Ticker(symbol.upper())

        # Try to gather enough 5-minute sessions for a stable RVOL baseline.
        hist_5m = tk.history(period="60d", interval="5m")
        if hist_5m.empty:
            hist_5m = tk.history(period="5d", interval="5m")
        if hist_5m.empty:
            return {"symbol": symbol, "error": "No intraday data available"}

        # Group bars by trading date
        hist_5m.index = hist_5m.index.tz_convert("America/New_York") if hist_5m.index.tz else hist_5m.index
        hist_5m["date"] = hist_5m.index.date
        dates = sorted(hist_5m["date"].unique())

        # Collect opening (9:30–9:35) bars per session
        opening_vols = []
        for d in dates:
            day_bars = hist_5m[hist_5m["date"] == d]
            if day_bars.empty:
                continue
            # First bar of the session
            first_bar = day_bars.iloc[0]
            opening_vols.append(float(first_bar["Volume"]))

        if len(opening_vols) < 2:
            return {"symbol": symbol, "error": "Insufficient intraday history"}

        # Average opening volume over prior sessions (exclude today's if market open)
        today = datetime.now(ZoneInfo("America/New_York")).date()
        today_bars = hist_5m[hist_5m["date"] == today] if today in dates else None
        prior_vols = opening_vols[:-1] if (today_bars is not None and not today_bars.empty) else opening_vols
        if not prior_vols:
            prior_vols = opening_vols

        avg_open_vol = statistics.mean(prior_vols[-sessions:]) if prior_vols else 1
        current_open_vol = opening_vols[-1] if opening_vols else 0
        open_rvol = round(current_open_vol / avg_open_vol, 2) if avg_open_vol > 0 else 0

        # Opening range high/low (first bar of latest session)
        latest_date = dates[-1]
        latest_day = hist_5m[hist_5m["date"] == latest_date]
        first_bar_latest = latest_day.iloc[0]
        or_high = float(first_bar_latest["High"])
        or_low  = float(first_bar_latest["Low"])

        # Breakout direction: check second bar if available
        breakout_direction = "INSIDE"
        follow_through = False
        if len(latest_day) > 1:
            second_bar = latest_day.iloc[1]
            if float(second_bar["Close"]) > or_high:
                breakout_direction = "UP"
                follow_through = len(latest_day) > 2 and float(latest_day.iloc[2]["Close"]) > or_high
            elif float(second_bar["Close"]) < or_low:
                breakout_direction = "DOWN"
                follow_through = len(latest_day) > 2 and float(latest_day.iloc[2]["Close"]) < or_low

        # Current price
        current_price = float(latest_day.iloc[-1]["Close"]) if not latest_day.empty else 0

        # ATR(14) filter using daily data
        atr_value = None
        try:
            daily = tk.history(period="1mo", interval="1d")
            if len(daily) >= 14:
                tr_list = []
                for i in range(1, len(daily)):
                    high = float(daily["High"].iloc[i])
                    low  = float(daily["Low"].iloc[i])
                    prev_close = float(daily["Close"].iloc[i - 1])
                    tr_list.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
                atr_value = round(sum(tr_list[-14:]) / 14, 2)
        except Exception:
            pass

        # Risk flags
        risk_flags = []
        info = {}
        try:
            info = tk.fast_info
        except Exception:
            pass
        avg_vol = getattr(info, "three_month_average_volume", None) or getattr(info, "volume", None)
        if avg_vol and avg_vol < 1_500_000:
            risk_flags.append("Low average volume (<1.5M)")
        if current_price < 5:
            risk_flags.append("Price below $5")
        if open_rvol < 1.5:
            risk_flags.append("RVOL below 1.5× threshold")
        if atr_value is not None and current_price > 0 and (atr_value / current_price) < 0.01:
            risk_flags.append(f"Low ATR ({atr_value:.2f}) — limited intraday range")

        return {
            "symbol":           symbol.upper(),
            "openRvol":         open_rvol,
            "openRangeHigh":    round(or_high, 2),
            "openRangeLow":     round(or_low, 2),
            "breakoutDirection": breakout_direction,
            "followThrough":    follow_through,
            "price":            round(current_price, 2),
            "avgOpenVolume":    round(avg_open_vol),
            "currentOpenVolume": round(current_open_vol),
            "sessionsUsed":     len(prior_vols[-sessions:]),
            "riskFlags":        risk_flags,
            "atr14":            atr_value,
        }
    except Exception as e:
        log.error(f"Intraday RVOL error for {symbol}: {e}")
        return {"symbol": symbol, "error": str(e)}


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "alphawealth-live-data",
        "data_source": "yfinance",
        "finnhub_configured": bool(FINNHUB_API_KEY),
        "news_storage": "ready" if _ensure_news_schema() else "unavailable",
    }


@app.get("/")
def root():
    return {
        "service": "AlphaWealth Live Data Service",
        "version": "1.1.0",
        "endpoints": [
            "GET  /quote/{symbol}",
            "GET  /quotes?symbols=AAPL,NVDA",
            "GET  /history/{symbol}?period=1mo&interval=1d",
            "GET  /api/marketdata/candles/{symbol}        (analysis-svc bridge)",
            "GET  /api/marketdata/candles/{symbol}/weekly (multi-timeframe bridge)",
            "GET  /company/{symbol}",
            "GET  /movers", "GET  /indices", "GET  /sectors",
            "GET  /news/{symbol}?as_of=YYYY-MM-DD&stored_only=false",
            "POST /news/ingest/{symbol}?years=3",
            "GET  /news/features/{symbol}?as_of=YYYY-MM-DD&window_days=7",
            "GET  /news",
            "GET  /fear-greed", "GET  /crypto", "GET  /forex",
            "WS   /ws/quotes",
        ]
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8096)
