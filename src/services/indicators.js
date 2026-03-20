export const SCAN_TIMEFRAME_CONFIG = {
  '1h': { interval: '1h', limit: 24, label: '1H', sparkLimit: 24 },
  '4h': { interval: '4h', limit: 30, label: '4H', sparkLimit: 30 },
};

export const DEFAULT_THRESHOLDS = {
  minRSquared: 0.7,
  maxPullbackRatio: 0.35,
  minVolumeRatio: 1.2,
  minPriceChange: 5,
  maxPriceChange: 50,
  preferredPositionMin: 0.6,
  preferredPositionMax: 0.85,
};

export function linearRegression(prices) {
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

export function calcPullbackRatio(highs, lows) {
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
  const afterHighLows = lows.slice(highIndex);
  const pullbackLow = Math.min(...afterHighLows);

  return (swingHigh - pullbackLow) / totalRange;
}

export function volumeStructure(opens, closes, volumes) {
  const upVolumes = [];
  const downVolumes = [];

  for (let index = 0; index < closes.length; index += 1) {
    if (closes[index] >= opens[index]) {
      upVolumes.push(volumes[index]);
    } else {
      downVolumes.push(volumes[index]);
    }
  }

  const avgUp = upVolumes.reduce((sum, value) => sum + value, 0) / (upVolumes.length || 1);
  const avgDown = downVolumes.reduce((sum, value) => sum + value, 0) / (downVolumes.length || 1);

  return avgDown === 0 ? 2 : avgUp / avgDown;
}

export function priceChangePercent(closes) {
  if (closes.length < 2 || closes[0] === 0) {
    return 0;
  }

  return ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
}

export function positionScore(highs, lows, currentPrice) {
  if (!highs.length || !lows.length) {
    return 0.5;
  }

  const high = Math.max(...highs);
  const low = Math.min(...lows);

  return high === low ? 0.5 : (currentPrice - low) / (high - low);
}

export function evaluateTrend(candles) {
  const opens = candles.map((candle) => candle.open);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const regression = linearRegression(closes);
  const latestClose = closes.at(-1) ?? 0;
  const baseClose = closes[0] ?? 0;

  return {
    rSquared: regression.rSquared,
    slope: regression.slope,
    slopePctPerBar: baseClose === 0 ? 0 : (regression.slope / baseClose) * 100,
    pullbackRatio: calcPullbackRatio(highs, lows),
    volumeRatio: volumeStructure(opens, closes, volumes),
    priceChange: priceChangePercent(closes),
    positionScore: positionScore(highs, lows, latestClose),
    latestClose,
    highs,
    lows,
    opens,
    closes,
    volumes,
  };
}

export function passesTrendThresholds(metrics, thresholds = DEFAULT_THRESHOLDS) {
  return (
    metrics.rSquared >= thresholds.minRSquared &&
    metrics.slope > 0 &&
    metrics.pullbackRatio <= thresholds.maxPullbackRatio &&
    metrics.volumeRatio >= thresholds.minVolumeRatio &&
    metrics.priceChange >= thresholds.minPriceChange &&
    metrics.priceChange <= thresholds.maxPriceChange
  );
}

export function buildSparkline(candles, limit = 24) {
  return candles.slice(-limit).map((candle) => candle.close);
}
