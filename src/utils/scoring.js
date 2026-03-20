export function calculateTrendScore({
  rSquared,
  pullbackRatio,
  volumeRatio,
  priceChange,
  positionScore: positionMetric,
}) {
  const rScore = Math.min(Math.max(rSquared, 0), 1);
  const pullbackScore = Math.max(1 - pullbackRatio / 0.5, 0);
  const volumeScore = Math.min(Math.max(volumeRatio - 1, 0), 1);
  const changeScore = priceChange >= 3 && priceChange <= 50 ? 1 : 0.3;
  const positionScore =
    positionMetric >= 0.4 && positionMetric <= 0.7
      ? 1
      : positionMetric >= 0.25 && positionMetric <= 0.85
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
