from __future__ import annotations

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
