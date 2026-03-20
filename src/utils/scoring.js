import { DEFAULT_RUNTIME_SETTINGS } from '../config/runtimeSettings.js';
import { getDirectionalMetrics } from '../services/indicators.js';

export function calculateTrendScore({
  rSquared,
  pullbackRatio,
  bounceRatio,
  volumeRatio,
  bearishVolumeRatio,
  priceChange,
  positionScore: positionMetric,
}, settings = DEFAULT_RUNTIME_SETTINGS, bias = 'long') {
  const thresholds = settings.thresholds || DEFAULT_RUNTIME_SETTINGS.thresholds;
  const scoring = settings.scoring || DEFAULT_RUNTIME_SETTINGS.scoring;
  const directional = getDirectionalMetrics(
    {
      rSquared,
      slope: 0,
      slopePctPerBar: 0,
      pullbackRatio,
      bounceRatio,
      volumeRatio,
      bearishVolumeRatio,
      priceChange,
      positionScore: positionMetric,
      latestClose: 0,
    },
    bias,
  );
  const rScore = Math.min(Math.max(directional.rSquared, 0), 1);
  const pullbackScore = Math.max(1 - directional.pullbackRatio / 0.5, 0);
  const volumeScore = Math.min(Math.max(directional.volumeRatio - 1, 0), 1);
  const changeScore =
    directional.priceChange >= thresholds.minPriceChange && directional.priceChange <= thresholds.maxPriceChange ? 1 : 0.3;
  const positionScore =
    directional.positionScore >= scoring.preferredPositionMin && directional.positionScore <= scoring.preferredPositionMax
      ? 1
      : directional.positionScore >= scoring.secondaryPositionMin && directional.positionScore <= scoring.secondaryPositionMax
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
