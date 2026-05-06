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
from datetime import datetime
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
import uvicorn

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="AlphaWealth Live Data Service", version="1.0.0")
app.add_middleware(CORSMiddleware,
                   allow_origins=["*"],
                   allow_methods=["*"],
                   allow_headers=["*"])

executor = ThreadPoolExecutor(max_workers=8)
_quote_cache: dict = {}
_cache_ttl = 5  # seconds


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

def _fetch_quote_sync(symbol: str) -> dict:
    cache_key = f"quote:{symbol}"
    cached = _quote_cache.get(cache_key)
    if cached and (datetime.now() - cached["fetched"]).seconds < _cache_ttl:
        return cached["data"]

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        hist = ticker.history(period="2d", interval="1d")
        if hist.empty:
            raise ValueError(f"No data for {symbol}")

        prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else float(hist["Close"].iloc[-1])
        last_close = float(hist["Close"].iloc[-1])
        current = info.get("regularMarketPrice", last_close)
        change = current - prev_close
        change_pct = (change / prev_close) * 100 if prev_close else 0

        data = {
            "symbol":      symbol.upper(),
            "price":       round(current, 2),
            "change":      round(change, 2),
            "change_pct":  round(change_pct, 2),
            "open":        round(float(hist["Open"].iloc[-1]), 2),
            "high":        round(float(hist["High"].iloc[-1]), 2),
            "low":         round(float(hist["Low"].iloc[-1]), 2),
            "prev_close":  round(prev_close, 2),
            "volume":      int(hist["Volume"].iloc[-1]),
            "market_cap":  info.get("marketCap"),
            "pe_ratio":    info.get("trailingPE"),
            "day_range":   f"{round(float(hist['Low'].iloc[-1]), 2)} - {round(float(hist['High'].iloc[-1]), 2)}",
            "year_range":  f"{round(info.get('fiftyTwoWeekLow', 0), 2)} - {round(info.get('fiftyTwoWeekHigh', 0), 2)}",
            "timestamp":   datetime.now().isoformat(),
        }
        _quote_cache[cache_key] = {"data": data, "fetched": datetime.now()}
        return data
    except Exception as e:
        log.error(f"Failed to fetch {symbol}: {e}")
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found or fetch failed")


@app.get("/quote/{symbol}", response_model=Quote)
async def get_quote(symbol: str):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _fetch_quote_sync, symbol)


@app.get("/quotes")
async def get_multiple_quotes(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",")]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, _fetch_quote_sync, s) for s in syms]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return {s: (r if not isinstance(r, Exception) else {"error": str(r)}) for s, r in zip(syms, results)}


def _bars_for(symbol: str, period: str, interval: str) -> list:
    """Common bar fetcher used by /history, /api/marketdata/candles."""
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period, interval=interval)
    if hist.empty:
        return []
    return [{
        "date":   idx.strftime("%Y-%m-%d"),
        "open":   round(float(row["Open"]), 2),
        "high":   round(float(row["High"]), 2),
        "low":    round(float(row["Low"]), 2),
        "close":  round(float(row["Close"]), 2),
        "volume": int(row["Volume"]),
    } for idx, row in hist.iterrows()]


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
        try:
            r = requests.get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
                             headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            data = r.json()
            current = data.get("fear_and_greed", {})
            return {
                "score":             current.get("score", 50),
                "rating":            current.get("rating", "neutral"),
                "previous_close":    current.get("previous_close"),
                "previous_1_week":   current.get("previous_1_week"),
                "previous_1_month":  current.get("previous_1_month"),
                "timestamp":         current.get("timestamp"),
            }
        except Exception as e:
            log.error(f"Fear & Greed fetch failed: {e}")
            return {"score": 50, "rating": "neutral", "error": str(e)}
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
