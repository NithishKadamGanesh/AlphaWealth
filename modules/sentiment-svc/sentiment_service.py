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

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="AlphaWealth Sentiment Service", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

executor = ThreadPoolExecutor(max_workers=4)
LIVE_DATA_URL = os.getenv("LIVE_DATA_URL", "http://live-data-svc:8096")

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
    inputs = tokenizer(texts, return_tensors="pt", truncation=True, max_length=512, padding=True)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)

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
async def score_symbol(symbol: str):
    try:
        r = requests.get(f"{LIVE_DATA_URL}/news/{symbol}", timeout=10)
        if r.status_code != 200:
            raise HTTPException(404, f"No news for {symbol}")
        articles = r.json()
        if not articles:
            return {"symbol": symbol.upper(), "articles": [], "aggregated": None}

        texts = [a.get("title", "") + " " + (a.get("summary") or "")[:200] for a in articles]
        loop = asyncio.get_event_loop()
        scores = await loop.run_in_executor(executor, classify_batch, texts)

        scored_articles = []
        total_score = 0.0
        weight_sum = 0.0

        for a, s in zip(articles, scores):
            scored_articles.append({
                "title":     a.get("title"),
                "source":    a.get("source"),
                "url":       a.get("url"),
                "published": a.get("published"),
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

        return {
            "symbol": symbol.upper(),
            "articles": scored_articles,
            "aggregated": {
                "label": aggregated_label,
                "score": round(aggregated_score, 4),
                "article_count": len(articles),
                "positive_count": pos_count,
                "negative_count": neg_count,
                "neutral_count": neu_count,
                "computed_at": datetime.now().isoformat(),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Symbol sentiment failed for {symbol}: {e}")
        raise HTTPException(500, str(e))


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


@app.get("/sentiment/portfolio")
async def score_portfolio(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    results = {}
    for sym in syms[:10]:
        try:
            r = requests.get(f"{LIVE_DATA_URL}/news/{sym}", timeout=5)
            if r.status_code == 200:
                articles = r.json()[:5]
                if articles:
                    texts = [a.get("title", "") for a in articles]
                    scores = classify_batch(texts)
                    avg = sum(s["score"] for s in scores) / len(scores)
                    results[sym] = {
                        "score": round(avg, 4),
                        "label": "positive" if avg > 0.1 else "negative" if avg < -0.1 else "neutral",
                        "article_count": len(articles)
                    }
                else:
                    results[sym] = {"score": 0, "label": "neutral", "article_count": 0}
            else:
                results[sym] = {"score": 0, "label": "neutral", "error": "no_news"}
        except Exception as e:
            results[sym] = {"score": 0, "label": "neutral", "error": str(e)}
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
            "GET  /sentiment/symbol/{symbol}         Symbol news sentiment",
            "GET  /sentiment/feed                    Market feed sentiment",
            "GET  /sentiment/portfolio?symbols=X,Y   Multi-symbol",
        ]
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8097)
