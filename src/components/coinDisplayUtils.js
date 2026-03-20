export function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return Number(value).toFixed(digits);
}

export function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  if (value >= 1000) {
    return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  return value.toLocaleString('zh-TW', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export function parsePatternSummary(patterns) {
  const result = {
    harmonic: null,
    wBottom: null,
    mTop: null,
    triangle: null,
  };

  (patterns || []).forEach((pattern) => {
    if (pattern.startsWith('triangle:')) {
      result.triangle = { type: pattern.split(':')[1] };
    }

    if (pattern.startsWith('harmonic:')) {
      const [, type, direction] = pattern.split(':');
      result.harmonic = { type, direction };
    }

    if (pattern === 'w_bottom') {
      result.wBottom = {};
    }

    if (pattern === 'm_top') {
      result.mTop = {};
    }
  });

  return result;
}

export function buildFallbackLevels(values, currentPrice) {
  const sorted = (values || []).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);

  return {
    supportLevels: sorted.filter((value) => value < currentPrice).slice(-1).map((price) => ({ price, touches: 1 })),
    resistanceLevels: sorted.filter((value) => value > currentPrice).slice(0, 1).map((price) => ({ price, touches: 1 })),
  };
}
