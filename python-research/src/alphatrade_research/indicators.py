from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=window, min_periods=window).mean()


def ema(series: pd.Series, window: int) -> pd.Series:
    return series.ewm(span=window, adjust=False, min_periods=window).mean()


def crossover_signal(close: pd.Series, fast: int = 20, slow: int = 50) -> pd.Series:
    fast_sma = sma(close, fast)
    slow_sma = sma(close, slow)
    signal = (fast_sma > slow_sma).astype("int8")
    return signal.diff().fillna(0).astype("int8")


def rsi(series: pd.Series, window: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(window=window, min_periods=window).mean()
    loss = (-delta.clip(upper=0)).rolling(window=window, min_periods=window).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - (100 / (1 + rs))).fillna(50)


def lorentzian_classification(
    close: pd.Series,
    volume: pd.Series | None = None,
    lookback: int = 60,
    neighbors: int = 8,
    horizon: int = 4,
) -> pd.Series:
    """Leakage-safe Lorentzian nearest-neighbor score in [-1, 1].

    At bar t, neighbors are drawn only from states whose horizon label is already
    historically known, so research backtests do not peek past t.
    """
    close = close.astype(float)
    if volume is None:
        volume = pd.Series(1.0, index=close.index)
    volume = volume.astype(float)

    features = pd.DataFrame({
        "ret_1": close.pct_change(1),
        "ret_3": close.pct_change(3),
        "ret_10": close.pct_change(10),
        "rsi_14": rsi(close, 14) / 100.0,
        "volume_ratio": (volume / volume.rolling(5, min_periods=5).mean()) - 1.0,
    }, index=close.index).replace([np.inf, -np.inf], np.nan)

    scores = pd.Series(np.nan, index=close.index, dtype="float64")
    min_idx = max(lookback, 30)
    for idx in range(min_idx, len(close)):
        current = features.iloc[idx]
        if current.isna().any():
            continue
        start = max(15, idx - lookback)
        end = idx - horizon
        candidates = []
        for j in range(start, end + 1):
            candidate = features.iloc[j]
            if candidate.isna().any():
                continue
            label = np.sign(close.iloc[j + horizon] - close.iloc[j])
            if label == 0:
                continue
            distance = np.log1p(np.abs(current - candidate)).sum()
            candidates.append((distance, label))
        if not candidates:
            continue
        nearest = sorted(candidates, key=lambda item: item[0])[:neighbors]
        weights = np.array([1.0 / (1.0 + item[0]) for item in nearest], dtype="float64")
        labels = np.array([item[1] for item in nearest], dtype="float64")
        scores.iloc[idx] = float((weights * labels).sum() / weights.sum())

    return scores
