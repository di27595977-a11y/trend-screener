import { getSymbolCandles, getSymbolOverview } from '../services/binanceApi';
import { SCAN_TIMEFRAME_CONFIG, buildSparkline, evaluateTrend, passesTrendThresholds } from '../services/indicators';
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
  if (!patterns) {
    return {
      harmonic: null,
      wBottom: null,
      mTop: null,
      triangle: null,
    };
  }

  return {
    harmonic: patterns.harmonic
      ? {
          type: patterns.harmonic.key,
          direction: patterns.harmonic.direction,
          prz: patterns.harmonic.przRange,
          stopLoss: patterns.harmonic.stopLoss,
          t1: patterns.harmonic.target1,
          t2: patterns.harmonic.target2,
          confidence: patterns.harmonic.confidence,
          reactionConfirmed: patterns.harmonic.reactionConfirmed,
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
    trendScore: item.trend_score ?? item.trendScore ?? null,
    detectedPatterns: item.detected_patterns ?? item.detectedPatterns ?? [],
    entryPrice: item.entry_price ?? item.entryPrice ?? null,
    createdAt: item.created_at ?? item.createdAt ?? null,
  }));
}

function formatRangeLabel(min, max) {
  return `${Number(min).toFixed(2)} - ${Number(max).toFixed(2)}`;
}

function buildThresholdChecks(metrics, settings) {
  const thresholds = settings.thresholds;
  const scoring = settings.scoring;
  const priceChangePass = metrics.priceChange >= thresholds.minPriceChange && metrics.priceChange <= thresholds.maxPriceChange;
  const positionPass = metrics.positionScore >= scoring.preferredPositionMin && metrics.positionScore <= scoring.preferredPositionMax;

  return [
    {
      key: 'rSquared',
      label: `R² ${metrics.rSquared.toFixed(2)} / 需 >= ${thresholds.minRSquared.toFixed(2)}`,
      pass: metrics.rSquared >= thresholds.minRSquared,
      required: true,
      shortLabel: 'R²',
    },
    {
      key: 'slope',
      label: metrics.slope > 0 ? '斜率維持向上' : '斜率尚未翻正',
      pass: metrics.slope > 0,
      required: true,
      shortLabel: '斜率',
    },
    {
      key: 'pullback',
      label: `回調 ${(metrics.pullbackRatio * 100).toFixed(1)}% / 需 <= ${(thresholds.maxPullbackRatio * 100).toFixed(1)}%`,
      pass: metrics.pullbackRatio <= thresholds.maxPullbackRatio,
      required: true,
      shortLabel: '回調',
    },
    {
      key: 'volume',
      label: `量比 ${metrics.volumeRatio.toFixed(2)}x / 需 >= ${thresholds.minVolumeRatio.toFixed(2)}x`,
      pass: metrics.volumeRatio >= thresholds.minVolumeRatio,
      required: true,
      shortLabel: '量比',
    },
    {
      key: 'priceChange',
      label: `漲幅 ${metrics.priceChange.toFixed(1)}% / 需介於 ${thresholds.minPriceChange}% - ${thresholds.maxPriceChange}%`,
      pass: priceChangePass,
      required: true,
      shortLabel: '漲幅',
    },
    {
      key: 'position',
      label: `位置 ${(metrics.positionScore * 100).toFixed(0)}% / 偏好 ${formatRangeLabel(
        scoring.preferredPositionMin * 100,
        scoring.preferredPositionMax * 100,
      )}%`,
      pass: positionPass,
      required: false,
      shortLabel: '位置',
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

function buildSummary(status, checks, matchedLatestScan, timeframe) {
  const failed = checks.filter((item) => item.required !== false && !item.pass).map((item) => item.shortLabel);

  if (matchedLatestScan) {
    return `目前已在最新 ${timeframe.toUpperCase()} 掃描榜上。`;
  }

  if (status === 'passed') {
    return `目前條件已達標，下一輪 ${timeframe.toUpperCase()} 掃描有機會上榜。`;
  }

  if (status === 'near') {
    return failed.length ? `距離上榜主要差在 ${failed.slice(0, 2).join('、')}。` : '整體接近上榜條件。';
  }

  return failed.length ? `目前主要卡在 ${failed.slice(0, 3).join('、')}。` : `目前 ${timeframe.toUpperCase()} 尚未達到篩選條件。`;
}

function normalizeSymbolError(symbol, error) {
  const message = error?.message || String(error);

  if (/binance request failed/i.test(message) || /Invalid symbol/i.test(message) || /invalid symbol/i.test(message)) {
    return new Error(`${symbol} 目前不是有效的 Binance USDT-M 永續合約，請確認代號是否正確。`);
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

function getLatestSnapshotMeta(scannerStatus, timeframe) {
  return scannerStatus?.scanner?.cacheMeta?.[timeframe] || null;
}

function buildTimeframeAnalysis(symbol, timeframe, candles, settings, overviewMap, scannerStatus) {
  const metrics = evaluateTrend(candles);
  const score = calculateTrendScore(metrics, settings);
  const passes = passesTrendThresholds(metrics, settings.thresholds);
  const checks = buildThresholdChecks(metrics, settings);
  const latestHit = overviewMap.get(timeframe) || null;
  const latestMeta = getLatestSnapshotMeta(scannerStatus, timeframe);
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
      pullbackRatio: metrics.pullbackRatio,
      volumeRatio: metrics.volumeRatio,
      priceChangePercent: metrics.priceChange,
      positionScore: metrics.positionScore,
      latestClose: metrics.latestClose,
    },
    checks,
    summary: buildSummary(status, checks, matchedLatestScan, timeframe),
    sparkline: buildSparkline(candles, Math.min(candles.length, 24)),
    latestCandidate: latestHit,
    matchedLatestScan,
  };
}

export async function analyzeSymbol(input, { settings, scannerStatus } = {}) {
  const symbol = normalizeSymbolInput(input);

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
      throw new Error(`${symbol} 的 1H 歷史資料不足，暫時無法分析。`);
    }

    if ((candles4h.candles || []).length < SCAN_TIMEFRAME_CONFIG['4h'].limit) {
      throw new Error(`${symbol} 的 4H 歷史資料不足，暫時無法分析。`);
    }

    if ((detailCandles.candles || []).length < 72) {
      throw new Error(`${symbol} 的 72 根 1H 資料不足，暫時無法產生完整形態分析。`);
    }

    const normalizedOverview = normalizeOverviewResults(overview);
    const overviewMap = new Map(normalizedOverview.map((item) => [item.timeframe, item]));
    const timeframes = ['1h', '4h'].map((timeframe) =>
      buildTimeframeAnalysis(
        symbol,
        timeframe,
        timeframe === '1h' ? candles1h.candles : candles4h.candles,
        settings,
        overviewMap,
        scannerStatus,
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
    throw normalizeSymbolError(symbol, error);
  }
}

export { normalizeSymbolInput };
