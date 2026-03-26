-- ML Feature Engineering Tables
-- Run in Supabase SQL Editor after existing schema.sql

-- ml_features: stores per-symbol per-hour 193 features + labels
CREATE TABLE IF NOT EXISTS ml_features (
  id               bigserial PRIMARY KEY,
  symbol           text NOT NULL,
  ts               timestamptz NOT NULL,
  features         jsonb NOT NULL,           -- all feature key-values
  label            smallint,                 -- -1/0/1 (backfilled later)
  forward_return_4h float,                   -- actual 4h forward return (backfilled)
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ml_features_symbol_ts ON ml_features (symbol, ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_features_symbol_ts_uniq ON ml_features (symbol, ts);

-- ml_predictions: per-scan ML prediction results
CREATE TABLE IF NOT EXISTS ml_predictions (
  id               bigserial PRIMARY KEY,
  scan_snapshot_id uuid REFERENCES scan_snapshots(id) ON DELETE SET NULL,
  symbol           text NOT NULL,
  ml_score         float,                    -- 0-100, long confidence
  ml_direction     smallint,                 -- 1=long, -1=short, 0=neutral
  ml_probability   float,                    -- softmax max probability
  feature_snapshot jsonb,                    -- feature values used (for debug)
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_symbol_at ON ml_predictions (symbol, created_at DESC);

-- RLS: match existing tables' policy style
ALTER TABLE ml_features    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read ml_features"
  ON ml_features FOR SELECT TO anon USING (true);

CREATE POLICY "service insert ml_features"
  ON ml_features FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "service update ml_features"
  ON ml_features FOR UPDATE TO service_role USING (true);

CREATE POLICY "anon read ml_predictions"
  ON ml_predictions FOR SELECT TO anon USING (true);

CREATE POLICY "service insert ml_predictions"
  ON ml_predictions FOR INSERT TO service_role WITH CHECK (true);
