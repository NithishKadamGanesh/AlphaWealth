# AlphaTrade Research Workspace

This workspace is for quantitative research, data exploration, and strategy prototyping without coupling experiments to the Java services.

## Tooling

- Python 3.11+
- NumPy / Pandas / SciPy for numerical workflows
- Numba for accelerated research loops
- Matplotlib for quick visualization
- PyArrow for efficient parquet-based datasets

## Quick start

```bash
cd python-research
python -m venv .venv
.venv\Scripts\activate
pip install -e .
python -m alphatrade_research.examples.sma_backtest
```

## Intended workflow

1. Pull or export candles/trades from platform services.
2. Prototype indicators and strategy logic in Python.
3. Validate assumptions and tune parameters offline.
4. Promote stable logic back into platform services or a future production engine.

## Timestamp-safe news features

After `live-data-svc` and `sentiment-svc` are running, research code can pull
leakage-guarded news/sentiment rows:

```python
from alphatrade_research.news_features import feature_row

row = feature_row("AAPL", as_of="2025-01-01", window_days=30)
print(row)
```

These helpers call the platform services with `published_at <= as_of`, so future
articles are excluded before FinBERT scoring.
