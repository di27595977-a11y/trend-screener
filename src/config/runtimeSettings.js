export const DEFAULT_RUNTIME_SETTINGS = {
  thresholds: {
    minRSquared: 0.6,
    maxPullbackRatio: 0.35,
    minVolumeRatio: 1.1,
    minPriceChange: 3,
    maxPriceChange: 50,
  },
  scoring: {
    preferredPositionMin: 0.4,
    preferredPositionMax: 0.7,
    secondaryPositionMin: 0.25,
    secondaryPositionMax: 0.85,
  },
  scan: {
    minScoreDefault: 55,
    patternDetectionLimit: 50,
  },
  backtest: {
    lookupCandleLimit: 100,
    reportDaysDefault: 30,
  },
};

function asNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(numeric, min), max);
}

export function normalizeRuntimeSettings(input = {}) {
  const thresholds = input.thresholds || {};
  const scoring = input.scoring || {};
  const scan = input.scan || {};
  const backtest = input.backtest || {};

  const next = {
    thresholds: {
      minRSquared: asNumber(thresholds.minRSquared, DEFAULT_RUNTIME_SETTINGS.thresholds.minRSquared, { min: 0, max: 1 }),
      maxPullbackRatio: asNumber(thresholds.maxPullbackRatio, DEFAULT_RUNTIME_SETTINGS.thresholds.maxPullbackRatio, { min: 0, max: 1 }),
      minVolumeRatio: asNumber(thresholds.minVolumeRatio, DEFAULT_RUNTIME_SETTINGS.thresholds.minVolumeRatio, { min: 0.1, max: 10 }),
      minPriceChange: asNumber(thresholds.minPriceChange, DEFAULT_RUNTIME_SETTINGS.thresholds.minPriceChange, { min: 0, max: 200 }),
      maxPriceChange: asNumber(thresholds.maxPriceChange, DEFAULT_RUNTIME_SETTINGS.thresholds.maxPriceChange, { min: 1, max: 500 }),
    },
    scoring: {
      preferredPositionMin: asNumber(scoring.preferredPositionMin, DEFAULT_RUNTIME_SETTINGS.scoring.preferredPositionMin, { min: 0, max: 1 }),
      preferredPositionMax: asNumber(scoring.preferredPositionMax, DEFAULT_RUNTIME_SETTINGS.scoring.preferredPositionMax, { min: 0, max: 1 }),
      secondaryPositionMin: asNumber(scoring.secondaryPositionMin, DEFAULT_RUNTIME_SETTINGS.scoring.secondaryPositionMin, { min: 0, max: 1 }),
      secondaryPositionMax: asNumber(scoring.secondaryPositionMax, DEFAULT_RUNTIME_SETTINGS.scoring.secondaryPositionMax, { min: 0, max: 1 }),
    },
    scan: {
      minScoreDefault: asNumber(scan.minScoreDefault, DEFAULT_RUNTIME_SETTINGS.scan.minScoreDefault, { min: 0, max: 100 }),
      patternDetectionLimit: Math.round(
        asNumber(scan.patternDetectionLimit, DEFAULT_RUNTIME_SETTINGS.scan.patternDetectionLimit, { min: 5, max: 200 }),
      ),
    },
    backtest: {
      lookupCandleLimit: Math.round(
        asNumber(backtest.lookupCandleLimit, DEFAULT_RUNTIME_SETTINGS.backtest.lookupCandleLimit, { min: 72, max: 300 }),
      ),
      reportDaysDefault: Math.round(
        asNumber(backtest.reportDaysDefault, DEFAULT_RUNTIME_SETTINGS.backtest.reportDaysDefault, { min: 1, max: 90 }),
      ),
    },
  };

  if (next.thresholds.maxPriceChange < next.thresholds.minPriceChange) {
    next.thresholds.maxPriceChange = next.thresholds.minPriceChange;
  }

  if (next.scoring.preferredPositionMax < next.scoring.preferredPositionMin) {
    next.scoring.preferredPositionMax = next.scoring.preferredPositionMin;
  }

  if (next.scoring.secondaryPositionMin > next.scoring.preferredPositionMin) {
    next.scoring.secondaryPositionMin = next.scoring.preferredPositionMin;
  }

  if (next.scoring.secondaryPositionMax < next.scoring.preferredPositionMax) {
    next.scoring.secondaryPositionMax = next.scoring.preferredPositionMax;
  }

  return next;
}

