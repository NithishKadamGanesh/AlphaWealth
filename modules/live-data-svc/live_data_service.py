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
import logging
import os
from datetime import datetime
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
        return cached["data"]

    _metric_inc(QUOTE_CACHE_MISSES)
    try:
        data = _quote_from_chart(symbol, _fetch_yahoo_chart(symbol, "5d", "1d"))
        return _cache_put(_quote_cache, cache_key, data)
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
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return {
            "symbol":      symbol.upper(),
            "name":        info.get("longName", info.get("shortName", symbol)),
            "sector":      info.get("sector", "Unknown"),
            "industry":    info.get("industry", "Unknown"),
            "description": (info.get("longBusinessSummary") or "")[:500],
            "employees":   info.get("fullTimeEmployees"),
            "website":     info.get("website"),
            "country":     info.get("country"),
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
async def get_news(symbol: str):
    def _fetch():
        try:
            ticker = yf.Ticker(symbol)
            news = ticker.news[:10]
            return [{
                "title":     n.get("title", ""),
                "source":    n.get("publisher", "Yahoo Finance"),
                "url":       n.get("link", ""),
                "published": datetime.fromtimestamp(n.get("providerPublishTime", 0)).isoformat(),
                "summary":   (n.get("summary", "") or "")[:300],
            } for n in news]
        except Exception as e:
            log.error(f"News fetch failed for {symbol}: {e}")
            return []
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch)


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


@app.get("/health")
def health():
    return {"status": "healthy", "service": "alphawealth-live-data", "data_source": "yfinance"}


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
            "GET  /news/{symbol}", "GET  /news",
            "GET  /fear-greed", "GET  /crypto", "GET  /forex",
            "WS   /ws/quotes",
        ]
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8096)
