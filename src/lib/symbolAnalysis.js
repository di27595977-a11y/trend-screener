import { getSymbolCandles, getSymbolOverview, getTradableSymbols } from '../services/binanceApi';
import {
  SCAN_TIMEFRAME_CONFIG,
  buildSparkline,
  evaluateTrend,
  getDirectionalMetrics,
  normalizeTradeBias,
  passesTrendThresholds,
} from '../services/indicators';
import { detectAllPatterns } from '../services/patternDetection';
import { calculateTrendScore } from '../utils/scoring';
import { generateTradeAdvice } from './tradeAdvisor';

function buildTradeLevels(patterns) {
  const supportLevels = (patterns?.supportResistance || [])
    .filter((level) => level.type === 'support')
    .map((level) => ({ price: level.price, touches: level.touches }))
    .sort((left, right) => left.price - right.price);
  const resistanceLevels = (patterns?.supportResistance || [])
    .filter((level) => level.type === 'resistance')
    .map((level) => ({ price: level.price, touches: level.touches }))
    .sort((left, right) => left.price - right.price);

  return { supportLevels, resistanceLevels };
}

function buildAdvisorPatterns(patterns) {
  const harmonicPattern = patterns?.harmonics?.find((pattern) => ['forming', 'confirmed'].includes(pattern.status?.key)) || null;

  if (!patterns) {
    return {
      harmonic: null,
      wBottom: null,
      mTop: null,
      triangle: null,
    };
  }

  return {
    harmonic: harmonicPattern
      ? {
          type: harmonicPattern.key,
          direction: harmonicPattern.direction,
          prz: harmonicPattern.przRange,
          stopLoss: harmonicPattern.stopLoss,
          t1: harmonicPattern.target1,
          t2: harmonicPattern.target2,
          confidence: harmonicPattern.confidence,
          reactionConfirmed: harmonicPattern.reactionConfirmed,
        }
      : null,
    wBottom: patterns.wBottom ? { neckline: patterns.wBottom.necklinePrice } : null,
    mTop: patterns.mTop ? { neckline: patterns.mTop.necklinePrice } : null,
    triangle: patterns.triangle ? { type: patterns.triangle.type } : null,
  };
}

function normalizeOverviewResults(overview) {
  return (overview?.results || []).map((item) => ({
    timeframe: item.timeframe,
    scanMode: item.scan_mode ?? item.scanMode ?? 'trend',
    setupSide: item.setup_side ?? item.setupSide ?? 'long',
    trendScore: item.trend_score ?? item.trendScore ?? null,
    detectedPatterns: item.detected_patterns ?? item.detectedPatterns ?? [],
    entryPrice: item.entry_price ?? item.entryPrice ?? null,
    createdAt: item.created_at ?? item.createdAt ?? null,
  }));
}

function formatRangeLabel(min, max) {
  return `${Number(min).toFixed(2)} - ${Number(max).toFixed(2)}`;
}

function buildThresholdChecks(metrics, settings, bias = 'long') {
  const tradeBias = normalizeTradeBias(bias);
  const thresholds = settings.thresholds;
  const scoring = settings.scoring;
  const directional = getDirectionalMetrics(metrics, tradeBias);
  const priceChangePass = directional.priceChange >= thresholds.minPriceChange && directional.priceChange <= thresholds.maxPriceChange;
  const positionPass = directional.positionScore >= scoring.preferredPositionMin && directional.positionScore <= scoring.preferredPositionMax;

  return [
    {
      key: 'rSquared',
      label: `R² ${metrics.rSquared.toFixed(2)} / >= ${thresholds.minRSquared.toFixed(2)}`,
      pass: metrics.rSquared >= thresholds.minRSquared,
      required: true,
      shortLabel: 'R²',
    },
    {
      key: 'slope',
      label: tradeBias === 'short' ? '斜率向下，符合空頭趨勢' : '斜率向上，符合多頭趨勢',
      pass: directional.slope > 0,
      required: true,
      shortLabel: tradeBias === 'short' ? '空斜率' : '多斜率',
    },
    {
      key: 'pullback',
      label: `${tradeBias === 'short' ? '反彈' : '回調'} ${(directional.pullbackRatio * 100).toFixed(1)}% / <= ${(
        thresholds.maxPullbackRatio * 100
      ).toFixed(1)}%`,
      pass: directional.pullbackRatio <= thresholds.maxPullbackRatio,
      required: true,
      shortLabel: tradeBias === 'short' ? '反彈' : '回調',
    },
    {
      key: 'volume',
      label: `量比 ${directional.volumeRatio.toFixed(2)}x / >= ${thresholds.minVolumeRatio.toFixed(2)}x`,
      pass: directional.volumeRatio >= thresholds.minVolumeRatio,
      required: true,
      shortLabel: '量比',
    },
    {
      key: 'priceChange',
      label: `${tradeBias === 'short' ? '跌幅' : '漲幅'} ${directional.priceChange.toFixed(1)}% / ${thresholds.minPriceChange}% - ${
        thresholds.maxPriceChange
      }%`,
      pass: priceChangePass,
      required: true,
      shortLabel: tradeBias === 'short' ? '跌幅' : '漲幅',
    },
    {
      key: 'position',
      label: `${tradeBias === 'short' ? '空方位置' : '相對位置'} ${(directional.positionScore * 100).toFixed(0)}% / ${formatRangeLabel(
        scoring.preferredPositionMin * 100,
        scoring.preferredPositionMax * 100,
      )}%`,
      pass: positionPass,
      required: false,
      shortLabel: tradeBias === 'short' ? '空位' : '位置',
    },
  ];
}

function classifyTimeframe(checks, score, settings) {
  const hardFails = checks.filter((item) => item.required !== false && !item.pass).length;

  if (hardFails === 0) {
    return 'passed';
  }

  if (hardFails <= 2 || score >= Math.max(0, settings.scan.minScoreDefault - 5)) {
    return 'near';
  }

  return 'failed';
}

function buildSummary(status, checks, matchedLatestScan, timeframe, bias = 'long') {
  const biasLabel = normalizeTradeBias(bias) === 'short' ? '做空模型' : '做多模型';
  const failed = checks.filter((item) => item.required !== false && !item.pass).map((item) => item.shortLabel);

  if (matchedLatestScan) {
    return `目前已經命中 ${timeframe.toUpperCase()} ${biasLabel} 的最新掃描結果。`;
  }

  if (status === 'passed') {
    return `${timeframe.toUpperCase()} 已符合 ${biasLabel} 的主要條件，可以進一步看圖確認。`;
  }

  if (status === 'near') {
    return failed.length ? `還差 ${failed.slice(0, 2).join('、')}，已經接近 ${biasLabel} 條件。` : `目前接近 ${biasLabel} 條件。`;
  }

  return failed.length ? `目前主要卡在 ${failed.slice(0, 3).join('、')}。` : `${timeframe.toUpperCase()} 目前還不符合 ${biasLabel}。`;
}

function normalizeSymbolError(symbol, error) {
  const message = error?.message || String(error);

  if (/binance request failed/i.test(message) || /Invalid symbol/i.test(message) || /invalid symbol/i.test(message)) {
    return new Error(`${symbol} 不是有效的 Binance USDT-M 永續合約代號。`);
  }

  return error instanceof Error ? error : new Error(message);
}

function normalizeSymbolInput(input) {
  const cleaned = String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (!cleaned) {
    return '';
  }

  return cleaned.endsWith('USDT') ? cleaned : `${cleaned}USDT`;
}

function normalizeSymbolCore(symbol) {
  return String(symbol || '')
    .toUpperCase()
    .replace(/USDT$/, '');
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let count = 0;

  while (count < limit && left[count] === right[count]) {
    count += 1;
  }

  return count;
}

function rankSuggestedSymbols(query, symbols, limit = 3) {
  const needle = normalizeSymbolCore(query).replace(/[^A-Z0-9]/g, '');

  if (!needle) {
    return [];
  }

  return symbols
    .map((symbol) => {
      const base = normalizeSymbolCore(symbol);
      const prefixLength = commonPrefixLength(base, needle);
      let score = 0;

      if (base === needle) score = 1000;
      if (symbol === `${needle}USDT`) score = Math.max(score, 995);
      if (base.startsWith(needle)) score = Math.max(score, 940 - (base.length - needle.length));
      if (base.includes(needle)) score = Math.max(score, 860 - base.indexOf(needle) * 5);
      if (needle.startsWith(base)) score = Math.max(score, 780 - (needle.length - base.length) * 5);
      if (`${needle}T` === base || needle === `${base}T`) score = Math.max(score, 930);
      score = Math.max(score, prefixLength * 40 - Math.abs(base.length - needle.length) * 3);

      return { symbol, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
    .slice(0, limit)
    .map((item) => item.symbol);
}

function isInvalidSymbolError(error) {
  const message = error?.message || String(error);
  return /binance request failed/i.test(message) || /invalid symbol/i.test(message);
}

async function enrichSymbolLookupError(symbol, error) {
  if (!isInvalidSymbolError(error)) {
    return normalizeSymbolError(symbol, error);
  }

  try {
    const suggestions = rankSuggestedSymbols(symbol, await getTradableSymbols());

    if (suggestions.length) {
      return new Error(`${symbol} 不在 Binance USDT-M 永續清單裡，你是不是想找 ${suggestions.join('、')}？`);
    }
  } catch {
    // Ignore and fall back to the base error.
  }

  return normalizeSymbolError(symbol, error);
}

function getLatestSnapshotMeta(scannerStatus, timeframe, mode = 'trend', bias = 'long') {
  const cacheMeta = scannerStatus?.scanner?.cacheMeta || {};
  return cacheMeta[`${timeframe}:${mode}:${bias}`] || (mode === 'trend' && bias === 'long' ? cacheMeta[timeframe] : null) || null;
}

function buildTimeframeAnalysis(symbol, timeframe, candles, settings, overviewMap, scannerStatus, { mode = 'trend', bias = 'long' } = {}) {
  const metrics = evaluateTrend(candles);
  const directional = getDirectionalMetrics(metrics, bias);
  const score = calculateTrendScore(metrics, settings, bias);
  const passes = passesTrendThresholds(metrics, settings.thresholds, bias);
  const checks = buildThresholdChecks(metrics, settings, bias);
  const latestHit = overviewMap.get(`${timeframe}:${mode}:${bias}`) || null;
  const latestMeta = getLatestSnapshotMeta(scannerStatus, timeframe, mode, bias);
  const latestScanAt = latestMeta?.scannedAt || latestMeta?.scanned_at || null;
  const matchedLatestScan = Boolean(latestHit?.createdAt && latestScanAt && new Date(latestHit.createdAt).getTime() === new Date(latestScanAt).getTime());
  const status = classifyTimeframe(checks, score, settings);

  return {
    symbol,
    timeframe,
    status,
    passes,
    score,
    metrics: {
      rSquared: metrics.rSquared,
      slope: metrics.slope,
      slopePctPerBar: metrics.slopePctPerBar,
      pullbackRatio: directional.pullbackRatio,
      volumeRatio: directional.volumeRatio,
      priceChangePercent: directional.priceChange,
      positionScore: directional.positionScore,
      latestClose: metrics.latestClose,
    },
    checks,
    summary: buildSummary(status, checks, matchedLatestScan, timeframe, bias),
    sparkline: buildSparkline(candles, Math.min(candles.length, 24)),
    latestCandidate: latestHit,
    matchedLatestScan,
  };
}

export async function analyzeSymbol(input, { settings, scannerStatus, mode = 'trend', bias = 'long' } = {}) {
  const symbol = normalizeSymbolInput(input);
  const tradeBias = normalizeTradeBias(bias);

  if (!symbol) {
    throw new Error('請先輸入要查詢的幣種，例如 BTC 或 ETHUSDT。');
  }

  try {
    const overviewPromise = getSymbolOverview(symbol).catch(() => null);
    const [overview, candles1h, candles4h, detailCandles] = await Promise.all([
      overviewPromise,
      getSymbolCandles(symbol, { interval: '1h', limit: SCAN_TIMEFRAME_CONFIG['1h'].limit }),
      getSymbolCandles(symbol, { interval: '4h', limit: SCAN_TIMEFRAME_CONFIG['4h'].limit }),
      getSymbolCandles(symbol, { interval: '1h', limit: 72 }),
    ]);

    if ((candles1h.candles || []).length < SCAN_TIMEFRAME_CONFIG['1h'].limit) {
      throw new Error(`${symbol} 的 1H 資料不足，無法完成即時分析。`);
    }

    if ((candles4h.candles || []).length < SCAN_TIMEFRAME_CONFIG['4h'].limit) {
      throw new Error(`${symbol} 的 4H 資料不足，無法完成即時分析。`);
    }

    if ((detailCandles.candles || []).length < 72) {
      throw new Error(`${symbol} 的 72 根 1H 細節資料不足，無法完成形態與交易建議。`);
    }

    const normalizedOverview = normalizeOverviewResults(overview);
    const overviewMap = new Map(normalizedOverview.map((item) => [`${item.timeframe}:${item.scanMode}:${item.setupSide}`, item]));
    const timeframes = ['1h', '4h'].map((timeframe) =>
      buildTimeframeAnalysis(
        symbol,
        timeframe,
        timeframe === '1h' ? candles1h.candles : candles4h.candles,
        settings,
        overviewMap,
        scannerStatus,
        { mode, bias: tradeBias },
      ),
    );
    const detailPatterns = detectAllPatterns(detailCandles.candles);
    const tradeLevels = buildTradeLevels(detailPatterns);
    const oneHour = timeframes.find((item) => item.timeframe === '1h');
    const currentPrice = detailCandles.candles.at(-1)?.close ?? oneHour?.metrics?.latestClose ?? null;
    const tradeAdvice = generateTradeAdvice({
      currentPrice,
      positionScore: oneHour?.metrics?.positionScore,
      score: oneHour?.score,
      priceChangePercent: oneHour?.metrics?.priceChangePercent,
      patterns: buildAdvisorPatterns(detailPatterns),
      supportLevels: tradeLevels.supportLevels,
      resistanceLevels: tradeLevels.resistanceLevels,
      pullbackRatio: oneHour?.metrics?.pullbackRatio,
      rSquared: oneHour?.metrics?.rSquared,
      volumeRatio: oneHour?.metrics?.volumeRatio,
      modelBias: tradeBias,
    });
    const currentScanMatches = timeframes.filter((item) => item.matchedLatestScan).map((item) => item.timeframe);

    return {
      input,
      symbol,
      currentPrice,
      currentScanMatches,
      overview: {
        best: overview?.best || null,
        results: normalizedOverview,
      },
      timeframes,
      detail: {
        patterns: detailPatterns,
        tradeAdvice,
      },
    };
  } catch (error) {
    throw await enrichSymbolLookupError(symbol, error);
  }
}

export { normalizeSymbolInput };
