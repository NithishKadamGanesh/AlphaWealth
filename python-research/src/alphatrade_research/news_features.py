from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen
import json
import os


LIVE_DATA_URL = os.getenv("LIVE_DATA_URL", "http://localhost:8096").rstrip("/")
SENTIMENT_URL = os.getenv("SENTIMENT_URL", "http://localhost:8097").rstrip("/")


@dataclass(frozen=True)
class NewsFeatureRow:
    symbol: str
    as_of: str
    article_count: int
    press_release_count: int
    source_count: int
    sentiment_score: float
    sentiment_label: str
    positive_count: int
    negative_count: int
    neutral_count: int
    keyword_count: int
    ticker_count: int


def _as_iso(value: str | date | datetime) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _get_json(url: str, params: dict[str, Any], timeout: float = 20.0) -> dict[str, Any]:
    query = urlencode({k: v for k, v in params.items() if v is not None})
    with urlopen(f"{url}?{query}", timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_news_features(symbol: str, as_of: str | date | datetime, window_days: int = 30) -> dict[str, Any]:
    """Fetch timestamp-safe article-count features from live-data-svc."""
    return _get_json(
        f"{LIVE_DATA_URL}/news/features/{symbol.upper()}",
        {"as_of": _as_iso(as_of), "window_days": window_days},
    )


def fetch_sentiment_features(symbol: str, as_of: str | date | datetime, window_days: int = 30) -> dict[str, Any]:
    """Fetch timestamp-safe FinBERT/entity features from sentiment-svc."""
    return _get_json(
        f"{SENTIMENT_URL}/sentiment/features/{symbol.upper()}",
        {"as_of": _as_iso(as_of), "window_days": window_days},
    )


def feature_row(symbol: str, as_of: str | date | datetime, window_days: int = 30) -> NewsFeatureRow:
    """Combine news counts and FinBERT/entity features into one research row."""
    news = fetch_news_features(symbol, as_of, window_days)
    sentiment = fetch_sentiment_features(symbol, as_of, window_days)
    entities = sentiment.get("entities") or {}
    return NewsFeatureRow(
        symbol=symbol.upper(),
        as_of=_as_iso(as_of),
        article_count=int(news.get("article_count") or sentiment.get("article_count") or 0),
        press_release_count=int(news.get("press_release_count") or sentiment.get("press_release_count") or 0),
        source_count=int(news.get("source_count") or 0),
        sentiment_score=float(sentiment.get("sentiment_score") or 0.0),
        sentiment_label=str(sentiment.get("sentiment_label") or "neutral"),
        positive_count=int(sentiment.get("positive_count") or 0),
        negative_count=int(sentiment.get("negative_count") or 0),
        neutral_count=int(sentiment.get("neutral_count") or 0),
        keyword_count=len(entities.get("keywords") or []),
        ticker_count=len(entities.get("tickers") or []),
    )
