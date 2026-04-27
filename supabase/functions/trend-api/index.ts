import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { fetchCandles, fetchTradableSymbols, requestBinance } from '../_shared/binance.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  buildBacktestReport,
  createAdminClient,
  getAppState,
  listAlphaStrategySpecs,
  getLatestScanResults,
  getLatestSymbolOverview,
  queueAlphaStrategyBacktest,
  getRuntimeSettings,
  queueAlphaStrategyApply,
  saveAlphaStrategySpec,
  updateRuntimeSettings,
} from '../_shared/db.ts';
import { runBacktest, runScan } from '../_shared/jobs.ts';
import { findSwingPoints, type Candle } from '../_shared/logic.ts';

// ─── Range Detection Helpers ─────────────────────────────────────────────────

function clusterPointsRange(points: Array<{ index: number; price: number; time: number }>, tolerance: number) {
  const clusters: Array<Array<{ index: number; price: number; time: number }>> = [];
  const used = new Set<number>();
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const cluster = [points[i]];
    used.add(i);
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const clusterAvg = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      if (Math.abs(points[j].price - clusterAvg) / clusterAvg <= tolerance) {
        cluster.push(points[j]);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function detectSR(candles: Candle[], minTouches = 2, tolerance = 0.008) {
  const { swingHighs, swingLows } = findSwingPoints(candles, 3);
  const levels: Array<{ price: number; type: string; touches: number }> = [];
  clusterPointsRange(swingHighs, tolerance).forEach((c) => {
    if (c.length >= minTouches) levels.push({ price: c.reduce((s, p) => s + p.price, 0) / c.length, type: 'resistance', touches: c.length });
  });
  clusterPointsRange(swingLows, tolerance).forEach((c) => {
    if (c.length >= minTouches) levels.push({ price: c.reduce((s, p) => s + p.price, 0) / c.length, type: 'support', touches: c.length });
  });
  return levels.sort((a, b) => b.touches - a.touches).slice(0, 6);
}

function calcRSI(candles: Candle[], period = 14) {
  if (candles.length < period + 1) return 50;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gainSum += d; else lossSum += Math.abs(d);
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcBBWidth(candles: Candle[], period = 20) {
  if (candles.length < period) return null;
  const closes = candles.slice(-period).map((c) => c.close);
  const mean = closes.reduce((s, v) => s + v, 0) / period;
  const std = Math.sqrt(closes.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return (std / mean) * 100;
}

function scoreRangeSignal(opts: { proximity: number; touches: number; rsi: number; signalSide: string; bbWidth: number | null; volumeRatio: number; has4hConfirm: boolean }) {
  let score = 0;
  score += Math.round(Math.max(0, 30 - (opts.proximity / 0.3) * 20));
  score += Math.min(opts.touches * 8, 25);
  if (opts.signalSide === 'short' && opts.rsi > 65) score += Math.min(Math.round((opts.rsi - 65) * 0.6), 20);
  if (opts.signalSide === 'long' && opts.rsi < 35) score += Math.min(Math.round((35 - opts.rsi) * 0.6), 20);
  if (opts.signalSide === 'short' && opts.rsi >= 50 && opts.rsi <= 65) score += 5;
  if (opts.signalSide === 'long' && opts.rsi >= 35 && opts.rsi <= 50) score += 5;
  if (opts.bbWidth != null && opts.bbWidth < 3) score += Math.round(Math.max(0, 10 - opts.bbWidth * 2));
  if (opts.volumeRatio < 1.2) score += 5;
  if (opts.has4hConfirm) score += 10;
  return Math.min(score, 100);
}

async function fetchTopSymbolsN(topN = 80) {
  const data: any[] = await requestBinance('/fapi/v1/ticker/24hr', {});
  return data
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .sort((a: any, b: any) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, topN)
    .map((t: any) => t.symbol);
}

async function analyzeRangeSymbol(symbol: string, cfg: { proximityPct: number; minRangeWidthPct: number; maxRangeWidthPct: number; minTouches: number }, timeframe = '1h') {
  const primaryInterval = timeframe;
  const auxInterval = timeframe === '1h' ? '4h' : '1h';
  const primaryLimit = timeframe === '1h' ? 240 : 168;
  const auxLimit = timeframe === '1h' ? 168 : 240;

  const candles = await fetchCandles(symbol, primaryInterval, primaryLimit);
  if (candles.length < 30) return null;

  const currentPrice = candles[candles.length - 1].close;
  const levels = detectSR(candles, cfg.minTouches);
  if (levels.length < 2) return null;

  const resistances = levels.filter((l) => l.type === 'resistance' && l.price > currentPrice);
  const supports = levels.filter((l) => l.type === 'support' && l.price < currentPrice);
  if (!resistances.length && !supports.length) return null;

  const nearestRes = resistances.sort((a, b) => a.price - b.price)[0] || null;
  const nearestSup = supports.sort((a, b) => b.price - a.price)[0] || null;

  if (nearestRes && nearestSup) {
    const rangeWidth = ((nearestRes.price - nearestSup.price) / currentPrice) * 100;
    if (rangeWidth < cfg.minRangeWidthPct || rangeWidth > cfg.maxRangeWidthPct) return null;
  }

  const resDist = nearestRes ? ((nearestRes.price - currentPrice) / currentPrice) * 100 : Infinity;
  const supDist = nearestSup ? ((currentPrice - nearestSup.price) / currentPrice) * 100 : Infinity;

  let signalSide: string | null = null;
  let targetLevel: any = null;
  let proximity = 0;

  if (resDist <= cfg.proximityPct && resDist <= supDist) {
    signalSide = 'short'; targetLevel = nearestRes; proximity = resDist;
  } else if (supDist <= cfg.proximityPct && supDist < resDist) {
    signalSide = 'long'; targetLevel = nearestSup; proximity = supDist;
  }
  if (!signalSide) return null;

  const rsi = calcRSI(candles);
  const bbWidth = calcBBWidth(candles);
  const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const curVol = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
  const volumeRatio = avgVol > 0 ? curVol / avgVol : 1;

  let hasAuxConfirm = false;
  try {
    const candlesAux = await fetchCandles(symbol, auxInterval, auxLimit);
    if (candlesAux.length >= 20) {
      const levelsAux = detectSR(candlesAux, 2);
      hasAuxConfirm = levelsAux.some((l) => l.type === targetLevel.type && Math.abs(l.price - targetLevel.price) / targetLevel.price < 0.01);
    }
  } catch { /* non-critical */ }

  const score = scoreRangeSignal({ proximity, touches: targetLevel.touches, rsi, signalSide, bbWidth, volumeRatio, has4hConfirm: hasAuxConfirm });

  return {
    symbol, signalSide, score, currentPrice, timeframe: primaryInterval,
    targetLevel: { price: targetLevel.price, type: targetLevel.type, touches: targetLevel.touches },
    proximity: Math.round(proximity * 1000) / 1000,
    rsi: Math.round(rsi * 10) / 10,
    bbWidth: bbWidth != null ? Math.round(bbWidth * 100) / 100 : null,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    has4hConfirm: hasAuxConfirm,
    nearestSupport: nearestSup ? { price: nearestSup.price, touches: nearestSup.touches } : null,
    nearestResistance: nearestRes ? { price: nearestRes.price, touches: nearestRes.touches } : null,
    detectedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

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
        candles: await fetchCandles(String(body.symbol).toUpperCase(), body.interval || '1h', Number(body.limit || 240)),
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

    if (action === 'alpha-strategies-list') {
      return json(await listAlphaStrategySpecs(admin));
    }

    if (action === 'save-alpha-strategy') {
      const fileName = String(body.fileName || '').trim();
      const spec = body.spec && typeof body.spec === 'object' ? body.spec : null;
      if (!fileName || !spec) {
        return json({ error: 'fileName and spec are required' }, { status: 400 });
      }
      return json(await saveAlphaStrategySpec(admin, fileName, spec as Record<string, unknown>));
    }

    if (action === 'apply-alpha-strategies') {
      return json(await queueAlphaStrategyApply(admin, 'trend-api'));
    }

    if (action === 'run-alpha-strategy-backtest') {
      const fileName = String(body.fileName || '').trim();
      if (!fileName) {
        return json({ error: 'fileName is required' }, { status: 400 });
      }
      return json(await queueAlphaStrategyBacktest(admin, fileName, 'trend-api'));
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

      const mkSide = () => ({ wins: 0, total: 0, gain: 0, loss: 0, gainN: 0, lossN: 0, maxG: -Infinity, maxL: -Infinity });
      const stats = {
        long:  mkSide(),
        short: mkSide(),
        fundPos:  { longWin: 0, shortWin: 0, total: 0 },
        fundNeg:  { longWin: 0, shortWin: 0, total: 0 },
        fundHigh: { longWin: 0, shortWin: 0, total: 0 },
        fundLow:  { longWin: 0, shortWin: 0, total: 0 },
      };

      for (let i = 0; i < candles.length - hours; i++) {
        const entry = candles[i].close;
        const exit  = candles[i + hours].close;
        const ret   = (exit - entry) / entry;
        const longWin  = ret > 0;   // 做多：漲了就贏
        const shortWin = ret < 0;   // 做空：跌了就贏
        const hourTs = Math.floor(candles[i].time * 1000 / 3_600_000) * 3_600_000;

        // Long stats
        const sl = stats.long;
        sl.total++;
        if (longWin) { sl.wins++; sl.gain += ret; sl.gainN++; sl.maxG = Math.max(sl.maxG, ret); }
        else         { sl.loss += Math.abs(ret); sl.lossN++; sl.maxL = Math.max(sl.maxL, Math.abs(ret)); }

        // Short stats (mirror returns)
        const ss = stats.short;
        ss.total++;
        if (shortWin) { ss.wins++; ss.gain += Math.abs(ret); ss.gainN++; ss.maxG = Math.max(ss.maxG, Math.abs(ret)); }
        else          { ss.loss += ret; ss.lossN++; ss.maxL = Math.max(ss.maxL, ret); }

        // Funding rate conditions
        let fr: number | null = null;
        for (let lb = 0; lb <= 8; lb++) {
          const ts = hourTs - lb * 3_600_000;
          if (fundingMap.has(ts)) { fr = fundingMap.get(ts)!; break; }
        }
        if (fr !== null) {
          if (fr > 0)       { stats.fundPos.total++;  if (longWin) stats.fundPos.longWin++;  if (shortWin) stats.fundPos.shortWin++;  }
          if (fr < 0)       { stats.fundNeg.total++;  if (longWin) stats.fundNeg.longWin++;  if (shortWin) stats.fundNeg.shortWin++;  }
          if (fr > 0.0005)  { stats.fundHigh.total++; if (longWin) stats.fundHigh.longWin++; if (shortWin) stats.fundHigh.shortWin++; }
          if (fr < -0.0001) { stats.fundLow.total++;  if (longWin) stats.fundLow.longWin++;  if (shortWin) stats.fundLow.shortWin++;  }
        }
      }

      const calcSide = (s: ReturnType<typeof mkSide>) => ({
        winRate:       s.total > 0 ? s.wins / s.total : 0,
        sampleCount:   s.total,
        avgGain:       s.gainN > 0 ? s.gain / s.gainN : 0,
        avgLoss:       s.lossN > 0 ? s.loss / s.lossN : 0,
        expectedValue: s.total > 0 ? (s.wins / s.total) * (s.gainN > 0 ? s.gain / s.gainN : 0) - (1 - s.wins / s.total) * (s.lossN > 0 ? s.loss / s.lossN : 0) : 0,
        maxGain:       s.maxG === -Infinity ? 0 : s.maxG,
        maxLoss:       s.maxL === -Infinity ? 0 : s.maxL,
      });

      const longStats  = calcSide(stats.long);
      const shortStats = calcSide(stats.short);
      const wr = (wins: number, total: number) => total >= 10 ? wins / total : null;

      return json({
        symbol, hours,
        currentPrice: candles[candles.length - 1].close,
        currentFunding,
        long:  longStats,
        short: shortStats,
        // backward compat
        winRate: longStats.winRate,
        sampleCount: longStats.sampleCount,
        avgGain: longStats.avgGain,
        avgLoss: longStats.avgLoss,
        expectedValue: longStats.expectedValue,
        maxGain: longStats.maxGain,
        maxLoss: longStats.maxLoss,
        funding: {
          positive:    { long: wr(stats.fundPos.longWin, stats.fundPos.total),   short: wr(stats.fundPos.shortWin, stats.fundPos.total),   sampleCount: stats.fundPos.total,  winRate: wr(stats.fundPos.longWin, stats.fundPos.total)  },
          negative:    { long: wr(stats.fundNeg.longWin, stats.fundNeg.total),   short: wr(stats.fundNeg.shortWin, stats.fundNeg.total),   sampleCount: stats.fundNeg.total,  winRate: wr(stats.fundNeg.longWin, stats.fundNeg.total)  },
          extremeHigh: { long: wr(stats.fundHigh.longWin, stats.fundHigh.total), short: wr(stats.fundHigh.shortWin, stats.fundHigh.total), sampleCount: stats.fundHigh.total, winRate: wr(stats.fundHigh.longWin, stats.fundHigh.total) },
          extremeLow:  { long: wr(stats.fundLow.longWin, stats.fundLow.total),   short: wr(stats.fundLow.shortWin, stats.fundLow.total),   sampleCount: stats.fundLow.total,  winRate: wr(stats.fundLow.longWin, stats.fundLow.total)  },
        },
        mlScore: null, mlDirection: null, mlProb: null,
      });
    }

    if (action === 'range-signals') {
      const tf = body.timeframe === '4h' ? '4h' : '1h';
      const cfg = {
        proximityPct: Number(body.proximityPct) || 0.3,
        minRangeWidthPct: Number(body.minRangeWidthPct) || 1.0,
        maxRangeWidthPct: Number(body.maxRangeWidthPct) || 8.0,
        minTouches: Number(body.minTouches) || 2,
      };

      const topN = Number(body.topN) || 80;
      const customList: string[] = Array.isArray(body.customSymbols) ? body.customSymbols : [];
      const baseSymbols = await fetchTopSymbolsN(topN);
      const symbolSet = new Set(baseSymbols);
      for (const sym of customList) { if (sym && sym.endsWith('USDT')) symbolSet.add(sym); }
      const symbols = [...symbolSet];
      const signals: any[] = [];

      // Process in batches of 3 to respect rate limits
      for (let i = 0; i < symbols.length; i += 3) {
        const batch = symbols.slice(i, i + 3);
        const results = await Promise.all(batch.map((sym) => analyzeRangeSymbol(sym, cfg, tf).catch(() => null)));
        signals.push(...results.filter(Boolean));
        if (i + 3 < symbols.length) await new Promise((r) => setTimeout(r, 1000));
      }

      signals.sort((a, b) => b.score - a.score);

      return json({
        signals,
        lastScanAt: new Date().toISOString(),
        config: cfg,
        telegramConfigured: false,
      });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return json({ error: serializeError(error) }, { status: 500 });
  }
});
