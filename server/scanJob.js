import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { DEFAULT_RUNTIME_SETTINGS } from '../src/config/runtimeSettings.js';
import { SCAN_TIMEFRAME_CONFIG, buildSparkline, evaluateTrend, normalizeTradeBias, passesTrendThresholds } from '../src/services/indicators.js';
import { detectAllPatterns, summarizePatterns } from '../src/services/patternDetection.js';
import { calculateTrendScore } from '../src/utils/scoring.js';
import { createPersistenceLayer } from './persistence.js';
import { loadModel, isModelReady, predictSymbol } from './ml/predict.js';

dotenv.config();

const ENABLE_ML = process.env.ENABLE_ML === 'true';
const ML_TOP_N  = Math.max(Number.parseInt(process.env.ML_TOP_N || '20', 10), 1);

const API_BASE = process.env.BINANCE_API_BASE || 'https://fapi.binance.com';
const REQUESTS_PER_SECOND = Math.max(Number.parseInt(process.env.BINANCE_REQUESTS_PER_SECOND || '4', 10), 1);
const SYMBOL_LIMIT = process.env.BINANCE_SYMBOL_LIMIT ? Number.parseInt(process.env.BINANCE_SYMBOL_LIMIT, 10) : null;
const SCAN_INTERVAL_MS = Math.max(Number.parseInt(process.env.SCAN_INTERVAL_MINUTES || '5', 10), 1) * 60 * 1000;
const ACTIVE_HARMONIC_STATUSES = new Set(['forming', 'confirmed', 'tp1_hit']);
const HARMONIC_MIN_SCORE_FLOOR = 40;
const HYBRID_HARMONIC_MIN_SCORE_FLOOR = 45;

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

function normalizeScanMode(mode = 'trend') {
  return ['trend', 'harmonic', 'hybrid'].includes(mode) ? mode : 'trend';
}

function normalizeScanBias(bias = 'long') {
  return normalizeTradeBias(bias);
}

function getPatternHarmonics(patterns) {
  if (!patterns) {
    return [];
  }

  if (patterns.harmonics?.length) {
    return patterns.harmonics;
  }

  return patterns.harmonic ? [patterns.harmonic] : [];
}

function getActionableHarmonic(patterns, bias = 'long') {
  const targetDirection = normalizeScanBias(bias) === 'short' ? 'bearish' : 'bullish';
  return getPatternHarmonics(patterns).find(
    (pattern) => pattern.direction === targetDirection && ACTIVE_HARMONIC_STATUSES.has(pattern.status?.key),
  ) || null;
}

function sortResultsForMode(results, mode) {
  const scanMode = normalizeScanMode(mode);

  return [...results].sort((left, right) => {
    if (scanMode !== 'trend') {
      const leftHasHarmonic = (left.detectedPatterns || []).some((item) => item.startsWith('harmonic:'));
      const rightHasHarmonic = (right.detectedPatterns || []).some((item) => item.startsWith('harmonic:'));

      if (leftHasHarmonic !== rightHasHarmonic) {
        return rightHasHarmonic - leftHasHarmonic;
      }
    }

    return right.trendScore - left.trendScore;
  });
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

function toScanResult(symbol, timeframe, candles, metrics, bias = 'long', settings = DEFAULT_RUNTIME_SETTINGS) {
  return {
    symbol,
    timeframe,
    setupSide: normalizeScanBias(bias),
    trendScore: calculateTrendScore(metrics, settings, bias),
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

function filterResults(results, minScore, patterns, mode = 'trend') {
  const scanMode = normalizeScanMode(mode);

  return sortResultsForMode(results, scanMode).filter((result) => {
    const hasHarmonic = result.detectedPatterns.some((item) => item.startsWith('harmonic:'));
    const effectiveMinScore =
      scanMode === 'harmonic'
        ? Math.min(minScore, HARMONIC_MIN_SCORE_FLOOR)
        : scanMode === 'hybrid' && hasHarmonic
          ? Math.min(minScore, HYBRID_HARMONIC_MIN_SCORE_FLOOR)
          : minScore;

    if (result.trendScore < effectiveMinScore) {
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
    this.mlReady = false;
    this.status = {
      isScanning: false,
      activeTimeframe: null,
      activeMode: 'trend',
      activeBias: 'long',
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

    if (ENABLE_ML) {
      loadModel().then((ready) => {
        this.mlReady = ready;
        if (ready) this.logger.log('[ML] Model loaded and ready for inference.');
        else this.logger.warn('[ML] ENABLE_ML=true but model not found. Train the model first.');
      });
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
    for (const timeframe of ['1h', '4h']) {
      for (const bias of ['long', 'short']) {
        await this.scanTimeframe(timeframe, { force: true, mode: 'trend', bias });
      }
    }
  }

  async scanTimeframe(timeframe, { force = false, mode = 'trend', bias = 'long' } = {}) {
    if (!SCAN_TIMEFRAME_CONFIG[timeframe]) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }

    const scanMode = normalizeScanMode(mode);
    const scanBias = normalizeScanBias(bias);
    const cacheKey = `${timeframe}:${scanMode}:${scanBias}`;
    const cached = this.cache.get(cacheKey);

    if (!force && cached && Date.now() - new Date(cached.meta.scannedAt).getTime() < this.scanIntervalMs) {
      return cached;
    }

    if (
      this.status.isScanning &&
      this.status.activeTimeframe === timeframe &&
      this.status.activeMode === scanMode &&
      this.status.activeBias === scanBias
    ) {
      return cached || { results: [], meta: { timeframe } };
    }

    const config = SCAN_TIMEFRAME_CONFIG[timeframe];
    const symbols = await this.ensureSymbols();
    const startedAt = Date.now();
    const runtimeSettings = (await this.persistence?.getRuntimeSettings?.()) || DEFAULT_RUNTIME_SETTINGS;

    this.status.isScanning = true;
    this.status.activeTimeframe = timeframe;
    this.status.activeMode = scanMode;
    this.status.activeBias = scanBias;
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
        const passesTrend = passesTrendThresholds(metrics, runtimeSettings.thresholds, scanBias);

        if (scanMode === 'trend' && !passesTrend) {
          return null;
        }

        return {
          ...toScanResult(symbol, timeframe, candles, metrics, scanBias, runtimeSettings),
          passesTrend,
        };
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

    const candidatesForPatterns =
      scanMode === 'trend' ? baseResults.slice(0, runtimeSettings.scan.patternDetectionLimit) : baseResults;
    const patternSummaries = new Map();
    const patternDetails = new Map();

    await runBatches(candidatesForPatterns, Math.max(1, Math.floor(this.requestsPerSecond / 2)), async (result) => {
      const candles = await fetchCandles(result.symbol, '1h', 240);
      const patterns = detectAllPatterns(candles);
      patternDetails.set(result.symbol, patterns);
      patternSummaries.set(result.symbol, summarizePatterns(patterns));
      return result.symbol;
    });

    const results = sortResultsForMode(
      baseResults
        .map((result) => {
          const patterns = patternDetails.get(result.symbol) || null;
          const actionableHarmonic = getActionableHarmonic(patterns, scanBias);
          const detectedPatterns = patternSummaries.get(result.symbol) || [];

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

    this.cache.set(cacheKey, { results, meta });
    this.status.cacheMeta[cacheKey] = meta;
    if (scanMode === 'trend' && scanBias === 'long') {
      this.status.cacheMeta[timeframe] = meta;
    }
    this.status.lastScanAt = scannedAt;
    this.status.lastDurationMs = meta.durationMs;
    this.status.nextScanAt = new Date(Date.now() + this.scanIntervalMs).toISOString();
    this.status.isScanning = false;
    this.status.activeTimeframe = null;
    this.status.activeMode = 'trend';
    this.status.activeBias = 'long';
    this.status.progress = { completed: symbols.length, total: symbols.length, percent: 100 };

    // ML inference on top results
    if (ENABLE_ML && this.mlReady && isModelReady()) {
      const topSymbols = results.slice(0, ML_TOP_N).map((r) => r.symbol);
      const mlMap = new Map();
      for (const sym of topSymbols) {
        try {
          const pred = await predictSymbol(sym);
          if (pred) mlMap.set(sym, pred);
        } catch {
          // non-critical: skip on error
        }
        await sleep(Math.ceil(1000 / this.requestsPerSecond));
      }
      // Merge ML scores into results
      for (const result of results) {
        const pred = mlMap.get(result.symbol);
        if (pred) {
          result.mlScore     = pred.ml_score;
          result.mlDirection = pred.ml_direction;
          result.mlProb      = pred.ml_probability;
        }
      }
    }

    await this.persistence?.recordScan({
      timeframe,
      totalSymbols: symbols.length,
      filteredCount: results.length,
      params: {
        mode: scanMode,
        bias: scanBias,
        interval: config.interval,
        limit: config.limit,
        requestsPerSecond: this.requestsPerSecond,
        runtimeSettings,
      },
      results,
      scannedAt,
    });

    return { results, meta };
  }

  async getResults({ timeframe = '1h', minScore, patterns = [], force = false, mode = 'trend', bias = 'long' } = {}) {
    const scan = await this.scanTimeframe(timeframe, { force, mode, bias });
    const runtimeSettings = (await this.persistence?.getRuntimeSettings?.()) || DEFAULT_RUNTIME_SETTINGS;
    const filteredResults = filterResults(scan.results, minScore ?? runtimeSettings.scan.minScoreDefault, patterns, mode);

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
  const mode = process.argv[3] || 'trend';
  const bias = process.argv[4] || 'long';

  job
    .scanTimeframe(timeframe, { force: true, mode, bias })
    .then((result) => {
      console.log(JSON.stringify(result.meta, null, 2));
      console.log(`Candidates: ${result.results.length}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
