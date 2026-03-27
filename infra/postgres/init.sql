-- AlphaTrade Engine schema initialization
-- This runs automatically when Postgres container starts for the first time

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS positions (
    account_id VARCHAR(64) NOT NULL,
    symbol VARCHAR(16) NOT NULL,
    qty INTEGER NOT NULL DEFAULT 0,
    avg_px NUMERIC(18,6) DEFAULT 0,
    realized_pnl NUMERIC(18,6) DEFAULT 0,
    total_buy_qty INTEGER DEFAULT 0,
    total_sell_qty INTEGER DEFAULT 0,
    total_buy_notional NUMERIC(18,6) DEFAULT 0,
    total_sell_notional NUMERIC(18,6) DEFAULT 0,
    PRIMARY KEY (account_id, symbol)
);

CREATE TABLE IF NOT EXISTS trades (
    trade_id VARCHAR(128) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL,
    account_id VARCHAR(64) NOT NULL,
    symbol VARCHAR(16) NOT NULL,
    side VARCHAR(4) NOT NULL,
    qty INTEGER NOT NULL,
    price NUMERIC(18,6) NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_account_symbol_ts ON trades(account_id, symbol, ts);
CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts DESC);
