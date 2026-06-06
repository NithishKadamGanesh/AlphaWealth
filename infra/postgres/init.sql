-- =================================================================
-- AlphaWealth Command Center — full schema initialization
-- Runs automatically on first container start.
-- All time-series tables are TimescaleDB hypertables.
-- =================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─────────────────────────────────────────────────────────────────
-- LEGACY TRADING TABLES (from original alphatrade-engine)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS positions (
    account_id           VARCHAR(64) NOT NULL,
    symbol               VARCHAR(16) NOT NULL,
    qty                  INTEGER     NOT NULL DEFAULT 0,
    avg_px               NUMERIC(18,6) DEFAULT 0,
    realized_pnl         NUMERIC(18,6) DEFAULT 0,
    total_buy_qty        INTEGER DEFAULT 0,
    total_sell_qty       INTEGER DEFAULT 0,
    total_buy_notional   NUMERIC(18,6) DEFAULT 0,
    total_sell_notional  NUMERIC(18,6) DEFAULT 0,
    PRIMARY KEY (account_id, symbol)
);

CREATE TABLE IF NOT EXISTS trades (
    trade_id    VARCHAR(128) PRIMARY KEY,
    order_id    VARCHAR(64)  NOT NULL,
    account_id  VARCHAR(64)  NOT NULL,
    symbol      VARCHAR(16)  NOT NULL,
    side        VARCHAR(4)   NOT NULL,
    qty         INTEGER      NOT NULL,
    price       NUMERIC(18,6) NOT NULL,
    ts          TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_account_symbol_ts ON trades(account_id, symbol, ts);
CREATE INDEX IF NOT EXISTS idx_positions_account        ON positions(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_ts                ON trades(ts DESC);

-- ─────────────────────────────────────────────────────────────────
-- MARKET DATA & SIGNALS (hypertables)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_data (
    ts       TIMESTAMPTZ NOT NULL,
    symbol   VARCHAR(16) NOT NULL,
    open     NUMERIC(18,6),
    high     NUMERIC(18,6),
    low      NUMERIC(18,6),
    close    NUMERIC(18,6),
    volume   BIGINT,
    interval VARCHAR(8)  DEFAULT '1d'
);
SELECT create_hypertable('market_data', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_ts ON market_data(symbol, ts DESC);

CREATE TABLE IF NOT EXISTS technical_signals (
    ts             TIMESTAMPTZ NOT NULL,
    symbol         VARCHAR(16) NOT NULL,
    action         VARCHAR(8),
    confidence     NUMERIC(5,4),
    rsi            NUMERIC(8,4),
    macd           NUMERIC(12,6),
    macd_signal    NUMERIC(12,6),
    bb_pct_b       NUMERIC(6,4),
    sma_20         NUMERIC(18,6),
    sma_50         NUMERIC(18,6),
    atr_14         NUMERIC(12,6),
    raw_signal     JSONB
);
SELECT create_hypertable('technical_signals', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_ts ON technical_signals(symbol, ts DESC);

CREATE TABLE IF NOT EXISTS backtest_results (
    id             BIGSERIAL PRIMARY KEY,
    strategy       VARCHAR(64) NOT NULL,
    symbol         VARCHAR(16) NOT NULL,
    start_date     DATE,
    end_date       DATE,
    total_return   NUMERIC(8,4),
    sharpe_ratio   NUMERIC(8,4),
    max_drawdown   NUMERIC(8,4),
    num_trades     INTEGER,
    config         JSONB,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────
-- IBKR INTEGRATION
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ibkr_positions (
    ts              TIMESTAMPTZ NOT NULL,
    account         VARCHAR(64),
    symbol          VARCHAR(16) NOT NULL,
    sec_type        VARCHAR(16),
    currency        VARCHAR(8),
    exchange        VARCHAR(32),
    position        NUMERIC(18,6),
    avg_cost        NUMERIC(18,6),
    market_price    NUMERIC(18,6),
    market_value    NUMERIC(18,6),
    unrealized_pnl  NUMERIC(18,6),
    realized_pnl    NUMERIC(18,6)
);
SELECT create_hypertable('ibkr_positions', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_ibkr_pos_account_symbol ON ibkr_positions(account, symbol, ts DESC);

CREATE TABLE IF NOT EXISTS ibkr_account_summary (
    ts                    TIMESTAMPTZ NOT NULL,
    account               VARCHAR(64) NOT NULL,
    currency              VARCHAR(8),
    net_liquidation       NUMERIC(18,2),
    total_cash            NUMERIC(18,2),
    buying_power          NUMERIC(18,2),
    gross_position_value  NUMERIC(18,2),
    init_margin_req       NUMERIC(18,2),
    maint_margin_req      NUMERIC(18,2),
    available_funds       NUMERIC(18,2),
    excess_liquidity      NUMERIC(18,2)
);
SELECT create_hypertable('ibkr_account_summary', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_ibkr_acct_ts ON ibkr_account_summary(account, ts DESC);

-- ─────────────────────────────────────────────────────────────────
-- TELLER (BANKING) INTEGRATION
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teller_accounts (
    account_id     VARCHAR(64) PRIMARY KEY,
    institution    VARCHAR(64),
    name           VARCHAR(128),
    type           VARCHAR(32),
    subtype        VARCHAR(32),
    currency       VARCHAR(8),
    last_synced    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teller_balances (
    ts          TIMESTAMPTZ NOT NULL,
    account_id  VARCHAR(64) NOT NULL,
    balance     NUMERIC(18,2),
    available   NUMERIC(18,2),
    currency    VARCHAR(8)
);
SELECT create_hypertable('teller_balances', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_teller_bal_account ON teller_balances(account_id, ts DESC);

CREATE TABLE IF NOT EXISTS teller_transactions (
    transaction_id  VARCHAR(64) PRIMARY KEY,
    account_id      VARCHAR(64) NOT NULL,
    merchant        VARCHAR(256),
    name            VARCHAR(256),
    amount          NUMERIC(18,2),
    category        VARCHAR(64),
    subcategory     VARCHAR(64),
    date            DATE NOT NULL,
    pending         BOOLEAN DEFAULT FALSE,
    currency        VARCHAR(8),
    location        JSONB,
    raw             JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teller_tx_account_date ON teller_transactions(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_teller_tx_category     ON teller_transactions(category);
CREATE INDEX IF NOT EXISTS idx_teller_tx_date         ON teller_transactions(date DESC);

-- ─────────────────────────────────────────────────────────────────
-- NET WORTH AGGREGATION
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS net_worth_snapshots (
    id                 BIGSERIAL,
    timestamp          TIMESTAMPTZ NOT NULL,
    total_assets       NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_liabilities  NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_worth          NUMERIC(18,2) NOT NULL DEFAULT 0,
    cash               NUMERIC(18,2) DEFAULT 0,
    investments        NUMERIC(18,2) DEFAULT 0,
    property           NUMERIC(18,2) DEFAULT 0,
    retirement         NUMERIC(18,2) DEFAULT 0,
    crypto             NUMERIC(18,2) DEFAULT 0,
    other_assets       NUMERIC(18,2) DEFAULT 0,
    PRIMARY KEY (id, timestamp)
);
SELECT create_hypertable('net_worth_snapshots', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_nws_ts ON net_worth_snapshots(timestamp DESC);

CREATE TABLE IF NOT EXISTS manual_assets (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    type        VARCHAR(32),         -- 'property', 'retirement', 'crypto', 'other'
    value       NUMERIC(18,2) NOT NULL,
    as_of_date  DATE DEFAULT CURRENT_DATE,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manual_liabilities (
    id             BIGSERIAL PRIMARY KEY,
    name           VARCHAR(128) NOT NULL,
    type           VARCHAR(32),      -- 'mortgage', 'student-loan', 'auto', 'credit-card', 'other'
    value          NUMERIC(18,2) NOT NULL,
    interest_rate  NUMERIC(6,4),
    as_of_date     DATE DEFAULT CURRENT_DATE,
    notes          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────
-- ALERTS
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_rules (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    type        VARCHAR(32) NOT NULL,    -- 'price_above', 'price_below', 'budget_exceed', 'net_worth_change'
    target      VARCHAR(64),              -- symbol, category, or 'total'
    threshold   NUMERIC(18,4),
    enabled     BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_history (
    id             BIGSERIAL PRIMARY KEY,
    rule_id        BIGINT REFERENCES alert_rules(id) ON DELETE SET NULL,
    message        TEXT,
    current_value  NUMERIC(18,4),
    email_sent     BOOLEAN DEFAULT FALSE,
    triggered_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_history_ts ON alert_history(triggered_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- FIRE & GOALS
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_goals (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    target_value  NUMERIC(18,2),
    target_date   DATE,
    current_value NUMERIC(18,2) DEFAULT 0,
    category      VARCHAR(32),    -- 'fire', 'house', 'emergency-fund', 'travel', 'other'
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fire_scenarios (
    id                    BIGSERIAL PRIMARY KEY,
    name                  VARCHAR(128) NOT NULL,
    current_age           INTEGER,
    annual_income         NUMERIC(18,2),
    annual_expenses       NUMERIC(18,2),
    current_savings       NUMERIC(18,2),
    expected_return       NUMERIC(6,4),  -- e.g., 0.0800 = 8%
    withdrawal_rate       NUMERIC(6,4),  -- e.g., 0.0400 = 4%
    fire_target           NUMERIC(18,2),
    projected_fire_age    INTEGER,
    monte_carlo_results   JSONB,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_categories (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(64) UNIQUE NOT NULL,
    monthly_limit NUMERIC(18,2),
    color         VARCHAR(16),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed reasonable defaults if no budget categories exist yet.
-- These can be edited/deleted via the UI; ON CONFLICT means they're only created on
-- a truly fresh database, not re-inserted on every restart.
INSERT INTO budget_categories (name, monthly_limit, color) VALUES
    ('Housing',       1900, '#7c3aed'),
    ('Groceries',      500, '#06b6d4'),
    ('Transport',      300, '#a3e635'),
    ('Dining',         250, '#ef4444'),
    ('Entertainment',  150, '#f59e0b'),
    ('Utilities',      200, '#2563eb'),
    ('Shopping',       300, '#ec4899'),
    ('Health',         200, '#06b6d4')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────
-- TimescaleDB COMPRESSION & RETENTION POLICIES
--
-- Goal: keep recent data hot for fast reads, compress older chunks (10-20×
-- smaller on disk), and finally drop ancient data we'll never query.
-- All policies are guarded with EXCEPTION WHEN OTHERS so a re-run on an
-- existing DB doesn't fail; the underlying add_*_policy calls are themselves
-- idempotent in modern TimescaleDB, but we wrap defensively for older releases.
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
    -- market_data: compress after 30 days, drop after 5 years.
    BEGIN
        ALTER TABLE market_data SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_compression_policy('market_data', INTERVAL '30 days'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_retention_policy ('market_data', INTERVAL '5 years'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- technical_signals: compress after 30 days, drop after 2 years.
    BEGIN
        ALTER TABLE technical_signals SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_compression_policy('technical_signals', INTERVAL '30 days'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_retention_policy ('technical_signals', INTERVAL '2 years'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- ibkr_positions: compress after 14 days, drop after 3 years.
    BEGIN
        ALTER TABLE ibkr_positions SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_compression_policy('ibkr_positions', INTERVAL '14 days'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_retention_policy ('ibkr_positions', INTERVAL '3 years'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- ibkr_account_summary: compress after 30 days, drop after 5 years.
    BEGIN
        ALTER TABLE ibkr_account_summary SET (timescaledb.compress, timescaledb.compress_segmentby = 'account');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_compression_policy('ibkr_account_summary', INTERVAL '30 days'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_retention_policy ('ibkr_account_summary', INTERVAL '5 years'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- teller_balances: compress after 30 days, drop after 5 years.
    BEGIN
        ALTER TABLE teller_balances SET (timescaledb.compress, timescaledb.compress_segmentby = 'account_id');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_compression_policy('teller_balances', INTERVAL '30 days'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_retention_policy ('teller_balances', INTERVAL '5 years'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- net_worth_snapshots: compress after 90 days. NO retention policy — long
    -- history matters here for FIRE projections, and rows are small (one per hour).
    BEGIN
        ALTER TABLE net_worth_snapshots SET (timescaledb.compress);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM add_compression_policy('net_worth_snapshots', INTERVAL '90 days'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

