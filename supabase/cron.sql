create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists vault;

-- Replace the placeholders once with your real values from Settings -> API.
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_SUPABASE_ANON_KEY', 'publishable_key');

select cron.schedule(
  'trend-screener-scan-1h',
  '*/5 * * * *',
  $$
  select
    net.http_post(
      url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/trend-api',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
      ),
      body:='{"action":"run-scan","timeframe":"1h"}'::jsonb
    );
  $$
);

select cron.schedule(
  'trend-screener-scan-4h',
  '2-57/5 * * * *',
  $$
  select
    net.http_post(
      url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/trend-api',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
      ),
      body:='{"action":"run-scan","timeframe":"4h"}'::jsonb
    );
  $$
);

select cron.schedule(
  'trend-screener-backtest',
  '7 * * * *',
  $$
  select
    net.http_post(
      url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/trend-api',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
      ),
      body:='{"action":"run-backtest"}'::jsonb
    );
  $$
);
