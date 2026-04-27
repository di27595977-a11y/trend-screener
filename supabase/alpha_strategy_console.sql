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
