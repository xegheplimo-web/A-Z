-- 018_coverage_signals — P-LEARNING-3 production Coverage Flywheel.
--
-- Demand × gap aggregates per cell (admin_id × category × ISO week). This is
-- deliberately NOT a log: no raw query, no user identifiers — just counts
-- that tell the acquisition loop where Vietnam data is missing.
--
--   cell_key = "<admin_id|->:<category>:<YYYY-WW>"
--
-- Facade-level search_traces keep the raw/debug view (hot tier); this table
-- is the long-lived signal the Coverage Engine consumes.

CREATE TABLE IF NOT EXISTS coverage_signals (
    cell_key     TEXT PRIMARY KEY,
    admin_id     TEXT,
    category     TEXT NOT NULL,
    specialty    TEXT,
    week         TEXT NOT NULL,
    demand       INTEGER NOT NULL DEFAULT 0,
    zero_result  INTEGER NOT NULL DEFAULT 0,
    low_result   INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coverage_signals_demand
    ON coverage_signals (demand DESC);
CREATE INDEX IF NOT EXISTS idx_coverage_signals_admin_week
    ON coverage_signals (admin_id, week);
