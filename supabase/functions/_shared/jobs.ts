import { fetchCandles, fetchTradableSymbols } from './binance.ts';
import {
  SCAN_TIMEFRAME_CONFIG,
  buildSparkline,
  calculateTrendScore,
  detectAllPatterns,
  evaluateTrend,
  passesTrendThresholds,
  summarizePatterns,
} from './logic.ts';
import { listPendingBacktests, recordScan, setAppState, updateBacktestEntry } from './db.ts';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REQUESTS_PER_SECOND = Math.max(Number.parseInt(Deno.env.get('BINANCE_REQUESTS_PER_SECOND') || '4', 10), 1);
const PATTERN_DETECTION_LIMIT = 50;
const BACKTEST_LOOKUP_CANDLE_LIMIT = 100;

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

export async function runScan(admin: any, timeframe: string) {
  const config = SCAN_TIMEFRAME_CONFIG[timeframe];
  if (!config) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const symbols = await fetchTradableSymbols();
  const startedAt = Date.now();

  await setAppState(admin, 'scanner', {
    isScanning: true,
    activeTimeframe: timeframe,
    progress: { completed: 0, total: symbols.length, percent: 0 },
  });

  const baseResults = await runBatches(
    symbols,
    REQUESTS_PER_SECOND,
    async (symbol) => {
      const candles = await fetchCandles(symbol, config.interval, config.limit);
      if (candles.length < config.limit) return null;

      const metrics = evaluateTrend(candles);
      if (!passesTrendThresholds(metrics)) return null;

      return {
        symbol,
        timeframe,
        trendScore: calculateTrendScore(metrics),
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
      };
    },
    async (completed, total) => {
      await setAppState(admin, 'scanner', {
        isScanning: true,
        activeTimeframe: timeframe,
        progress: { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 },
      });
    },
  );

  baseResults.sort((left, right) => right.trendScore - left.trendScore);
  const topForPatterns = baseResults.slice(0, PATTERN_DETECTION_LIMIT);
  const patternMap = new Map<string, string[]>();

  await runBatches(topForPatterns, Math.max(1, Math.floor(REQUESTS_PER_SECOND / 2)), async (result) => {
    const candles = await fetchCandles(result.symbol, '1h', 72);
    patternMap.set(result.symbol, summarizePatterns(detectAllPatterns(candles)));
    return result.symbol;
  });

  const results = baseResults.map((result) => ({
    ...result,
    detectedPatterns: patternMap.get(result.symbol) || [],
  }));

  const scannedAt = new Date().toISOString();
  const meta = {
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
    params: { interval: config.interval, limit: config.limit, requestsPerSecond: REQUESTS_PER_SECOND },
    scannedAt,
    results,
  });

  await setAppState(admin, 'scanner', {
    isScanning: false,
    activeTimeframe: null,
    lastScanAt: scannedAt,
    nextScanAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    lastDurationMs: meta.durationMs,
    progress: { completed: symbols.length, total: symbols.length, percent: 100 },
    cacheMeta: { [timeframe]: meta },
  });

  return { results, meta };
}

export async function runBacktest(admin: any) {
  const pending = await listPendingBacktests(admin, 60);
  await setAppState(admin, 'backtest', { isRunning: true, lastProcessed: 0 });

  let processed = 0;
  for (const entry of pending) {
    const createdAtMs = new Date(entry.created_at).getTime();
    const endTime = Math.min(createdAtMs + 72 * 60 * 60 * 1000, Date.now());
    const candles = await fetchCandles(entry.symbol, '1h', BACKTEST_LOOKUP_CANDLE_LIMIT, { startTime: createdAtMs, endTime });
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
