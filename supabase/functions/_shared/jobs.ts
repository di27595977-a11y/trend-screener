import { fetchCandles, fetchTradableSymbols } from './binance.ts';
import {
  SCAN_TIMEFRAME_CONFIG,
  buildSparkline,
  calculateTrendScore,
  detectAllPatterns,
  evaluateTrend,
  normalizeTradeBias,
  passesTrendThresholds,
  summarizePatterns,
} from './logic.ts';
import { getAppState, getRuntimeSettings, listPendingBacktests, recordScan, setAppState, updateBacktestEntry } from './db.ts';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REQUESTS_PER_SECOND = Math.max(Number.parseInt(Deno.env.get('BINANCE_REQUESTS_PER_SECOND') || '4', 10), 1);
const ACTIVE_HARMONIC_STATUSES = new Set(['forming', 'confirmed', 'tp1_hit']);

async function runBatches<T, R>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R | null>,
  onProgress?: (completed: number, total: number) => Promise<void> | void,
) {
  const results: R[] = [];
  let completed = 0;

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await worker(item);
        } catch {
          return null;
        }
      }),
    );

    results.push(...batchResults.filter(Boolean) as R[]);
    completed += batch.length;
    await onProgress?.(completed, items.length);

    if (index + batchSize < items.length) {
      await sleep(1000);
    }
  }

  return results;
}

function pickPriceAtHours(candles: any[], createdAtMs: number, hours: number) {
  const targetTime = createdAtMs + hours * 60 * 60 * 1000;
  if (Date.now() < targetTime) return null;
  const candle = candles.find((item) => item.time * 1000 >= targetTime) || candles.at(-1);
  return candle?.close ?? null;
}

function calculateRangeStats(candles: any[], entryPrice: number) {
  if (!candles.length || !entryPrice) {
    return { maxProfitPct: null, maxDrawdownPct: null };
  }

  const maxHigh = Math.max(...candles.map((candle) => candle.high));
  const minLow = Math.min(...candles.map((candle) => candle.low));
  return {
    maxProfitPct: ((maxHigh - entryPrice) / entryPrice) * 100,
    maxDrawdownPct: ((minLow - entryPrice) / entryPrice) * 100,
  };
}

function normalizeScanMode(mode = 'trend') {
  return ['trend', 'harmonic', 'hybrid'].includes(mode) ? mode : 'trend';
}

function normalizeScanBias(bias = 'long') {
  return normalizeTradeBias(bias);
}

function getPatternHarmonics(patterns: any) {
  if (!patterns) {
    return [];
  }

  if (patterns.harmonics?.length) {
    return patterns.harmonics;
  }

  return patterns.harmonic ? [patterns.harmonic] : [];
}

function getActionableHarmonic(patterns: any, bias = 'long') {
  const targetDirection = normalizeScanBias(bias) === 'short' ? 'bearish' : 'bullish';
  return getPatternHarmonics(patterns).find(
    (pattern: any) => pattern.direction === targetDirection && ACTIVE_HARMONIC_STATUSES.has(pattern.status?.key),
  ) || null;
}

function sortResultsForMode(results: any[], mode = 'trend') {
  const scanMode = normalizeScanMode(mode);

  return [...results].sort((left, right) => {
    if (scanMode !== 'trend') {
      const leftHasHarmonic = (left.detectedPatterns || []).some((item: string) => item.startsWith('harmonic:'));
      const rightHasHarmonic = (right.detectedPatterns || []).some((item: string) => item.startsWith('harmonic:'));

      if (leftHasHarmonic !== rightHasHarmonic) {
        return Number(rightHasHarmonic) - Number(leftHasHarmonic);
      }
    }

    return right.trendScore - left.trendScore;
  });
}

export async function runScan(admin: any, timeframe: string, mode = 'trend', bias = 'long') {
  const config = SCAN_TIMEFRAME_CONFIG[timeframe];
  if (!config) throw new Error(`Unsupported timeframe: ${timeframe}`);
  const scanMode = normalizeScanMode(mode);
  const scanBias = normalizeScanBias(bias);

  const symbols = await fetchTradableSymbols();
  const startedAt = Date.now();
  const runtimeSettings = await getRuntimeSettings(admin);

  await setAppState(admin, 'scanner', {
    isScanning: true,
    activeTimeframe: timeframe,
    activeMode: scanMode,
    activeBias: scanBias,
    progress: { completed: 0, total: symbols.length, percent: 0 },
  });

  const baseResults = await runBatches(
    symbols,
    REQUESTS_PER_SECOND,
    async (symbol) => {
      const candles = await fetchCandles(symbol, config.interval, config.limit);
      if (candles.length < config.limit) return null;

      const metrics = evaluateTrend(candles);
      const passesTrend = passesTrendThresholds(metrics, runtimeSettings.thresholds, scanBias);
      if (scanMode === 'trend' && !passesTrend) return null;

      return {
        symbol,
        timeframe,
        setupSide: scanBias,
        trendScore: calculateTrendScore(metrics, runtimeSettings, scanBias),
        rSquared: metrics.rSquared,
        slope: metrics.slope,
        slopePctPerBar: metrics.slopePctPerBar,
        pullbackRatio: metrics.pullbackRatio,
        volumeRatio: metrics.volumeRatio,
        priceChangePct: metrics.priceChange,
        positionScore: metrics.positionScore,
        entryPrice: metrics.latestClose,
        currentPrice: metrics.latestClose,
        detectedPatterns: [],
        sparkline: buildSparkline(candles, config.sparkLimit),
        passesTrend,
      };
    },
    async (completed, total) => {
      await setAppState(admin, 'scanner', {
        isScanning: true,
        activeTimeframe: timeframe,
        activeMode: scanMode,
        activeBias: scanBias,
        progress: { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 },
      });
    },
  );

  baseResults.sort((left, right) => right.trendScore - left.trendScore);
  const candidatesForPatterns =
    scanMode === 'trend' ? baseResults.slice(0, runtimeSettings.scan.patternDetectionLimit) : baseResults;
  const patternMap = new Map<string, string[]>();
  const patternDetails = new Map<string, any>();

  await runBatches(candidatesForPatterns, Math.max(1, Math.floor(REQUESTS_PER_SECOND / 2)), async (result) => {
    const candles = await fetchCandles(result.symbol, '1h', 240);
    const patterns = detectAllPatterns(candles);
    patternDetails.set(result.symbol, patterns);
    patternMap.set(result.symbol, summarizePatterns(patterns));
    return result.symbol;
  });

  const results = sortResultsForMode(
    baseResults
      .map((result) => {
        const patterns = patternDetails.get(result.symbol) || null;
        const actionableHarmonic = getActionableHarmonic(patterns, scanBias);
        const detectedPatterns = patternMap.get(result.symbol) || [];

        if (scanMode === 'harmonic' && !actionableHarmonic) {
          return null;
        }

        if (scanMode === 'hybrid' && !result.passesTrend && !actionableHarmonic) {
          return null;
        }

        return {
          ...result,
          detectedPatterns,
        };
      })
      .filter(Boolean),
    scanMode,
  );

  const scannedAt = new Date().toISOString();
  const meta = {
    mode: scanMode,
    bias: scanBias,
    timeframe,
    totalSymbols: symbols.length,
    filteredCount: results.length,
    scannedAt,
    durationMs: Date.now() - startedAt,
  };

  await recordScan(admin, {
    timeframe,
    totalSymbols: symbols.length,
    filteredCount: results.length,
    params: { mode: scanMode, bias: scanBias, interval: config.interval, limit: config.limit, requestsPerSecond: REQUESTS_PER_SECOND, runtimeSettings },
    scannedAt,
    results,
  });

  const previousScanner = (await getAppState(admin, 'scanner')) || {};
  const previousCacheMeta = previousScanner.cacheMeta || {};
  const nextCacheMeta =
    scanMode === 'trend' && scanBias === 'long'
      ? { ...previousCacheMeta, [timeframe]: meta, [`${timeframe}:${scanMode}:${scanBias}`]: meta }
      : { ...previousCacheMeta, [`${timeframe}:${scanMode}:${scanBias}`]: meta };

  await setAppState(admin, 'scanner', {
    isScanning: false,
    activeTimeframe: null,
    activeMode: 'trend',
    activeBias: 'long',
    lastScanAt: scannedAt,
    nextScanAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    lastDurationMs: meta.durationMs,
    progress: { completed: symbols.length, total: symbols.length, percent: 100 },
    cacheMeta: nextCacheMeta,
  });

  return { results, meta };
}

export async function runBacktest(admin: any) {
  const pending = await listPendingBacktests(admin, 60);
  const runtimeSettings = await getRuntimeSettings(admin);
  await setAppState(admin, 'backtest', { isRunning: true, lastProcessed: 0 });

  let processed = 0;
  for (const entry of pending) {
    const createdAtMs = new Date(entry.created_at).getTime();
    const endTime = Math.min(createdAtMs + 72 * 60 * 60 * 1000, Date.now());
    const candles = await fetchCandles(entry.symbol, '1h', runtimeSettings.backtest.lookupCandleLimit, { startTime: createdAtMs, endTime });
    if (!candles.length) continue;

    const rangeStats = calculateRangeStats(candles, Number(entry.entry_price));
    await updateBacktestEntry(admin, entry.id, {
      updated_at: new Date().toISOString(),
      price_1h: entry.price_1h ?? pickPriceAtHours(candles, createdAtMs, 1),
      price_4h: entry.price_4h ?? pickPriceAtHours(candles, createdAtMs, 4),
      price_12h: entry.price_12h ?? pickPriceAtHours(candles, createdAtMs, 12),
      price_24h: entry.price_24h ?? pickPriceAtHours(candles, createdAtMs, 24),
      price_48h: entry.price_48h ?? pickPriceAtHours(candles, createdAtMs, 48),
      price_72h: entry.price_72h ?? pickPriceAtHours(candles, createdAtMs, 72),
      max_profit_pct: rangeStats.maxProfitPct,
      max_drawdown_pct: rangeStats.maxDrawdownPct,
    });
    processed += 1;
  }

  const lastRunAt = new Date().toISOString();
  await setAppState(admin, 'backtest', {
    isRunning: false,
    lastRunAt,
    nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    lastProcessed: processed,
  });

  return { processed, lastRunAt };
}
