from __future__ import annotations

import numpy as np
import pandas as pd

from alphatrade_research.indicators import crossover_signal


def build_sample_frame(rows: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(seed=7)
    noise = rng.normal(0.0008, 0.015, rows)
    price = 100 * np.cumprod(1 + noise)
    return pd.DataFrame({"close": price})


def main() -> None:
    frame = build_sample_frame()
    frame["signal"] = crossover_signal(frame["close"], fast=20, slow=50)
    frame["returns"] = frame["close"].pct_change().fillna(0.0)
    frame["position"] = frame["signal"].replace(-1, 0).replace(1, 1).ffill().fillna(0)
    frame["strategy_returns"] = frame["position"].shift(1).fillna(0) * frame["returns"]

    cumulative = (1 + frame["strategy_returns"]).cumprod().iloc[-1] - 1
    benchmark = (1 + frame["returns"]).cumprod().iloc[-1] - 1

    print("AlphaTrade Research Example")
    print(f"Rows: {len(frame)}")
    print(f"SMA crossover return: {cumulative:.2%}")
    print(f"Buy and hold return: {benchmark:.2%}")


if __name__ == "__main__":
    main()
