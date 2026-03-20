import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { fetchCandles } from '../_shared/binance.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  buildBacktestReport,
  createAdminClient,
  getAppState,
  getLatestScanResults,
  getLatestSymbolOverview,
  getRuntimeSettings,
  updateRuntimeSettings,
} from '../_shared/db.ts';
import { runBacktest, runScan } from '../_shared/jobs.ts';

function filterResults(results: any[], minScore: number, patterns: string[]) {
  return results.filter((result) => {
    if (result.trendScore < minScore) return false;
    if (!patterns.length) return true;

    return patterns.every((pattern) => {
      if (pattern === 'triangle') {
        return result.detectedPatterns.some((item: string) => item.startsWith('triangle:'));
      }

      if (pattern === 'harmonic') {
        return result.detectedPatterns.some((item: string) => item.startsWith('harmonic:'));
      }

      return result.detectedPatterns.includes(pattern);
    });
  });
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unexpected error';
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const admin = createAdminClient();
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const action = body.action || 'status';

    if (action === 'status') {
      const [scanner, backtest] = await Promise.all([getAppState(admin, 'scanner'), getAppState(admin, 'backtest')]);
      return json({
        scanner: scanner || {
          isScanning: false,
          activeTimeframe: null,
          lastScanAt: null,
          nextScanAt: null,
          lastDurationMs: null,
          progress: { completed: 0, total: 0, percent: 0 },
        },
        backtest: backtest || {
          isRunning: false,
          lastRunAt: null,
          nextRunAt: null,
          lastProcessed: 0,
        },
        persistence: 'supabase',
      });
    }

    if (action === 'get-settings') {
      return json(await getRuntimeSettings(admin));
    }

    if (action === 'update-settings') {
      return json(await updateRuntimeSettings(admin, body.settings || {}));
    }

    if (action === 'scan-results') {
      const timeframe = body.timeframe || '1h';
      const settings = await getRuntimeSettings(admin);
      const minScore = body.minScore != null ? Number.parseInt(body.minScore, 10) : settings.scan.minScoreDefault;
      const patterns = Array.isArray(body.patterns) ? body.patterns : [];
      const force = Boolean(body.force);
      const snapshot = force ? await runScan(admin, timeframe) : await getLatestScanResults(admin, timeframe);

      if (!force && !snapshot.results?.length) {
        const refreshed = await runScan(admin, timeframe);
        return json({ results: filterResults(refreshed.results, minScore, patterns), meta: refreshed.meta });
      }

      return json({
        results: filterResults(snapshot.results || [], minScore, patterns),
        meta: snapshot.meta || {
          timeframe,
          totalSymbols: snapshot.snapshot?.total_symbols || 0,
          filteredCount: snapshot.results?.length || 0,
          scannedAt: snapshot.snapshot?.scanned_at || null,
          durationMs: null,
        },
      });
    }

    if (action === 'run-scan') {
      return json(await runScan(admin, body.timeframe || '1h'));
    }

    if (action === 'symbol-overview') {
      return json(await getLatestSymbolOverview(admin, body.symbol));
    }

    if (action === 'chart-data') {
      return json({
        symbol: String(body.symbol).toUpperCase(),
        interval: body.interval || '1h',
        candles: await fetchCandles(String(body.symbol).toUpperCase(), body.interval || '1h', Number(body.limit || 72)),
      });
    }

    if (action === 'backtest-report') {
      const settings = await getRuntimeSettings(admin);
      return json(
        await buildBacktestReport(admin, {
          timeframe: body.timeframe || '1h',
          days: body.days != null ? Number(body.days) : settings.backtest.reportDaysDefault,
        }),
      );
    }

    if (action === 'run-backtest') {
      return json(await runBacktest(admin));
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return json({ error: serializeError(error) }, { status: 500 });
  }
});
