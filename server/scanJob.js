import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { SCAN_TIMEFRAME_CONFIG, buildSparkline, evaluateTrend, passesTrendThresholds } from '../src/services/indicators.js';
import { detectAllPatterns, summarizePatterns } from '../src/services/patternDetection.js';
import { calculateTrendScore } from '../src/utils/scoring.js';
import { createPersistenceLayer } from './persistence.js';

dotenv.config();

const API_BASE = process.env.BINANCE_API_BASE || 'https://fapi.binance.com';
const REQUESTS_PER_SECOND = Math.max(Number.parseInt(process.env.BINANCE_REQUESTS_PER_SECOND || '4', 10), 1);
const SYMBOL_LIMIT = process.env.BINANCE_SYMBOL_LIMIT ? Number.parseInt(process.env.BINANCE_SYMBOL_LIMIT, 10) : null;
const SCAN_INTERVAL_MS = Math.max(Number.parseInt(process.env.SCAN_INTERVAL_MINUTES || '5', 10), 1) * 60 * 1000;
const PATTERN_DETECTION_LIMIT = 50;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestJson(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Binance request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function normalizeKline(rawCandle) {
  return {
    time: rawCandle[0] / 1000,
    open: Number(rawCandle[1]),
    high: Number(rawCandle[2]),
    low: Number(rawCandle[3]),
    close: Number(rawCandle[4]),
    volume: Number(rawCandle[5]),
  };
}

export async function fetchTradableSymbols() {
  const data = await requestJson('/fapi/v1/exchangeInfo');
  const symbols = data.symbols
    .filter((item) => item.status === 'TRADING' && item.contractType === 'PERPETUAL' && item.quoteAsset === 'USDT')
    .map((item) => item.symbol);

  return SYMBOL_LIMIT ? symbols.slice(0, SYMBOL_LIMIT) : symbols;
}

export async function fetchCandles(symbol, interval, limit, extraParams = {}) {
  const data = await requestJson('/fapi/v1/klines', {
    symbol,
    interval,
    limit,
    ...extraParams,
  });

  return data.map(normalizeKline);
}

function toScanResult(symbol, timeframe, candles, metrics) {
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
    sparkline: buildSparkline(candles, SCAN_TIMEFRAME_CONFIG[timeframe].sparkLimit),
  };
}

async function runBatches(items, batchSize, worker, onProgress) {
  const results = [];
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

    results.push(...batchResults.filter(Boolean));
    completed += batch.length;
    onProgress?.(completed, items.length);

    if (index + batchSize < items.length) {
      await sleep(1000);
    }
  }

  return results;
}

function filterResults(results, minScore, patterns) {
  return results.filter((result) => {
    if (result.trendScore < minScore) {
      return false;
    }

    if (!patterns.length) {
      return true;
    }

    return patterns.every((pattern) => {
      if (pattern === 'triangle') {
        return result.detectedPatterns.some((item) => item.startsWith('triangle:'));
      }

      if (pattern === 'harmonic') {
        return result.detectedPatterns.some((item) => item.startsWith('harmonic:'));
      }

      return result.detectedPatterns.includes(pattern);
    });
  });
}

export class ScanJob {
  constructor({ persistence, logger = console, scanIntervalMs = SCAN_INTERVAL_MS } = {}) {
    this.persistence = persistence;
    this.logger = logger;
    this.scanIntervalMs = scanIntervalMs;
    this.requestsPerSecond = REQUESTS_PER_SECOND;
    this.symbols = [];
    this.symbolsFetchedAt = 0;
    this.cache = new Map();
    this.timer = null;
    this.status = {
      isScanning: false,
      activeTimeframe: null,
      lastScanAt: null,
      nextScanAt: new Date(Date.now() + scanIntervalMs).toISOString(),
      lastDurationMs: null,
      progress: {
        completed: 0,
        total: 0,
        percent: 0,
      },
      cacheMeta: {},
    };
  }

  async ensureSymbols() {
    const now = Date.now();

    if (this.symbols.length && now - this.symbolsFetchedAt < 60 * 60 * 1000) {
      return this.symbols;
    }

    this.symbols = await fetchTradableSymbols();
    this.symbolsFetchedAt = now;
    return this.symbols;
  }

  getStatus() {
    return this.status;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.refreshAll().catch((error) => {
      this.logger.error('Initial scan failed', error);
    });

    this.timer = setInterval(() => {
      this.refreshAll().catch((error) => {
        this.logger.error('Scheduled scan failed', error);
      });
    }, this.scanIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refreshAll() {
    await this.scanTimeframe('1h', { force: true });
    await this.scanTimeframe('4h', { force: true });
  }

  async scanTimeframe(timeframe, { force = false } = {}) {
    if (!SCAN_TIMEFRAME_CONFIG[timeframe]) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }

    const cached = this.cache.get(timeframe);

    if (!force && cached && Date.now() - new Date(cached.meta.scannedAt).getTime() < this.scanIntervalMs) {
      return cached;
    }

    if (this.status.isScanning && this.status.activeTimeframe === timeframe) {
      return cached || { results: [], meta: { timeframe } };
    }

    const config = SCAN_TIMEFRAME_CONFIG[timeframe];
    const symbols = await this.ensureSymbols();
    const startedAt = Date.now();

    this.status.isScanning = true;
    this.status.activeTimeframe = timeframe;
    this.status.progress = { completed: 0, total: symbols.length, percent: 0 };

    const baseResults = await runBatches(
      symbols,
      this.requestsPerSecond,
      async (symbol) => {
        const candles = await fetchCandles(symbol, config.interval, config.limit);

        if (candles.length < config.limit) {
          return null;
        }

        const metrics = evaluateTrend(candles);

        if (!passesTrendThresholds(metrics)) {
          return null;
        }

        return toScanResult(symbol, timeframe, candles, metrics);
      },
      (completed, total) => {
        this.status.progress = {
          completed,
          total,
          percent: total ? Math.round((completed / total) * 100) : 0,
        };
      },
    );

    baseResults.sort((left, right) => right.trendScore - left.trendScore);

    const topForPatterns = baseResults.slice(0, PATTERN_DETECTION_LIMIT);
    const patternSummaries = new Map();

    await runBatches(topForPatterns, Math.max(1, Math.floor(this.requestsPerSecond / 2)), async (result) => {
      const candles = await fetchCandles(result.symbol, '1h', 72);
      const patterns = detectAllPatterns(candles);
      patternSummaries.set(result.symbol, summarizePatterns(patterns));
      return result.symbol;
    });

    const results = baseResults.map((result) => ({
      ...result,
      detectedPatterns: patternSummaries.get(result.symbol) || [],
    }));

    const scannedAt = new Date().toISOString();
    const meta = {
      timeframe,
      totalSymbols: symbols.length,
      filteredCount: results.length,
      scannedAt,
      durationMs: Date.now() - startedAt,
    };

    this.cache.set(timeframe, { results, meta });
    this.status.cacheMeta[timeframe] = meta;
    this.status.lastScanAt = scannedAt;
    this.status.lastDurationMs = meta.durationMs;
    this.status.nextScanAt = new Date(Date.now() + this.scanIntervalMs).toISOString();
    this.status.isScanning = false;
    this.status.activeTimeframe = null;
    this.status.progress = { completed: symbols.length, total: symbols.length, percent: 100 };

    await this.persistence?.recordScan({
      timeframe,
      totalSymbols: symbols.length,
      filteredCount: results.length,
      params: {
        interval: config.interval,
        limit: config.limit,
        requestsPerSecond: this.requestsPerSecond,
      },
      results,
      scannedAt,
    });

    return { results, meta };
  }

  async getResults({ timeframe = '1h', minScore = 55, patterns = [], force = false } = {}) {
    const scan = await this.scanTimeframe(timeframe, { force });
    const filteredResults = filterResults(scan.results, minScore, patterns);

    return {
      results: filteredResults,
      meta: scan.meta,
    };
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const persistence = createPersistenceLayer();
  const job = new ScanJob({ persistence });
  const timeframe = process.argv[2] || '1h';

  job
    .scanTimeframe(timeframe, { force: true })
    .then((result) => {
      console.log(JSON.stringify(result.meta, null, 2));
      console.log(`Candidates: ${result.results.length}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
