"""
modules/fingpt-svc/fingpt_service.py

FinGPT-Forecaster microservice for stock-movement forecasting.

Architecture: FinGPT publishes LoRA adapters fine-tuned on top of Llama-2 7B.
We load the base model + LoRA adapter, quantize to 4-bit (bnb_nf4) for VRAM efficiency.
On RTX 2080 SUPER 8GB: ~5-6GB VRAM, ~3-5s per inference.

Endpoint /forecast/{symbol} fetches:
  - Recent price action (live-data-svc)
  - News sentiment (sentiment-svc, FinBERT)
  - Basic indicators
Then prompts FinGPT-Forecaster for next-week movement prediction.

Models supported (selected via env FINGPT_MODE):
  - "forecaster": FinGPT/fingpt-forecaster_dow30_llama2-7b_lora (default, true forecasting)
  - "sentiment":  FinGPT/fingpt-sentiment_llama2-13b_lora (alternative sentiment)
  - "fallback":   Plain Llama-2-7b-chat with structured prompting (no LoRA, simpler)

If the gated Llama-2 base can't be loaded (no HF token), automatically falls back
to the open Llama-2 base alternative (NousResearch/Llama-2-7b-chat-hf which is mirror).
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import logging
import os
import json
import requests
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import uvicorn

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="AlphaWealth FinGPT Service", version="1.0.0")
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

    FORECASTS_TOTAL = Counter("fingpt_forecasts_total", "Total forecast requests served")
    FORECAST_SECONDS = Histogram(
        "fingpt_forecast_seconds",
        "End-to-end forecast latency (s)",
        buckets=(1, 2, 5, 10, 20, 30, 60, 120),
    )

    Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    log.info("Prometheus metrics exposed at /metrics")
except Exception as e:  # pragma: no cover
    log.warning(f"Prometheus instrumentation unavailable: {e}")
    FORECASTS_TOTAL = FORECAST_SECONDS = None

executor = ThreadPoolExecutor(max_workers=2)

LIVE_DATA_URL = os.getenv("LIVE_DATA_URL", "http://live-data-svc:8096")
SENTIMENT_URL = os.getenv("SENTIMENT_URL", "http://sentiment-svc:8097")
FINGPT_MODEL = os.getenv("FINGPT_MODEL", "FinGPT/fingpt-forecaster_dow30_llama2-7b_lora")
FINGPT_BASE  = os.getenv("FINGPT_BASE",  "NousResearch/Llama-2-7b-chat-hf")  # open mirror
QUANT = os.getenv("QUANTIZATION", "4bit")
MAX_VRAM_GB = int(os.getenv("MAX_VRAM_GB", "6"))
HF_TOKEN = os.getenv("HF_TOKEN", "").strip() or None
ALLOW_CPU_FINGPT = os.getenv("ALLOW_CPU_FINGPT", "").lower() in ("1", "true", "yes")

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
log.info(f"Selected device: {DEVICE}")
if DEVICE.type == "cuda":
    log.info(f"GPU: {torch.cuda.get_device_name(0)}, VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

# ─── Lazy loading: don't block startup ──────────────────────────

import threading

_model = None
_tokenizer = None
_load_error = None
_loading = False
_lora_loaded = False  # tracks whether the fine-tuned LoRA adapter is actually in use
_lora_error = None    # short string if the LoRA load failed (visible in /health)
_load_lock = threading.Lock()
_load_ready_event = threading.Event()

# Whether to warm the model up at boot. Defaults to False because cold-loading
# blocks the FastAPI worker for several seconds, but operators who want a
# predictable first-request latency can set FINGPT_WARMUP=1.
WARMUP = os.getenv("FINGPT_WARMUP", "").lower() in ("1", "true", "yes")


def _load_model():
    """Load model on first request (saves startup time, important for slow GPU initialization)."""
    global _model, _tokenizer, _load_error, _loading, _lora_loaded, _lora_error
    if _model is not None or _load_error is not None:
        return
    # Acquire the lock; if another thread is already loading we just wait
    # for the ready-event instead of busy-spinning on time.sleep.
    with _load_lock:
        if _model is not None or _load_error is not None:
            return
        if _loading:
            # Another thread crossed the threshold between our two checks; defer
            # to its completion below.
            pass
        else:
            _loading = True

    if _loading and _model is None and _load_error is None:
        try:
            log.info(f"Loading FinGPT base model: {FINGPT_BASE}")
            log.info(f"Quantization: {QUANT}")

            _tokenizer = AutoTokenizer.from_pretrained(FINGPT_BASE, token=HF_TOKEN)
            if _tokenizer.pad_token is None:
                _tokenizer.pad_token = _tokenizer.eos_token

            if QUANT == "4bit" and DEVICE.type == "cuda":
                bnb_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                )
                base_model = AutoModelForCausalLM.from_pretrained(
                    FINGPT_BASE,
                    quantization_config=bnb_config,
                    device_map="auto",
                    token=HF_TOKEN,
                    max_memory={0: f"{MAX_VRAM_GB}GiB"},
                )
            else:
                base_model = AutoModelForCausalLM.from_pretrained(
                    FINGPT_BASE,
                    torch_dtype=torch.float16 if DEVICE.type == "cuda" else torch.float32,
                    device_map="auto" if DEVICE.type == "cuda" else None,
                    token=HF_TOKEN,
                )

            # Apply FinGPT LoRA adapter if specified
            if FINGPT_MODEL and "lora" in FINGPT_MODEL.lower():
                try:
                    from peft import PeftModel
                    log.info(f"Applying LoRA adapter: {FINGPT_MODEL}")
                    _model = PeftModel.from_pretrained(base_model, FINGPT_MODEL, token=HF_TOKEN)
                    _lora_loaded = True
                    log.info("✓ LoRA adapter active — forecasts use fine-tuned weights")
                except Exception as e:
                    _lora_error = str(e)
                    log.warning(
                        "LoRA adapter FAILED to load (%s). Falling back to base Llama-2; "
                        "forecast quality WILL BE DEGRADED. Set HF_TOKEN if the adapter is gated.",
                        e,
                    )
                    _model = base_model
                    _lora_loaded = False
            else:
                _model = base_model
                _lora_loaded = False
                log.info("FINGPT_MODEL does not name a LoRA — using bare base model")

            _model.eval()
            log.info("✓ FinGPT loaded successfully (lora_loaded=%s)", _lora_loaded)
            if DEVICE.type == "cuda":
                log.info(f"  VRAM used: {torch.cuda.memory_allocated(0)/1e9:.2f} GB")
        except Exception as e:
            log.error(f"Failed to load FinGPT: {e}", exc_info=True)
            _load_error = str(e)
        finally:
            _loading = False
            _load_ready_event.set()
    else:
        # Wait for the in-flight loader, with a generous timeout so we never block forever.
        _load_ready_event.wait(timeout=600)


# ─── Forecasting prompt (FinGPT-Forecaster format) ──────────────

FORECAST_PROMPT_TEMPLATE = """[INST] You are an expert financial analyst with deep market knowledge.

Analyze {symbol} and predict its next-week price movement. Use this data:

{context}

Based on the above data, provide:
1. **Direction**: BULLISH, BEARISH, or NEUTRAL
2. **Confidence**: 0-100%
3. **Reasoning**: 2-3 sentences citing specific data points
4. **Key risks**: top 1-2 risk factors
5. **Price target**: rough next-week range (low to high)

Be specific. Cite actual numbers from the data. Avoid generic advice.
[/INST]"""


def build_context(symbol: str) -> str:
    """Gather price history, sentiment, indicators for the prompt."""
    parts = []

    # Recent price action (5 days)
    try:
        r = requests.get(f"{LIVE_DATA_URL}/history/{symbol}?period=5d&interval=1d", timeout=8)
        if r.ok:
            bars = r.json().get("bars", [])
            if bars:
                parts.append("## Recent Price Action (last 5 days)")
                for b in bars[-5:]:
                    parts.append(f"- {b.get('date', '?')}: O={b.get('open'):.2f}, H={b.get('high'):.2f}, L={b.get('low'):.2f}, C={b.get('close'):.2f}, Vol={b.get('volume', 0):,}")
                first_close = bars[0].get("close", 0)
                last_close = bars[-1].get("close", 0)
                if first_close > 0:
                    pct = (last_close / first_close - 1) * 100
                    parts.append(f"- 5-day change: {pct:+.2f}%")
                parts.append("")
    except Exception as e:
        log.warning(f"Price fetch failed for {symbol}: {e}")

    # Current quote
    try:
        r = requests.get(f"{LIVE_DATA_URL}/quotes?symbols={symbol}", timeout=5)
        if r.ok:
            q = r.json().get(symbol, {})
            if q and not q.get("error"):
                parts.append(f"## Current Quote\n- Price: ${q.get('price', 0):.2f}, Day change: {q.get('change_pct', 0):+.2f}%\n")
    except Exception as e:
        log.warning(f"Quote fetch failed: {e}")

    # FinBERT sentiment
    try:
        r = requests.get(f"{SENTIMENT_URL}/sentiment/symbol/{symbol}", timeout=15)
        if r.ok:
            data = r.json()
            agg = data.get("aggregated") or {}
            if agg:
                parts.append("## News Sentiment (FinBERT, last 5 articles)")
                parts.append(f"- Aggregate: {agg.get('label', '?').upper()} (score {agg.get('score', 0):+.2f})")
                parts.append(f"- Distribution: {agg.get('positive_count', 0)} positive, {agg.get('negative_count', 0)} negative, {agg.get('neutral_count', 0)} neutral")
                # Top 3 headlines with sentiment
                articles = data.get("articles", [])[:3]
                if articles:
                    parts.append("- Top headlines:")
                    for a in articles:
                        sent = a.get("sentiment", {})
                        parts.append(f"  · [{sent.get('label', '?')[:3]}] {a.get('title', '?')[:100]}")
                parts.append("")
    except Exception as e:
        log.warning(f"Sentiment fetch failed: {e}")

    return "\n".join(parts) if parts else "(insufficient data)"


def generate(prompt: str, max_new_tokens: int = 400) -> str:
    """Run FinGPT inference."""
    if DEVICE.type != "cuda" and not ALLOW_CPU_FINGPT:
        raise RuntimeError(
            "FinGPT 7B is disabled on CPU-only Docker because it exceeds the available memory. "
            "Set ALLOW_CPU_FINGPT=1 and increase Docker memory if you want to force it."
        )
    _load_model()
    if _load_error:
        raise RuntimeError(f"FinGPT not available: {_load_error}")
    if _model is None:
        raise RuntimeError("FinGPT model failed to load")

    inputs = _tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
    inputs = {k: v.to(_model.device) for k, v in inputs.items()}

    with torch.no_grad():
        out = _model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            repetition_penalty=1.1,
            pad_token_id=_tokenizer.eos_token_id,
        )

    decoded = _tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return decoded.strip()


def parse_forecast(text: str) -> dict:
    """Try to parse direction/confidence from generated text. Best effort."""
    upper = text.upper()
    direction = "NEUTRAL"
    if "BULLISH" in upper and "BEARISH" not in upper.split("BULLISH")[0][-50:]:
        direction = "BULLISH"
    elif "BEARISH" in upper:
        direction = "BEARISH"

    # Try to extract confidence percentage
    import re
    confidence = 50
    m = re.search(r"confidence[:\s]+(\d{1,3})", text, re.IGNORECASE)
    if m:
        try:
            confidence = max(0, min(100, int(m.group(1))))
        except ValueError:
            pass

    return {"direction": direction, "confidence": confidence}


def fallback_forecast(symbol: str, ctx: str) -> dict:
    """CPU-safe forecast from already-computed market and FinBERT context.

    This keeps the UI useful on machines without Docker GPU access while making
    the model provenance explicit. It is intentionally conservative.
    """
    import re

    score = 0.0
    reasons = []

    change_match = re.search(r"5-day change:\s*([+-]?\d+(?:\.\d+)?)%", ctx)
    if change_match:
        change = float(change_match.group(1))
        score += max(-2.0, min(2.0, change / 2.5))
        reasons.append(f"5-day price change is {change:+.2f}%.")

    day_match = re.search(r"Day change:\s*([+-]?\d+(?:\.\d+)?)%", ctx)
    if day_match:
        day_change = float(day_match.group(1))
        score += max(-1.0, min(1.0, day_change / 2.0))
        reasons.append(f"Current session change is {day_change:+.2f}%.")

    sentiment_match = re.search(r"Aggregate:\s*(POSITIVE|NEGATIVE|NEUTRAL).*?score\s*([+-]?\d+(?:\.\d+)?)", ctx, re.I)
    if sentiment_match:
        label = sentiment_match.group(1).upper()
        sentiment_score = float(sentiment_match.group(2))
        if label == "POSITIVE":
            score += 1.25 + max(0.0, sentiment_score)
        elif label == "NEGATIVE":
            score -= 1.25 + abs(min(0.0, sentiment_score))
        reasons.append(f"FinBERT news sentiment is {label.lower()} with score {sentiment_score:+.2f}.")

    if score >= 1.0:
        direction = "BULLISH"
    elif score <= -1.0:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    confidence = int(max(35, min(72, 45 + abs(score) * 9)))
    if not reasons:
        reasons.append("Live price and sentiment context was limited, so the fallback stays neutral.")

    analysis = (
        "CPU fallback forecast because FinGPT 7B cannot safely load in this Docker environment without GPU access. "
        + " ".join(reasons[:3])
        + " Treat this as a lightweight directional estimate until the FinGPT model is available."
    )

    return {
        "symbol": symbol,
        "direction": direction,
        "confidence": confidence,
        "analysis": analysis,
        "context_chars": len(ctx),
        "model": "CPU fallback: price action + FinBERT",
        "lora_loaded": False,
        "lora_error": "FinGPT skipped: CPU-only Docker",
        "fallback": True,
        "computed_at": datetime.now().isoformat(),
    }


# ─── API ──────────────────────────────────────────────────────

class TextInput(BaseModel):
    text: str


@app.get("/forecast/{symbol}")
async def forecast(symbol: str):
    symbol = symbol.upper()
    import time as _time
    _t0 = _time.time()
    try:
        loop = asyncio.get_event_loop()
        # Build context (synchronous, fast)
        ctx = build_context(symbol)
        prompt = FORECAST_PROMPT_TEMPLATE.format(symbol=symbol, context=ctx)

        if DEVICE.type != "cuda" and not ALLOW_CPU_FINGPT:
            return fallback_forecast(symbol, ctx)

        # Run inference in thread pool (slow, blocks)
        text = await loop.run_in_executor(executor, generate, prompt)
        parsed = parse_forecast(text)
        if FORECASTS_TOTAL is not None:
            try:
                FORECASTS_TOTAL.inc()
                FORECAST_SECONDS.observe(_time.time() - _t0)
            except Exception:
                pass

        return {
            "symbol": symbol,
            "direction": parsed["direction"],
            "confidence": parsed["confidence"],
            "analysis": text,
            "context_chars": len(ctx),
            "model": FINGPT_MODEL,
            "lora_loaded": _lora_loaded,
            "lora_error": _lora_error,
            "computed_at": datetime.now().isoformat(),
        }
    except Exception as e:
        log.error(f"Forecast failed for {symbol}: {e}")
        raise HTTPException(500, str(e))


@app.post("/analyze")
async def analyze(req: TextInput):
    """Generic financial text analysis with FinGPT."""
    try:
        loop = asyncio.get_event_loop()
        prompt = f"[INST] {req.text} [/INST]"
        text = await loop.run_in_executor(executor, generate, prompt, 300)
        return {"text": text, "model": FINGPT_MODEL}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/health")
def health():
    info = {
        "status": "healthy",
        "service": "alphawealth-fingpt",
        "model": FINGPT_MODEL,
        "base": FINGPT_BASE,
        "device": str(DEVICE),
        "model_loaded": _model is not None,
        "model_loading": _loading,
        "lora_loaded": _lora_loaded,
        "lora_error": _lora_error,
        "load_error": _load_error,
    }
    if DEVICE.type == "cuda":
        info["gpu"] = torch.cuda.get_device_name(0)
        info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)
        info["vram_used_mb"] = round(torch.cuda.memory_allocated(0) / 1e6, 1)
    return info


@app.get("/ready")
def ready():
    """Kubernetes/Compose-style readiness probe.

    Returns 200 only once the model is fully loaded and ready to serve a
    forecast request. Use this instead of /health when you want a strict
    "is the first request going to be fast?" check.
    """
    if _load_error:
        raise HTTPException(503, f"FinGPT load failed: {_load_error}")
    if _model is None:
        raise HTTPException(503, "FinGPT still loading" if _loading else "FinGPT not loaded yet")
    return {
        "ready": True,
        "model_loaded": True,
        "lora_loaded": _lora_loaded,
        "lora_warning": ("Forecasts use base Llama-2 (LoRA failed): " + _lora_error)
                        if _lora_error else None,
    }


@app.on_event("startup")
def _maybe_warmup():
    """If FINGPT_WARMUP is set, kick off model loading in a background thread
    so the first /forecast request hits a warm model. The HTTP server still
    starts immediately — readiness is reported separately via /ready."""
    if WARMUP:
        log.info("FINGPT_WARMUP=1 — preloading model in background thread")
        threading.Thread(target=_load_model, name="fingpt-warmup", daemon=True).start()
    else:
        log.info("Lazy loading enabled — model will load on first /forecast call")


@app.get("/")
def root():
    return {
        "service": "AlphaWealth FinGPT-Forecaster",
        "version": "1.0.0",
        "model": FINGPT_MODEL,
        "base": FINGPT_BASE,
        "device": str(DEVICE),
        "endpoints": [
            "GET  /forecast/{symbol}  Predict next-week movement",
            "POST /analyze            Body: {text} - free-form financial analysis",
            "GET  /health             Service + GPU status",
        ]
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8098)
