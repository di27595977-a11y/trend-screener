# Trend Screener

Trend Screener is a React + Vite + Express app for scanning Binance USDT-M perpetual contracts, ranking clean uptrends, and overlaying auto-detected chart patterns on a 72-bar detail chart.

## Stack

- Frontend: React 19, React Router, Tailwind CSS v4
- Charting: lightweight-charts v5 + canvas overlay
- Backend: Express + scheduled scan jobs
- Persistence: Supabase when configured, in-memory fallback otherwise

## Scripts

- `npm run dev`: start Vite and the Express API together
- `npm run build`: build the frontend bundle
- `npm run build:server`: syntax-check server files
- `npm run scan`: run a one-off scan from the terminal
- `npm run backtest`: run a one-off backfill cycle
- `npm run start`: run the API server without file watching

## Environment

Copy `.env.example` to `.env` and fill what you need.

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are optional but required for durable scan history/backtests.
- `VITE_API_TARGET` should point to your deployed API base when you run the Express server path.
- If you do not have a VPS yet, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel and let the frontend call Supabase Edge Functions directly.
- `BINANCE_SYMBOL_LIMIT` is useful for faster local development.
- `BINANCE_REQUESTS_PER_SECOND` defaults to `4` to stay conservative on REST limits.
- `ALPHA_ENGINE_SIGNAL_FEED_PATH` is optional and lets the `/alpha` page read a JSON feed exported from Alpha-engine.

## Deployment Shape

- Vercel: host the React frontend only.
- VPS or other always-on Node host: run `npm run start` for the Express API, scan scheduler, and backtest scheduler.
- Supabase: run [supabase/schema.sql](/Users/tatto/Desktop/trend-screener/supabase/schema.sql) before enabling persistent storage.
- Supabase-only starter: deploy [supabase/functions/trend-api/index.ts](/Users/tatto/Desktop/trend-screener/supabase/functions/trend-api/index.ts), run [supabase/schema.sql](/Users/tatto/Desktop/trend-screener/supabase/schema.sql), then add the scheduled jobs from [supabase/cron.sql](/Users/tatto/Desktop/trend-screener/supabase/cron.sql).

This split matters because Vercel is great for the frontend, but the scan and backtest jobs need a long-running process.
The Supabase-only option works as a free-tier bridge until you move scanning to a VPS later.

## Vercel Setup

1. Add the project to Vercel as a Vite app.
2. If using Supabase-only mode, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. If using VPS mode instead, set `VITE_API_TARGET` to your VPS API origin, for example `https://api.your-domain.com`.
3. Keep the default build command `npm run build`.
4. The SPA rewrite is already defined in [vercel.json](/Users/tatto/Desktop/trend-screener/vercel.json).

## Supabase Setup

1. Create a free Supabase project in the dashboard.
2. Run [supabase/schema.sql](/Users/tatto/Desktop/trend-screener/supabase/schema.sql) in the SQL editor.
3. Deploy the Edge Function in [supabase/functions/trend-api/index.ts](/Users/tatto/Desktop/trend-screener/supabase/functions/trend-api/index.ts).
4. Run [supabase/cron.sql](/Users/tatto/Desktop/trend-screener/supabase/cron.sql) after replacing the placeholder project URL and anon key.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to Vercel, then redeploy the frontend.

## GitHub Automation For Supabase

- The repo includes [.github/workflows/deploy-supabase-functions.yml](/Users/tatto/Desktop/trend-screener/.github/workflows/deploy-supabase-functions.yml).
- Add GitHub secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` if you want every push to redeploy the Edge Function automatically.

## GitHub to Vercel

- Use the Vercel dashboard and choose `Add New -> Project -> Import Git Repository`.
- Select the existing GitHub repository `di27595977-a11y/trend-screener`.
- Do not use the template clone flow for this repo, or Vercel will try to create a duplicate GitHub repository.

## GitHub Push

1. Initialize a repo in this folder if it is not already one: `git init`.
2. Create your GitHub repo.
3. Add the remote: `git remote add origin <your-repo-url>`.
4. Commit and push: `git add . && git commit -m "Initial trend screener" && git push -u origin main`.

## API Routes

- `GET /api/status`
- `GET /api/scan?timeframe=1h&minScore=60`
- `POST /api/scan` with `{ "timeframe": "1h" }`
- `GET /api/scan/:symbol`
- `GET /api/chart/:symbol?limit=72&interval=1h`
- `GET /api/backtest/report`

## Notes

- The dashboard uses Binance WebSocket mini ticker data directly in the browser for live prices.
- The detail chart subscribes to the symbol's `kline_1h` stream and reruns pattern detection on candle close.
- When Supabase is not configured, scan/backtest data is kept in memory so the app still runs locally.
