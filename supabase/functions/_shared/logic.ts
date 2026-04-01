import { DEFAULT_RUNTIME_SETTINGS } from './settings.ts';

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type SwingPoint = {
  index: number;
  price: number;
  time: number;
};

type TrendMetrics = {
  rSquared: number;
  slope: number;
  slopePctPerBar: number;
  pullbackRatio: number;
  bounceRatio: number;
  volumeRatio: number;
  bearishVolumeRatio: number;
  priceChange: number;
  positionScore: number;
  latestClose: number;
};

export const SCAN_TIMEFRAME_CONFIG: Record<string, { interval: string; limit: number; sparkLimit: number }> = {
  '1h': { interval: '1h', limit: 24, sparkLimit: 24 },
  '4h': { interval: '4h', limit: 72, sparkLimit: 72 },
};

export function normalizeTradeBias(bias = 'long') {
  return bias === 'short' ? 'short' : 'long';
}

function linearRegression(prices: number[]) {
  const n = prices.length;
  if (!n) {
    return { slope: 0, intercept: 0, rSquared: 0 };
  }

  const xSum = (n * (n - 1)) / 2;
  const xSqSum = (n * (n - 1) * (2 * n - 1)) / 6;
  const ySum = prices.reduce((sum, value) => sum + value, 0);
  const xySum = prices.reduce((sum, value, index) => sum + index * value, 0);
  const denominator = n * xSqSum - xSum * xSum;
  const slope = denominator === 0 ? 0 : (n * xySum - xSum * ySum) / denominator;
  const intercept = (ySum - slope * xSum) / n;
  const yMean = ySum / n;
  const ssRes = prices.reduce((sum, value, index) => sum + (value - intercept - slope * index) ** 2, 0);
  const ssTot = prices.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
}

function calcPullbackRatio(highs: number[], lows: number[]) {
  if (!highs.length || !lows.length) {
    return 1;
  }

  const swingHigh = Math.max(...highs);
  const swingLow = Math.min(...lows);
  const totalRange = swingHigh - swingLow;
  if (totalRange === 0) {
    return 1;
  }

  const highIndex = highs.indexOf(swingHigh);
  const pullbackLow = Math.min(...lows.slice(highIndex));
  return (swingHigh - pullbackLow) / totalRange;
}

function calcBounceRatio(highs: number[], lows: number[]) {
  if (!highs.length || !lows.length) {
    return 1;
  }

  const swingHigh = Math.max(...highs);
  const swingLow = Math.min(...lows);
  const totalRange = swingHigh - swingLow;
  if (totalRange === 0) {
    return 1;
  }

  const lowIndex = lows.indexOf(swingLow);
  const reboundHigh = Math.max(...highs.slice(lowIndex));
  return (reboundHigh - swingLow) / totalRange;
}

function volumeStructure(opens: number[], closes: number[], volumes: number[]) {
  const upVolumes: number[] = [];
  const downVolumes: number[] = [];

  closes.forEach((close, index) => {
    if (close >= opens[index]) {
      upVolumes.push(volumes[index]);
    } else {
      downVolumes.push(volumes[index]);
    }
  });

  const avgUp = upVolumes.reduce((sum, value) => sum + value, 0) / (upVolumes.length || 1);
  const avgDown = downVolumes.reduce((sum, value) => sum + value, 0) / (downVolumes.length || 1);

  return {
    bullishRatio: avgDown === 0 ? 2 : avgUp / avgDown,
    bearishRatio: avgUp === 0 ? 2 : avgDown / avgUp,
  };
}

function priceChangePercent(closes: number[]) {
  if (closes.length < 2 || closes[0] === 0) {
    return 0;
  }

  return ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
}

function positionScore(highs: number[], lows: number[], currentPrice: number) {
  if (!highs.length || !lows.length) {
    return 0.5;
  }

  const high = Math.max(...highs);
  const low = Math.min(...lows);
  return high === low ? 0.5 : (currentPrice - low) / (high - low);
}

export function evaluateTrend(candles: Candle[]): TrendMetrics {
  const opens = candles.map((candle) => candle.open);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const regression = linearRegression(closes);
  const volumeMetrics = volumeStructure(opens, closes, volumes);
  const latestClose = closes.at(-1) ?? 0;
  const baseClose = closes[0] ?? 0;

  return {
    rSquared: regression.rSquared,
    slope: regression.slope,
    slopePctPerBar: baseClose === 0 ? 0 : (regression.slope / baseClose) * 100,
    pullbackRatio: calcPullbackRatio(highs, lows),
    bounceRatio: calcBounceRatio(highs, lows),
    volumeRatio: volumeMetrics.bullishRatio,
    bearishVolumeRatio: volumeMetrics.bearishRatio,
    priceChange: priceChangePercent(closes),
    positionScore: positionScore(highs, lows, latestClose),
    latestClose,
  };
}

export function getDirectionalMetrics(metrics: TrendMetrics, bias = 'long') {
  const tradeBias = normalizeTradeBias(bias);

  return {
    rSquared: metrics.rSquared,
    slope: tradeBias === 'short' ? -metrics.slope : metrics.slope,
    slopePctPerBar: tradeBias === 'short' ? -metrics.slopePctPerBar : metrics.slopePctPerBar,
    pullbackRatio: tradeBias === 'short' ? metrics.bounceRatio : metrics.pullbackRatio,
    volumeRatio: tradeBias === 'short' ? metrics.bearishVolumeRatio : metrics.volumeRatio,
    priceChange: tradeBias === 'short' ? -metrics.priceChange : metrics.priceChange,
    positionScore: tradeBias === 'short' ? 1 - metrics.positionScore : metrics.positionScore,
    latestClose: metrics.latestClose,
  };
}

export function passesTrendThresholds(metrics: TrendMetrics, thresholds = DEFAULT_RUNTIME_SETTINGS.thresholds, bias = 'long') {
  const directional = getDirectionalMetrics(metrics, bias);

  return (
    directional.rSquared >= thresholds.minRSquared &&
    directional.slope > 0 &&
    directional.pullbackRatio <= thresholds.maxPullbackRatio &&
    directional.volumeRatio >= thresholds.minVolumeRatio &&
    directional.priceChange >= thresholds.minPriceChange &&
    directional.priceChange <= thresholds.maxPriceChange
  );
}

export function buildSparkline(candles: Candle[], limit = 24) {
  return candles.slice(-limit).map((candle) => candle.close);
}

export function calculateTrendScore(metrics: TrendMetrics, settings = DEFAULT_RUNTIME_SETTINGS, bias = 'long') {
  const thresholds = settings.thresholds || DEFAULT_RUNTIME_SETTINGS.thresholds;
  const scoring = settings.scoring || DEFAULT_RUNTIME_SETTINGS.scoring;
  const directional = getDirectionalMetrics(metrics, bias);
  const rScore = Math.min(Math.max(directional.rSquared, 0), 1);
  const pullbackScore = Math.max(1 - directional.pullbackRatio / 0.5, 0);
  const volumeScore = Math.min(Math.max(directional.volumeRatio - 1, 0), 1);
  const changeScore =
    directional.priceChange >= thresholds.minPriceChange && directional.priceChange <= thresholds.maxPriceChange ? 1 : 0.3;
  const positionValue =
    directional.positionScore >= scoring.preferredPositionMin && directional.positionScore <= scoring.preferredPositionMax
      ? 1
      : directional.positionScore >= scoring.secondaryPositionMin && directional.positionScore <= scoring.secondaryPositionMax
        ? 0.6
        : 0.3;

  return Math.round(rScore * 30 + pullbackScore * 25 + volumeScore * 20 + changeScore * 15 + positionValue * 10);
}

export function scoreBucket(score: number) {
  if (score >= 80) return '80+';
  if (score >= 70) return '70-79';
  if (score >= 60) return '60-69';
  return '<60';
}

const HARMONIC_RATIO_TOLERANCE = 0.08;
const DEFAULT_HARMONIC_MIN_CONFIDENCE = 0.7;
const DEFAULT_HARMONIC_MAX_PATTERNS = 3;
const HARMONIC_SPECS = [
  { key: 'gartley', xab: [0.618, 0.618], abc: [0.382, 0.886], bcd: [1.13, 1.618], xad: [0.786, 0.786] },
  { key: 'bat', xab: [0.382, 0.5], abc: [0.382, 0.886], bcd: [1.618, 2.618], xad: [0.886, 0.886] },
  { key: 'butterfly', xab: [0.786, 0.786], abc: [0.382, 0.886], bcd: [1.618, 2.618], xad: [1.27, 1.618] },
  { key: 'crab', xab: [0.382, 0.618], abc: [0.382, 0.886], bcd: [2.24, 3.618], xad: [1.618, 1.618] },
];

function clusterPoints(points: SwingPoint[], tolerance: number) {
  const clusters: SwingPoint[][] = [];
  const used = new Set<number>();

  for (let index = 0; index < points.length; index += 1) {
    if (used.has(index)) continue;

    const cluster = [points[index]];
    used.add(index);

    for (let compareIndex = index + 1; compareIndex < points.length; compareIndex += 1) {
      if (used.has(compareIndex)) continue;
      const clusterAvg = cluster.reduce((sum, point) => sum + point.price, 0) / cluster.length;
      const distance = Math.abs(points[compareIndex].price - clusterAvg) / clusterAvg;
      if (distance <= tolerance) {
        cluster.push(points[compareIndex]);
        used.add(compareIndex);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function mergeSwingSequence(swingHighs: SwingPoint[], swingLows: SwingPoint[]) {
  const merged = [
    ...swingHighs.map((point) => ({ ...point, type: 'high' as const })),
    ...swingLows.map((point) => ({ ...point, type: 'low' as const })),
  ].sort((left, right) => left.index - right.index);

  const compressed: Array<SwingPoint & { type: 'high' | 'low' }> = [];

  merged.forEach((point) => {
    const last = compressed.at(-1);

    if (!last) {
      compressed.push(point);
      return;
    }

    if (point.index === last.index) {
      if (point.type === last.type) {
        const shouldReplace = point.type === 'high' ? point.price > last.price : point.price < last.price;
        if (shouldReplace) {
          compressed[compressed.length - 1] = point;
        }
      }
      return;
    }

    if (point.type === last.type) {
      const shouldReplace = point.type === 'high' ? point.price >= last.price : point.price <= last.price;
      if (shouldReplace) {
        compressed[compressed.length - 1] = point;
      }
      return;
    }

    compressed.push(point);
  });

  return compressed;
}

function isWithinRange(value: number, [min, max]: [number, number], tolerance = HARMONIC_RATIO_TOLERANCE) {
  return value >= min - tolerance && value <= max + tolerance;
}

function scoreRangeFit(value: number, [min, max]: [number, number], tolerance = HARMONIC_RATIO_TOLERANCE) {
  if (!isWithinRange(value, [min, max], tolerance)) {
    return 0;
  }

  const center = (min + max) / 2;
  const halfSpan = (max - min) / 2 + tolerance || tolerance || 1;
  return Math.max(0, 1 - Math.abs(value - center) / halfSpan);
}

export function findSwingPoints(candles: Candle[], lookback = 3) {
  const swingHighs: SwingPoint[] = [];
  const swingLows: SwingPoint[] = [];

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= lookback; offset += 1) {
      if (candles[index].high <= candles[index - offset].high || candles[index].high <= candles[index + offset].high) {
        isHigh = false;
      }
      if (candles[index].low >= candles[index - offset].low || candles[index].low >= candles[index + offset].low) {
        isLow = false;
      }
    }

    if (isHigh) swingHighs.push({ index, price: candles[index].high, time: candles[index].time });
    if (isLow) swingLows.push({ index, price: candles[index].low, time: candles[index].time });
  }

  return { swingHighs, swingLows };
}

function detectSupportResistance(swingHighs: SwingPoint[], swingLows: SwingPoint[], tolerance = 0.008) {
  const levels: Array<{ price: number; priceHigh: number; priceLow: number; type: 'resistance' | 'support'; touches: number; strength: string; flipped: boolean }> = [];

  clusterPoints(swingHighs, tolerance).forEach((cluster) => {
    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      levels.push({
        price: avgPrice,
        priceHigh: avgPrice * 1.003,
        priceLow: avgPrice * 0.997,
        type: 'resistance',
        touches: cluster.length,
        strength: cluster.length >= 3 ? 'strong' : 'normal',
        flipped: false,
      });
    }
  });

  clusterPoints(swingLows, tolerance).forEach((cluster) => {
    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      levels.push({
        price: avgPrice,
        priceHigh: avgPrice * 1.003,
        priceLow: avgPrice * 0.997,
        type: 'support',
        touches: cluster.length,
        strength: cluster.length >= 3 ? 'strong' : 'normal',
        flipped: false,
      });
    }
  });

  return levels.sort((left, right) => right.touches - left.touches).slice(0, 6);
}

function fitLine(points: SwingPoint[]) {
  const n = points.length;
  if (!n) return { slope: 0, intercept: 0 };

  const xs = points.map((point) => point.index);
  const ys = points.map((point) => point.price);
  const xSum = xs.reduce((sum, value) => sum + value, 0);
  const ySum = ys.reduce((sum, value) => sum + value, 0);
  const xySum = xs.reduce((sum, value, index) => sum + value * ys[index], 0);
  const xSquaredSum = xs.reduce((sum, value) => sum + value * value, 0);
  const denominator = n * xSquaredSum - xSum * xSum;
  const slope = denominator === 0 ? 0 : (n * xySum - xSum * ySum) / denominator;
  const intercept = (ySum - slope * xSum) / n;
  return { slope, intercept };
}

function fitPivotLine(points: SwingPoint[]) {
  if (points.length < 2) return null;
  const p1 = points.at(-2)!;
  const p2 = points.at(-1)!;
  if (p2.index === p1.index) return null;
  const slope = (p2.price - p1.price) / (p2.index - p1.index);
  const intercept = p1.price - slope * p1.index;
  return { slope, intercept };
}

function detectTriangle(swingHighs: SwingPoint[], swingLows: SwingPoint[], totalBars: number) {
  if (swingHighs.length < 2 || swingLows.length < 2) return null;

  const recentHighs = swingHighs.slice(-4);
  const recentLows = swingLows.slice(-4);
  const highLine = fitPivotLine(recentHighs);
  const lowLine = fitPivotLine(recentLows);

  if (!highLine || !lowLine) return null;
  if (highLine.slope > lowLine.slope || highLine.slope === lowLine.slope) return null;

  const apexIndex = (lowLine.intercept - highLine.intercept) / (highLine.slope - lowLine.slope);
  const lastIndex = Math.max(recentHighs.at(-1)?.index ?? 0, recentLows.at(-1)?.index ?? 0);
  if (apexIndex <= lastIndex || apexIndex > lastIndex + totalBars * 0.5) return null;

  let type = 'symmetric';
  if (Math.abs(highLine.slope) < 0.0001) type = 'ascending';
  else if (Math.abs(lowLine.slope) < 0.0001) type = 'descending';

  return { type };
}

function buildHarmonicCandidate(points: Array<SwingPoint & { type: 'high' | 'low' }>, candles: Candle[]) {
  if (points.length !== 5) {
    return null;
  }

  const [x, a, b, c, d] = points;
  const direction = x.type === 'low' ? 'bullish' : x.type === 'high' ? 'bearish' : null;

  if (!direction) {
    return null;
  }

  const expectedTypes = direction === 'bullish' ? ['low', 'high', 'low', 'high', 'low'] : ['high', 'low', 'high', 'low', 'high'];

  if (!points.every((point, index) => point.type === expectedTypes[index])) {
    return null;
  }

  const legSpans = [a.index - x.index, b.index - a.index, c.index - b.index, d.index - c.index];
  const totalSpan = d.index - x.index;

  if (legSpans.some((span) => span < 2 || span > 36) || totalSpan < 12 || totalSpan > 72) {
    return null;
  }

  if (direction === 'bullish') {
    if (!(a.price > x.price && b.price > x.price && b.price < a.price && c.price > b.price && c.price < a.price && d.price < c.price)) {
      return null;
    }
  } else if (!(a.price < x.price && b.price < x.price && b.price > a.price && c.price < b.price && c.price > a.price && d.price > c.price)) {
    return null;
  }

  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  const cd = Math.abs(d.price - c.price);
  const xad = Math.abs(a.price - d.price);

  if ([xa, ab, bc, cd, xad].some((value) => value === 0)) {
    return null;
  }

  const ratios = {
    xab: ab / xa,
    abc: bc / ab,
    bcd: cd / bc,
    xad: xad / xa,
  };

  const lastClose = candles.at(-1)?.close ?? d.price;
  const reactionConfirmed = direction === 'bullish' ? lastClose > d.price : lastClose < d.price;
  const candidates: Array<{ key: string; direction: 'bullish' | 'bearish'; confidence: number }> = [];

  HARMONIC_SPECS.forEach((spec) => {
    if (
      !isWithinRange(ratios.xab, spec.xab) ||
      !isWithinRange(ratios.abc, spec.abc) ||
      !isWithinRange(ratios.bcd, spec.bcd) ||
      !isWithinRange(ratios.xad, spec.xad)
    ) {
      return;
    }

    const fitScore =
      (scoreRangeFit(ratios.xab, spec.xab) +
        scoreRangeFit(ratios.abc, spec.abc) +
        scoreRangeFit(ratios.bcd, spec.bcd) +
        scoreRangeFit(ratios.xad, spec.xad)) /
      4;

    candidates.push({
      key: spec.key,
      direction,
      confidence: fitScore + (reactionConfirmed ? 0.08 : 0),
      dIndex: d.index,
    });
  });

  return candidates.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

function detectHarmonicPatterns(
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  candles: Candle[],
  minConfidence = DEFAULT_HARMONIC_MIN_CONFIDENCE,
  maxPatterns = DEFAULT_HARMONIC_MAX_PATTERNS,
) {
  const mergedSwings = mergeSwingSequence(swingHighs, swingLows);
  const candidates: Array<{ key: string; direction: 'bullish' | 'bearish'; confidence: number; dIndex: number }> = [];

  for (let index = 0; index <= mergedSwings.length - 5; index += 1) {
    const match = buildHarmonicCandidate(mergedSwings.slice(index, index + 5), candles);

    if (match) {
      candidates.push(match);
    }
  }

  const deduped: Array<{ key: string; direction: 'bullish' | 'bearish'; confidence: number; dIndex: number }> = [];
  const seen = new Set<string>();

  candidates
    .filter((candidate) => candidate.confidence >= minConfidence)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return right.dIndex - left.dIndex;
    })
    .forEach((candidate) => {
      const dedupeKey = `${candidate.key}:${candidate.direction}:${candidate.dIndex}`;

      if (seen.has(dedupeKey) || deduped.length >= maxPatterns) {
        return;
      }

      seen.add(dedupeKey);
      deduped.push(candidate);
    });

  return deduped;
}

function detectHarmonicPattern(
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  candles: Candle[],
  minConfidence = DEFAULT_HARMONIC_MIN_CONFIDENCE,
) {
  return detectHarmonicPatterns(swingHighs, swingLows, candles, minConfidence, 1)[0] ?? null;
}

function detectWBottom(swingHighs: SwingPoint[], swingLows: SwingPoint[], candles: Candle[], tolerance = 0.02) {
  const patterns: Array<{ confidence: number }> = [];

  for (let leftIndex = 0; leftIndex < swingLows.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < swingLows.length; rightIndex += 1) {
      const left = swingLows[leftIndex];
      const right = swingLows[rightIndex];
      if (Math.abs(left.price - right.price) / left.price > tolerance) continue;
      const spacing = right.index - left.index;
      if (spacing < 5 || spacing > 48) continue;

      const middleHighs = swingHighs.filter((point) => point.index > left.index && point.index < right.index);
      if (!middleHighs.length) continue;
      const neckline = middleHighs.reduce((current, point) => (point.price > current.price ? point : current));
      if ((neckline.price - Math.max(left.price, right.price)) / neckline.price < 0.01) continue;
      const lastClose = candles.at(-1)?.close ?? 0;
      void lastClose;

      patterns.push({
        confidence: 1 - Math.abs(left.price - right.price) / left.price,
      });
    }
  }

  return patterns.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

function detectMTop(swingHighs: SwingPoint[], swingLows: SwingPoint[], candles: Candle[], tolerance = 0.02) {
  const patterns: Array<{ confidence: number }> = [];

  for (let leftIndex = 0; leftIndex < swingHighs.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < swingHighs.length; rightIndex += 1) {
      const left = swingHighs[leftIndex];
      const right = swingHighs[rightIndex];
      if (Math.abs(left.price - right.price) / left.price > tolerance) continue;
      const spacing = right.index - left.index;
      if (spacing < 5 || spacing > 48) continue;

      const middleLows = swingLows.filter((point) => point.index > left.index && point.index < right.index);
      if (!middleLows.length) continue;
      const neckline = middleLows.reduce((current, point) => (point.price < current.price ? point : current));
      if ((Math.min(left.price, right.price) - neckline.price) / neckline.price < 0.01) continue;
      const lastClose = candles.at(-1)?.close ?? 0;
      void lastClose;

      patterns.push({
        confidence: 1 - Math.abs(left.price - right.price) / left.price,
      });
    }
  }

  return patterns.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

function applySRFlip(levels: ReturnType<typeof detectSupportResistance>, currentClose: number, flipTolerance = 0.005) {
  return levels.map((level) => {
    if (level.type === 'resistance' && currentClose > level.priceHigh * (1 + flipTolerance)) {
      return { ...level, type: 'support' as const, flipped: true };
    }
    if (level.type === 'support' && currentClose < level.priceLow * (1 - flipTolerance)) {
      return { ...level, type: 'resistance' as const, flipped: true };
    }
    return { ...level, flipped: false };
  });
}

export function detectAllPatterns(candles: Candle[]) {
  const { swingHighs, swingLows } = findSwingPoints(candles, 3);
  const harmonics = detectHarmonicPatterns(swingHighs, swingLows, candles);
  const rawLevels = detectSupportResistance(swingHighs, swingLows);
  const currentClose = candles.at(-1)?.close ?? 0;
  return {
    supportResistance: applySRFlip(rawLevels, currentClose),
    triangle: detectTriangle(swingHighs, swingLows, candles.length),
    harmonics,
    harmonic: harmonics[0] ?? null,
    wBottom: detectWBottom(swingHighs, swingLows, candles),
    mTop: detectMTop(swingHighs, swingLows, candles),
  };
}

export function summarizePatterns(patterns: ReturnType<typeof detectAllPatterns>) {
  const values: string[] = [];
  if (patterns.triangle) values.push(`triangle:${patterns.triangle.type}`);
  const harmonicPatterns = patterns.harmonics?.length ? patterns.harmonics : patterns.harmonic ? [patterns.harmonic] : [];
  harmonicPatterns.slice(0, 2).forEach((pattern) => values.push(`harmonic:${pattern.key}:${pattern.direction}`));
  if (patterns.wBottom) values.push('w_bottom');
  if (patterns.mTop) values.push('m_top');
  patterns.supportResistance.slice(0, 2).forEach((level) => values.push(`${level.type}:${level.touches}`));
  return values;
}
