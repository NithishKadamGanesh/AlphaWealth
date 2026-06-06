"""
Unit tests for the pure helpers in live_data_service.

These avoid any network calls — we feed synthetic Yahoo-chart dicts into the
parsing functions and check the derived quote/bar shapes. Run with:

    cd modules/live-data-svc
    pip install -r requirements.txt pytest
    pytest -q
"""
from datetime import datetime, timedelta

import pytest

# Importing the module is light (no model loads, no network at import time).
import live_data_service as svc


# ─── Cache helpers ────────────────────────────────────────────

def test_cache_is_fresh_true_for_recent_entry():
    entry = {"data": {"x": 1}, "fetched": datetime.now()}
    assert svc._cache_is_fresh(entry, ttl_seconds=5) is True


def test_cache_is_fresh_false_for_stale_entry():
    entry = {"data": {"x": 1}, "fetched": datetime.now() - timedelta(seconds=10)}
    assert svc._cache_is_fresh(entry, ttl_seconds=5) is False


def test_cache_is_fresh_false_for_none():
    assert svc._cache_is_fresh(None, ttl_seconds=5) is False


def test_cache_put_roundtrips_and_stamps():
    cache = {}
    out = svc._cache_put(cache, "k", {"v": 42})
    assert out == {"v": 42}
    assert cache["k"]["data"] == {"v": 42}
    assert isinstance(cache["k"]["fetched"], datetime)


# ─── Chart → bars / quote parsing ─────────────────────────────

def _synthetic_chart(closes, prev_close=None, market_price=None):
    """Build a minimal Yahoo v8 chart 'result' dict for N daily bars."""
    n = len(closes)
    base_ts = int(datetime(2024, 1, 1).timestamp())
    timestamps = [base_ts + i * 86400 for i in range(n)]
    return {
        "timestamp": timestamps,
        "indicators": {
            "quote": [{
                "open":  [c - 1 for c in closes],
                "high":  [c + 2 for c in closes],
                "low":   [c - 2 for c in closes],
                "close": list(closes),
                "volume": [1_000_000] * n,
            }]
        },
        "meta": {
            "chartPreviousClose": prev_close,
            "regularMarketPrice": market_price,
            "regularMarketVolume": 2_000_000,
            "fiftyTwoWeekLow": min(closes) - 5,
            "fiftyTwoWeekHigh": max(closes) + 5,
        },
    }


def test_bars_from_chart_basic_shape():
    chart = _synthetic_chart([100, 101, 102])
    bars = svc._bars_from_chart(chart, "1d")
    assert len(bars) == 3
    assert bars[0]["close"] == 100
    assert bars[-1]["high"] == 104  # 102 + 2
    assert all({"date", "open", "high", "low", "close", "volume"} <= set(b) for b in bars)


def test_bars_from_chart_skips_null_rows():
    chart = _synthetic_chart([100, 101, 102])
    chart["indicators"]["quote"][0]["close"][1] = None  # middle row incomplete
    bars = svc._bars_from_chart(chart, "1d")
    assert len(bars) == 2  # the null close row is dropped


def test_quote_from_chart_computes_change_vs_prev_close():
    # prev_close=100, market price=110 → change +10, +10%
    chart = _synthetic_chart([105, 110], prev_close=100, market_price=110)
    q = svc._quote_from_chart("aapl", chart)
    assert q["symbol"] == "AAPL"
    assert q["price"] == 110.0
    assert q["change"] == pytest.approx(10.0, abs=0.01)
    assert q["change_pct"] == pytest.approx(10.0, abs=0.01)


def test_quote_from_chart_falls_back_to_prev_bar_when_prev_close_missing():
    # No chartPreviousClose → use the prior bar's close (105) as prev.
    chart = _synthetic_chart([105, 120], prev_close=None, market_price=120)
    q = svc._quote_from_chart("msft", chart)
    assert q["prev_close"] == 105.0
    assert q["change"] == pytest.approx(15.0, abs=0.01)


def test_quote_from_chart_raises_on_empty():
    empty = {"timestamp": [], "indicators": {"quote": [{}]}, "meta": {}}
    with pytest.raises(ValueError):
        svc._quote_from_chart("x", empty)
