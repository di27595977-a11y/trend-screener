import { DEFAULT_RUNTIME_SETTINGS } from '../config/runtimeSettings.js';

export function calculateTrendScore({
  rSquared,
  pullbackRatio,
  volumeRatio,
  priceChange,
  positionScore: positionMetric,
}, settings = DEFAULT_RUNTIME_SETTINGS) {
  const thresholds = settings.thresholds || DEFAULT_RUNTIME_SETTINGS.thresholds;
  const scoring = settings.scoring || DEFAULT_RUNTIME_SETTINGS.scoring;
  const rScore = Math.min(Math.max(rSquared, 0), 1);
  const pullbackScore = Math.max(1 - pullbackRatio / 0.5, 0);
  const volumeScore = Math.min(Math.max(volumeRatio - 1, 0), 1);
  const changeScore = priceChange >= thresholds.minPriceChange && priceChange <= thresholds.maxPriceChange ? 1 : 0.3;
  const positionScore =
    positionMetric >= scoring.preferredPositionMin && positionMetric <= scoring.preferredPositionMax
      ? 1
      : positionMetric >= scoring.secondaryPositionMin && positionMetric <= scoring.secondaryPositionMax
        ? 0.6
        : 0.3;

  return Math.round(rScore * 30 + pullbackScore * 25 + volumeScore * 20 + changeScore * 15 + positionScore * 10);
}

export function getScoreTone(score) {
  if (score >= 85) {
    return 'emerald';
  }

  if (score >= 70) {
    return 'amber';
  }

  return 'rose';
}

export function scoreBucket(score) {
  if (score >= 80) {
    return '80+';
  }

  if (score >= 70) {
    return '70-79';
  }

  if (score >= 60) {
    return '60-69';
  }

  return '<60';
}
