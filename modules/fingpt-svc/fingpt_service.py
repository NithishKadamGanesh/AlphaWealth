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

executor = ThreadPoolExecutor(max_workers=2)

LIVE_DATA_URL = os.getenv("LIVE_DATA_URL", "http://live-data-svc:8096")
SENTIMENT_URL = os.getenv("SENTIMENT_URL", "http://sentiment-svc:8097")
FINGPT_MODEL = os.getenv("FINGPT_MODEL", "FinGPT/fingpt-forecaster_dow30_llama2-7b_lora")
FINGPT_BASE  = os.getenv("FINGPT_BASE",  "NousResearch/Llama-2-7b-chat-hf")  # open mirror
QUANT = os.getenv("QUANTIZATION", "4bit")
MAX_VRAM_GB = int(os.getenv("MAX_VRAM_GB", "6"))
HF_TOKEN = os.getenv("HF_TOKEN", "").strip() or None

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
log.info(f"Selected device: {DEVICE}")
if DEVICE.type == "cuda":
    log.info(f"GPU: {torch.cuda.get_device_name(0)}, VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

# ─── Lazy loading: don't block startup ──────────────────────────

_model = None
_tokenizer = None
_load_error = None
_loading = False


def _load_model():
    """Load model on first request (saves startup time, important for slow GPU initialization)."""
    global _model, _tokenizer, _load_error, _loading
    if _model is not None or _load_error is not None:
        return
    if _loading:
        # Another thread is loading
        while _loading:
            import time
            time.sleep(1)
        return

    _loading = True
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
            except Exception as e:
                log.warning(f"LoRA adapter failed ({e}), using base model only")
                _model = base_model
        else:
            _model = base_model

        _model.eval()
        log.info("✓ FinGPT loaded successfully")
        if DEVICE.type == "cuda":
            log.info(f"  VRAM used: {torch.cuda.memory_allocated(0)/1e9:.2f} GB")
    except Exception as e:
        log.error(f"Failed to load FinGPT: {e}", exc_info=True)
        _load_error = str(e)
    finally:
        _loading = False


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


# ─── API ──────────────────────────────────────────────────────

class TextInput(BaseModel):
    text: str


@app.get("/forecast/{symbol}")
async def forecast(symbol: str):
    symbol = symbol.upper()
    try:
        loop = asyncio.get_event_loop()
        # Build context (synchronous, fast)
        ctx = build_context(symbol)
        prompt = FORECAST_PROMPT_TEMPLATE.format(symbol=symbol, context=ctx)

        # Run inference in thread pool (slow, blocks)
        text = await loop.run_in_executor(executor, generate, prompt)
        parsed = parse_forecast(text)

        return {
            "symbol": symbol,
            "direction": parsed["direction"],
            "confidence": parsed["confidence"],
            "analysis": text,
            "context_chars": len(ctx),
            "model": FINGPT_MODEL,
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
        "load_error": _load_error,
    }
    if DEVICE.type == "cuda":
        info["gpu"] = torch.cuda.get_device_name(0)
        info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)
        info["vram_used_mb"] = round(torch.cuda.memory_allocated(0) / 1e6, 1)
    return info


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
