import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { fetchCandles, fetchTradableSymbols, requestBinance } from '../_shared/binance.ts';
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

function sortResultsForMode(results: any[], mode = 'trend') {
  return [...results].sort((left, right) => {
    if (mode !== 'trend') {
      const leftHasHarmonic = (left.detectedPatterns || []).some((item: string) => item.startsWith('harmonic:'));
      const rightHasHarmonic = (right.detectedPatterns || []).some((item: string) => item.startsWith('harmonic:'));

      if (leftHasHarmonic !== rightHasHarmonic) {
        return Number(rightHasHarmonic) - Number(leftHasHarmonic);
      }
    }

    return right.trendScore - left.trendScore;
  });
}

function filterResults(results: any[], minScore: number, patterns: string[], mode = 'trend') {
  return sortResultsForMode(results, mode).filter((result) => {
    const hasHarmonic = (result.detectedPatterns || []).some((item: string) => item.startsWith('harmonic:'));
    const effectiveMinScore =
      mode === 'harmonic' ? Math.min(minScore, 40) : mode === 'hybrid' && hasHarmonic ? Math.min(minScore, 45) : minScore;

    if (result.trendScore < effectiveMinScore) return false;
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
          activeBias: 'long',
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
      const mode = body.mode || 'trend';
      const bias = body.bias || 'long';
      const settings = await getRuntimeSettings(admin);
      const minScore = body.minScore != null ? Number.parseInt(body.minScore, 10) : settings.scan.minScoreDefault;
      const patterns = Array.isArray(body.patterns) ? body.patterns : [];
      const force = Boolean(body.force);
      const snapshot = force ? await runScan(admin, timeframe, mode, bias) : await getLatestScanResults(admin, timeframe, mode, bias);

      if (!force && !snapshot.results?.length) {
        const refreshed = await runScan(admin, timeframe, mode, bias);
        return json({ results: filterResults(refreshed.results, minScore, patterns, mode), meta: refreshed.meta });
      }

      return json({
        results: filterResults(snapshot.results || [], minScore, patterns, mode),
        meta: snapshot.meta || {
          mode,
          bias,
          timeframe,
          totalSymbols: snapshot.snapshot?.total_symbols || 0,
          filteredCount: snapshot.results?.length || 0,
          scannedAt: snapshot.snapshot?.scanned_at || null,
          durationMs: null,
        },
      });
    }

    if (action === 'run-scan') {
      return json(await runScan(admin, body.timeframe || '1h', body.mode || 'trend', body.bias || 'long'));
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

    if (action === 'list-symbols') {
      return json({
        symbols: await fetchTradableSymbols(),
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

    if (action === 'winrate') {
      const symbol = (body.symbol || '').toUpperCase();
      const hours  = Math.max(1, Math.min(168, Number(body.hours) || 4));
      const limit  = Math.min(1000, 90 * 24);

      if (!symbol) return json({ error: 'symbol required' }, { status: 400 });

      const [candles, fundingRaw] = await Promise.all([
        fetchCandles(symbol, '1h', limit),
        requestBinance('/fapi/v1/fundingRate', { symbol, limit: 500 }).catch(() => []),
      ]);

      if (candles.length < hours + 10) {
        return json({ error: '歷史資料不足，無法計算' }, { status: 400 });
      }

      const fundingMap = new Map<number, number>();
      for (const f of (fundingRaw as any[])) {
        const hourTs = Math.floor(Number(f.fundingTime) / 3_600_000) * 3_600_000;
        fundingMap.set(hourTs, Number(f.fundingRate));
      }

      const currentFunding = fundingMap.size > 0
        ? [...fundingMap.entries()].sort((a, b) => b[0] - a[0])[0]?.[1] ?? null
        : null;

      const stats = {
        all:      { wins: 0, total: 0, gain: 0, loss: 0, gainN: 0, lossN: 0, maxG: -Infinity, maxL: -Infinity },
        fundPos:  { wins: 0, total: 0 },
        fundNeg:  { wins: 0, total: 0 },
        fundHigh: { wins: 0, total: 0 },
        fundLow:  { wins: 0, total: 0 },
      };

      for (let i = 0; i < candles.length - hours; i++) {
        const entry = candles[i].close;
        const exit  = candles[i + hours].close;
        const ret   = (exit - entry) / entry;
        const win   = ret > 0;
        const hourTs = Math.floor(candles[i].time * 1000 / 3_600_000) * 3_600_000;

        const s = stats.all;
        s.total++;
        if (win) { s.wins++; s.gain += ret; s.gainN++; s.maxG = Math.max(s.maxG, ret); }
        else     { s.loss += Math.abs(ret); s.lossN++; s.maxL = Math.max(s.maxL, Math.abs(ret)); }

        let fr: number | null = null;
        for (let lb = 0; lb <= 8; lb++) {
          const ts = hourTs - lb * 3_600_000;
          if (fundingMap.has(ts)) { fr = fundingMap.get(ts)!; break; }
        }
        if (fr !== null) {
          if (fr > 0)       { stats.fundPos.total++;  if (win) stats.fundPos.wins++;  }
          if (fr < 0)       { stats.fundNeg.total++;  if (win) stats.fundNeg.wins++;  }
          if (fr > 0.0005)  { stats.fundHigh.total++; if (win) stats.fundHigh.wins++; }
          if (fr < -0.0001) { stats.fundLow.total++;  if (win) stats.fundLow.wins++;  }
        }
      }

      const s = stats.all;
      const winRate       = s.wins / s.total;
      const avgGain       = s.gainN > 0 ? s.gain / s.gainN : 0;
      const avgLoss       = s.lossN > 0 ? s.loss / s.lossN : 0;
      const expectedValue = winRate * avgGain - (1 - winRate) * avgLoss;
      const wr = (st: { wins: number; total: number }) => st.total >= 10 ? st.wins / st.total : null;

      return json({
        symbol, hours, winRate,
        sampleCount: s.total,
        avgGain, avgLoss, expectedValue,
        maxGain: s.maxG === -Infinity ? 0 : s.maxG,
        maxLoss: s.maxL === -Infinity ? 0 : s.maxL,
        currentPrice: candles[candles.length - 1].close,
        currentFunding,
        funding: {
          positive:    { winRate: wr(stats.fundPos),  sampleCount: stats.fundPos.total  },
          negative:    { winRate: wr(stats.fundNeg),  sampleCount: stats.fundNeg.total  },
          extremeHigh: { winRate: wr(stats.fundHigh), sampleCount: stats.fundHigh.total },
          extremeLow:  { winRate: wr(stats.fundLow),  sampleCount: stats.fundLow.total  },
        },
        mlScore: null, mlDirection: null, mlProb: null,
      });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return json({ error: serializeError(error) }, { status: 500 });
  }
});
