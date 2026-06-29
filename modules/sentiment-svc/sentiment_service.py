"""
modules/sentiment-svc/sentiment_service.py
Financial sentiment analysis using FinBERT (ProsusAI/finbert)
Now with CUDA/GPU acceleration when available.

On RTX 2080 SUPER 8GB: ~10ms per article (vs 100ms on CPU)
On CPU only: ~100ms per article (still fine for batch jobs)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import logging
import os
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import asyncio
import requests
import uvicorn
import re

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="AlphaWealth Sentiment Service", version="1.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── API token auth (opt-in: enforced only when API_TOKEN is set) ──
from starlette.responses import JSONResponse
API_TOKEN = os.getenv("API_TOKEN", "").strip()
_AUTH_PUBLIC_PATHS = {"/", "/health", "/ready", "/metrics", "/docs", "/openapi.json", "/redoc"}
if API_TOKEN:
    log.info("API token auth ENABLED")
else:
    log.warning("API_TOKEN not set — auth DISABLED (open access).")


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


# ─── Prometheus metrics (/metrics), guarded ───────────────────
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    from prometheus_client import Counter, Histogram

    ARTICLES_CLASSIFIED = Counter("sentiment_articles_classified_total", "Total articles run through FinBERT")
    SYMBOL_CACHE_HITS = Counter("sentiment_symbol_cache_hits_total", "Symbol sentiment cache hits")
    INFERENCE_SECONDS = Histogram("sentiment_inference_seconds", "FinBERT batch inference latency (s)")

    Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    log.info("Prometheus metrics exposed at /metrics")
except Exception as e:  # pragma: no cover
    log.warning(f"Prometheus instrumentation unavailable: {e}")
    ARTICLES_CLASSIFIED = SYMBOL_CACHE_HITS = INFERENCE_SECONDS = None


def _metric_inc(counter, amount=1):
    if counter is not None:
        try:
            counter.inc(amount)
        except Exception:
            pass

executor = ThreadPoolExecutor(max_workers=4)
LIVE_DATA_URL = os.getenv("LIVE_DATA_URL", "http://live-data-svc:8096")

# In-memory TTL cache for symbol sentiment. Avoids re-fetching news + re-running
# FinBERT on every AI Advisor request — the underlying news feed updates slowly.
import time
_symbol_cache: dict = {}  # cache_key -> (epoch_seconds, payload)
SYMBOL_CACHE_TTL_S = int(os.getenv("SYMBOL_CACHE_TTL_S", "900"))  # 15 min default
SYMBOL_CACHE_MAX = int(os.getenv("SYMBOL_CACHE_MAX", "256"))


def _cache_get(cache_key: str):
    entry = _symbol_cache.get(cache_key)
    if not entry:
        return None
    ts, payload = entry
    if time.time() - ts > SYMBOL_CACHE_TTL_S:
        _symbol_cache.pop(cache_key, None)
        return None
    return payload


def _cache_put(cache_key: str, payload: dict) -> dict:
    if len(_symbol_cache) >= SYMBOL_CACHE_MAX:
        # Evict the oldest entry. Cheap because we expect <300 keys.
        oldest = min(_symbol_cache.items(), key=lambda kv: kv[1][0])[0]
        _symbol_cache.pop(oldest, None)
    _symbol_cache[cache_key] = (time.time(), payload)
    return payload

# ─── GPU detection ────────────────────────────────────────────

USE_CUDA_ENV = os.getenv("USE_CUDA", "auto").lower()
if USE_CUDA_ENV == "auto":
    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
elif USE_CUDA_ENV in ("true", "1", "yes"):
    DEVICE = torch.device("cuda")
else:
    DEVICE = torch.device("cpu")

log.info(f"Selected device: {DEVICE}")
if DEVICE.type == "cuda":
    log.info(f"GPU: {torch.cuda.get_device_name(0)}")
    log.info(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    # FinBERT only uses ~500MB so we won't impact other GPU services much
    torch.cuda.set_per_process_memory_fraction(0.15)  # cap at ~1.2GB on 8GB

# ─── Model loading ────────────────────────────────────────────

MODEL_NAME = os.getenv("FINBERT_MODEL", "ProsusAI/finbert")
log.info(f"Loading {MODEL_NAME}...")

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
model = model.to(DEVICE)
model.eval()

LABEL_MAP = {0: "positive", 1: "negative", 2: "neutral"}

log.info(f"✓ FinBERT loaded on {DEVICE}")


# ─── Inference ────────────────────────────────────────────────

def classify_text(text: str) -> dict:
    if not text or not text.strip():
        return {"label": "neutral", "score": 0.0, "confidence": 0.0,
                "probabilities": {"positive": 0.33, "negative": 0.33, "neutral": 0.34}}

    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512, padding=True)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]

    pred_idx = int(torch.argmax(probs).item())
    label = LABEL_MAP[pred_idx]
    confidence = float(probs[pred_idx].item())
    score = float(probs[0].item()) - float(probs[1].item())

    return {
        "label": label,
        "score": round(score, 4),
        "confidence": round(confidence, 4),
        "probabilities": {
            "positive": round(float(probs[0].item()), 4),
            "negative": round(float(probs[1].item()), 4),
            "neutral":  round(float(probs[2].item()), 4),
        }
    }


def classify_batch(texts: List[str]) -> List[dict]:
    if not texts:
        return []
    _metric_inc(ARTICLES_CLASSIFIED, len(texts))
    _t0 = time.time()
    inputs = tokenizer(texts, return_tensors="pt", truncation=True, max_length=512, padding=True)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
    if INFERENCE_SECONDS is not None:
        try:
            INFERENCE_SECONDS.observe(time.time() - _t0)
        except Exception:
            pass

    results = []
    for p in probs:
        pred_idx = int(torch.argmax(p).item())
        label = LABEL_MAP[pred_idx]
        score = float(p[0].item()) - float(p[1].item())
        results.append({
            "label": label,
            "score": round(score, 4),
            "confidence": round(float(p[pred_idx].item()), 4),
            "probabilities": {
                "positive": round(float(p[0].item()), 4),
                "negative": round(float(p[1].item()), 4),
                "neutral":  round(float(p[2].item()), 4),
            }
        })
    return results


TICKER_RE = re.compile(r"\b[A-Z]{1,5}\b")
FINANCE_KEYWORDS = {
    "earnings", "guidance", "revenue", "profit", "margin", "cash flow",
    "buyback", "dividend", "merger", "acquisition", "lawsuit", "regulator",
    "sec", "fda", "downgrade", "upgrade", "price target", "layoff",
    "partnership", "contract", "debt", "credit", "default", "inflation",
}
COMMON_FALSE_TICKERS = {
    "A", "I", "THE", "AND", "FOR", "WITH", "CEO", "CFO", "SEC", "FDA", "USA",
    "US", "AI", "EV", "ETF", "IPO", "EPS", "GDP",
}


def extract_entities(text: str, primary_symbol: str | None = None) -> dict:
    """Fast, deterministic first-pass entity/keyword extraction.

    This is deliberately lightweight so it can run before heavier NER/LLM work.
    A future spaCy/FinBERT-NER model can replace or augment this without changing
    the response shape.
    """
    text = text or ""
    tickers = {
        t for t in TICKER_RE.findall(text)
        if t not in COMMON_FALSE_TICKERS and (len(t) > 1 or t == primary_symbol)
    }
    if primary_symbol:
        tickers.add(primary_symbol.upper())

    lowered = text.lower()
    keywords = sorted(k for k in FINANCE_KEYWORDS if k in lowered)

    org_matches = re.findall(
        r"\b([A-Z][A-Za-z&.\-]+(?:\s+[A-Z][A-Za-z&.\-]+){0,3}\s+"
        r"(?:Inc|Corp|Corporation|Company|Co|Ltd|PLC|Bank|Group|Holdings))\b",
        text,
    )

    return {
        "tickers": sorted(tickers),
        "organizations": sorted(set(org_matches))[:10],
        "keywords": keywords,
    }


def merge_entities(items: List[dict]) -> dict:
    tickers, orgs, keywords = set(), set(), set()
    for item in items:
        e = item.get("entities") or {}
        tickers.update(e.get("tickers") or [])
        orgs.update(e.get("organizations") or [])
        keywords.update(e.get("keywords") or [])
    return {
        "tickers": sorted(tickers),
        "organizations": sorted(orgs)[:20],
        "keywords": sorted(keywords),
    }


# ─── Models ───────────────────────────────────────────────────

class TextInput(BaseModel):
    text: str

class BatchTextInput(BaseModel):
    texts: List[str]


# ─── Endpoints ────────────────────────────────────────────────

@app.post("/sentiment/text")
async def score_text(req: TextInput):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, classify_text, req.text)


@app.post("/sentiment/batch")
async def score_batch(req: BatchTextInput):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, classify_batch, req.texts)


@app.get("/sentiment/symbol/{symbol}")
async def score_symbol(
    symbol: str,
    refresh: bool = False,
    as_of: str | None = None,
    stored_only: bool = False,
    limit: int = 25,
):
    sym_upper = symbol.upper()
    safe_limit = max(1, min(limit, 100))
    cache_key = f"{sym_upper}|as_of={as_of or 'live'}|stored={stored_only}|limit={safe_limit}"
    if not refresh:
        cached = _cache_get(cache_key)
        if cached:
            _metric_inc(SYMBOL_CACHE_HITS)
            return {**cached, "cached": True}
    try:
        r = requests.get(
            f"{LIVE_DATA_URL}/news/{sym_upper}",
            params={"as_of": as_of, "stored_only": stored_only, "limit": safe_limit},
            timeout=10,
        )
        if r.status_code != 200:
            raise HTTPException(404, f"No news for {symbol}")
        articles = r.json()
        if not articles:
            payload = {"symbol": sym_upper, "as_of": as_of, "articles": [], "aggregated": None}
            return _cache_put(cache_key, payload)

        texts = [a.get("title", "") + " " + (a.get("summary") or "")[:200] for a in articles]
        loop = asyncio.get_event_loop()
        scores = await loop.run_in_executor(executor, classify_batch, texts)

        scored_articles = []
        total_score = 0.0
        weight_sum = 0.0

        for a, s in zip(articles, scores):
            entities = extract_entities(
                " ".join([a.get("title") or "", a.get("summary") or ""]),
                primary_symbol=sym_upper,
            )
            scored_articles.append({
                "title":     a.get("title"),
                "source":    a.get("source"),
                "source_name": a.get("source_name"),
                "url":       a.get("url"),
                "published": a.get("published"),
                "document_type": a.get("document_type", "news"),
                "entities": entities,
                "sentiment": s,
            })
            total_score += s["score"] * s["confidence"]
            weight_sum += s["confidence"]

        aggregated_score = total_score / weight_sum if weight_sum > 0 else 0.0
        if aggregated_score > 0.15: aggregated_label = "positive"
        elif aggregated_score < -0.15: aggregated_label = "negative"
        else: aggregated_label = "neutral"

        pos_count = sum(1 for s in scores if s["label"] == "positive")
        neg_count = sum(1 for s in scores if s["label"] == "negative")
        neu_count = sum(1 for s in scores if s["label"] == "neutral")
        press_release_count = sum(1 for a in articles if a.get("document_type") == "press_release")
        entity_summary = merge_entities(scored_articles)

        payload = {
            "symbol": sym_upper,
            "as_of": as_of,
            "stored_only": stored_only,
            "articles": scored_articles,
            "aggregated": {
                "label": aggregated_label,
                "score": round(aggregated_score, 4),
                "article_count": len(articles),
                "press_release_count": press_release_count,
                "positive_count": pos_count,
                "negative_count": neg_count,
                "neutral_count": neu_count,
                "entities": entity_summary,
                "computed_at": datetime.now().isoformat(),
            }
        }
        return _cache_put(cache_key, payload)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Symbol sentiment failed for {symbol}: {e}")
        raise HTTPException(500, str(e))


@app.get("/sentiment/features/{symbol}")
async def sentiment_features(symbol: str, as_of: str | None = None, window_days: int = 30):
    """Timestamp-safe sentiment features for backtests and research.

    The live-data service performs the published_at <= as_of filter before this
    service scores articles, preventing future news from leaking into a backtest.
    """
    payload = await score_symbol(
        symbol=symbol,
        refresh=False,
        as_of=as_of,
        stored_only=True,
        limit=max(1, min(window_days * 10, 100)),
    )
    agg = payload.get("aggregated") or {}
    return {
        "symbol": symbol.upper(),
        "as_of": as_of,
        "available": bool(agg),
        "sentiment_score": agg.get("score", 0),
        "sentiment_label": agg.get("label", "neutral"),
        "article_count": agg.get("article_count", 0),
        "press_release_count": agg.get("press_release_count", 0),
        "positive_count": agg.get("positive_count", 0),
        "negative_count": agg.get("negative_count", 0),
        "neutral_count": agg.get("neutral_count", 0),
        "entities": agg.get("entities", {"tickers": [], "organizations": [], "keywords": []}),
        "computed_at": agg.get("computed_at", datetime.now().isoformat()),
        "leakage_guard": "published_at <= as_of, stored_only=true",
    }


@app.get("/sentiment/feed")
async def score_feed():
    try:
        r = requests.get(f"{LIVE_DATA_URL}/news", timeout=10)
        if r.status_code != 200:
            return {"articles": [], "aggregated": None}
        articles = r.json()
        if not articles:
            return {"articles": [], "aggregated": None}

        texts = [a.get("title", "") for a in articles]
        loop = asyncio.get_event_loop()
        scores = await loop.run_in_executor(executor, classify_batch, texts)

        scored = []
        for a, s in zip(articles, scores):
            scored.append({**a, "sentiment": s})

        avg = sum(s["score"] for s in scores) / len(scores) if scores else 0
        return {
            "articles": scored,
            "aggregated": {
                "average_score": round(avg, 4),
                "article_count": len(articles),
                "label": "positive" if avg > 0.1 else "negative" if avg < -0.1 else "neutral"
            }
        }
    except Exception as e:
        log.error(f"Feed sentiment failed: {e}")
        return {"articles": [], "aggregated": None, "error": str(e)}


PORTFOLIO_SYMBOL_LIMIT = int(os.getenv("PORTFOLIO_SYMBOL_LIMIT", "10"))
PORTFOLIO_ARTICLES_PER_SYMBOL = int(os.getenv("PORTFOLIO_ARTICLES_PER_SYMBOL", "5"))


@app.get("/sentiment/portfolio")
async def score_portfolio(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    truncated_symbols = []
    if len(syms) > PORTFOLIO_SYMBOL_LIMIT:
        truncated_symbols = syms[PORTFOLIO_SYMBOL_LIMIT:]
        log.warning(
            "Portfolio sentiment: truncating from %d to %d symbols (dropped: %s). "
            "Bump PORTFOLIO_SYMBOL_LIMIT env if needed.",
            len(syms), PORTFOLIO_SYMBOL_LIMIT, ",".join(truncated_symbols),
        )
        syms = syms[:PORTFOLIO_SYMBOL_LIMIT]

    results = {}
    for sym in syms:
        try:
            r = requests.get(f"{LIVE_DATA_URL}/news/{sym}", timeout=5)
            if r.status_code == 200:
                all_articles = r.json()
                articles = all_articles[:PORTFOLIO_ARTICLES_PER_SYMBOL]
                article_truncated = max(0, len(all_articles) - PORTFOLIO_ARTICLES_PER_SYMBOL)
                if articles:
                    texts = [a.get("title", "") for a in articles]
                    scores = classify_batch(texts)
                    avg = sum(s["score"] for s in scores) / len(scores)
                    entry = {
                        "score": round(avg, 4),
                        "label": "positive" if avg > 0.1 else "negative" if avg < -0.1 else "neutral",
                        "article_count": len(articles),
                    }
                    if article_truncated:
                        entry["articles_truncated"] = article_truncated
                    results[sym] = entry
                else:
                    results[sym] = {"score": 0, "label": "neutral", "article_count": 0}
            else:
                results[sym] = {"score": 0, "label": "neutral", "error": "no_news"}
        except Exception as e:
            results[sym] = {"score": 0, "label": "neutral", "error": str(e)}

    # Include a meta block so callers know about silent truncation. Old callers
    # that just read results[sym] keep working — there's no key collision because
    # we use a dunder-style key.
    results["__meta__"] = {
        "requested": len(syms) + len(truncated_symbols),
        "processed": len(syms),
        "symbol_limit": PORTFOLIO_SYMBOL_LIMIT,
        "article_limit_per_symbol": PORTFOLIO_ARTICLES_PER_SYMBOL,
        "truncated_symbols": truncated_symbols,
    }
    return results


@app.get("/health")
def health():
    info = {
        "status": "healthy",
        "service": "alphawealth-sentiment",
        "model": MODEL_NAME,
        "device": str(DEVICE),
    }
    if DEVICE.type == "cuda":
        info["gpu"] = torch.cuda.get_device_name(0)
        info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)
        info["vram_used_mb"] = round(torch.cuda.memory_allocated(0) / 1e6, 1)
    return info


@app.get("/")
def root():
    return {
        "service": "AlphaWealth Sentiment Service",
        "version": "1.1.0",
        "model": MODEL_NAME,
        "device": str(DEVICE),
        "endpoints": [
            "POST /sentiment/text                    Body: {text}",
            "POST /sentiment/batch                   Body: {texts:[]}",
            "GET  /sentiment/symbol/{symbol}         Symbol news sentiment (?as_of=&stored_only=)",
            "GET  /sentiment/features/{symbol}       Timestamp-safe backtest features",
            "GET  /sentiment/feed                    Market feed sentiment",
            "GET  /sentiment/portfolio?symbols=X,Y   Multi-symbol",
        ]
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8097)
