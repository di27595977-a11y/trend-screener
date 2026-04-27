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

create table if not exists app_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_scan_results_symbol_created_at on scan_results(symbol, created_at desc);
create index if not exists idx_scan_results_score on scan_results(trend_score desc);
create index if not exists idx_backtest_pending on backtest_tracking(price_72h) where price_72h is null;

alter table scan_snapshots enable row level security;
alter table scan_results enable row level security;
alter table backtest_tracking enable row level security;
alter table app_state enable row level security;

-- ── Alpha Matrix 即時訊號 ──────────────────────────────────────────────────
create table if not exists alpha_signals (
  id          uuid default gen_random_uuid() primary key,
  created_at  timestamptz not null default now(),
  symbol      text not null,
  alert_type  text not null,          -- volume_spike / price_move / volatility_burst / bb_squeeze
  direction   text not null,          -- bull / bear
  quality     integer not null,
  trend       text,
  position_pct numeric,
  price       numeric,
  message     text                    -- 完整 TG 推送文字
);

create index if not exists idx_alpha_signals_created_at on alpha_signals(created_at desc);
create index if not exists idx_alpha_signals_symbol on alpha_signals(symbol, created_at desc);

alter table alpha_signals enable row level security;

-- anon 可讀（前端直接查詢）
create policy "anon read alpha_signals"
  on alpha_signals for select to anon using (true);

-- service_role 可寫（Alpha Matrix 後端推送）
create policy "service insert alpha_signals"
  on alpha_signals for insert to service_role with check (true);

-- Alpha Strategy Console control plane
create table if not exists alpha_strategy_specs (
  file_name   text primary key,
  strategy_id text not null,
  status      text not null default 'candidate',
  enabled     boolean not null default true,
  spec        jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_alpha_strategy_specs_status_updated_at
  on alpha_strategy_specs(status, updated_at desc);

alter table alpha_strategy_specs enable row level security;

create policy "anon read alpha_strategy_specs"
  on alpha_strategy_specs for select to anon using (true);

create policy "service manage alpha_strategy_specs"
  on alpha_strategy_specs for all to service_role
  using (true)
  with check (true);

create table if not exists alpha_strategy_apply_jobs (
  id           uuid default gen_random_uuid() primary key,
  requested_at timestamptz not null default now(),
  requested_by text,
  statuses     text[] not null default array['candidate']::text[],
  status       text not null default 'pending',
  result       jsonb not null default '{}'::jsonb,
  applied_at   timestamptz,
  completed_at timestamptz
);

create index if not exists idx_alpha_strategy_apply_jobs_requested_at
  on alpha_strategy_apply_jobs(requested_at desc);

alter table alpha_strategy_apply_jobs enable row level security;

create policy "anon read alpha_strategy_apply_jobs"
  on alpha_strategy_apply_jobs for select to anon using (true);

create policy "service manage alpha_strategy_apply_jobs"
  on alpha_strategy_apply_jobs for all to service_role
  using (true)
  with check (true);

create table if not exists alpha_strategy_backtest_jobs (
  id             uuid default gen_random_uuid() primary key,
  file_name      text not null,
  strategy_id    text not null,
  spec           jsonb not null default '{}'::jsonb,
  requested_at   timestamptz not null default now(),
  requested_by   text,
  status         text not null default 'pending',
  timeframe      text not null default '15m',
  lookback_days  integer not null default 60,
  symbol_mode    text not null default 'top_n',
  symbols        text[] not null default '{}'::text[],
  top_n          integer,
  result         jsonb not null default '{}'::jsonb,
  error          text,
  started_at     timestamptz,
  completed_at   timestamptz
);

create index if not exists idx_alpha_strategy_backtest_jobs_requested_at
  on alpha_strategy_backtest_jobs(requested_at desc);

alter table alpha_strategy_backtest_jobs enable row level security;

create policy "anon read alpha_strategy_backtest_jobs"
  on alpha_strategy_backtest_jobs for select to anon using (true);

create policy "service manage alpha_strategy_backtest_jobs"
  on alpha_strategy_backtest_jobs for all to service_role
  using (true)
  with check (true);
