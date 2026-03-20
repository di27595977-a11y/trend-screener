create extension if not exists pgcrypto;

create table if not exists scan_snapshots (
  id uuid default gen_random_uuid() primary key,
  scanned_at timestamptz not null default now(),
  timeframe text not null,
  total_symbols integer,
  filtered_count integer,
  params jsonb
);

create table if not exists scan_results (
  id uuid default gen_random_uuid() primary key,
  snapshot_id uuid references scan_snapshots(id) on delete cascade,
  symbol text not null,
  timeframe text not null,
  trend_score integer,
  r_squared numeric,
  slope numeric,
  slope_pct_per_bar numeric,
  pullback_ratio numeric,
  volume_ratio numeric,
  price_change_pct numeric,
  position_score numeric,
  entry_price numeric,
  detected_patterns text[],
  sparkline jsonb,
  created_at timestamptz default now()
);

create table if not exists backtest_tracking (
  id uuid default gen_random_uuid() primary key,
  scan_result_id uuid references scan_results(id) on delete cascade,
  symbol text not null,
  entry_price numeric not null,
  price_1h numeric,
  price_4h numeric,
  price_12h numeric,
  price_24h numeric,
  price_48h numeric,
  price_72h numeric,
  max_profit_pct numeric,
  max_drawdown_pct numeric,
  updated_at timestamptz default now()
);

create index if not exists idx_scan_results_symbol_created_at on scan_results(symbol, created_at desc);
create index if not exists idx_scan_results_score on scan_results(trend_score desc);
create index if not exists idx_backtest_pending on backtest_tracking(price_72h) where price_72h is null;
