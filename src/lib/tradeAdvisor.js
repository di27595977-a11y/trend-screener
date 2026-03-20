function toFiniteNumber(value) {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundTo(value, digits = 4) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return null;
  }

  return Number(numeric.toFixed(digits));
}

function uniquePush(list, value, limit = Infinity) {
  if (!value || list.includes(value) || list.length >= limit) {
    return;
  }

  list.push(value);
}

function nearestBelow(levels, price) {
  return [...levels]
    .filter((level) => toFiniteNumber(level?.price) != null && level.price < price)
    .sort((left, right) => right.price - left.price)[0] || null;
}

function nearestAbove(levels, price) {
  return [...levels]
    .filter((level) => toFiniteNumber(level?.price) != null && level.price > price)
    .sort((left, right) => left.price - right.price)[0] || null;
}

function normalizeLevels(levels) {
  return (levels || [])
    .map((level) => ({
      price: toFiniteNumber(level?.price),
      touches: Number(level?.touches || 0),
    }))
    .filter((level) => level.price != null)
    .sort((left, right) => left.price - right.price);
}

function harmonicTypeLabel(type) {
  return (
    {
      gartley: 'Gartley',
      bat: 'Bat',
      butterfly: 'Butterfly',
      crab: 'Crab',
    }[type] || type || '\u8ae7\u6ce2'
  );
}

function buildFallbackLevels(currentPrice) {
  return {
    support: currentPrice * 0.97,
    resistance: currentPrice * 1.03,
  };
}

function calculateRiskReward(direction, entry, sl, tp1) {
  if ([entry, sl, tp1].some((value) => toFiniteNumber(value) == null)) {
    return null;
  }

  const longReward = tp1 - entry;
  const longRisk = entry - sl;
  const shortReward = entry - tp1;
  const shortRisk = sl - entry;
  const raw =
    direction === 'long'
      ? longRisk > 0
        ? longReward / longRisk
        : null
      : direction === 'short'
        ? shortRisk > 0
          ? shortReward / shortRisk
          : null
        : null;

  return raw == null || !Number.isFinite(raw) ? null : Number(raw.toFixed(1));
}

function buildEmptyAdvice(reason) {
  return {
    direction: 'watch',
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    riskReward: null,
    confidence: 'low',
    reasons: reason ? [reason] : [],
    warnings: [],
  };
}

export function generateTradeAdvice(input = {}) {
  const currentPrice = toFiniteNumber(input.currentPrice);

  if (currentPrice == null) {
    return buildEmptyAdvice('\u7f3a\u5c11\u73fe\u50f9\u8cc7\u6599\uff0c\u7121\u6cd5\u8a08\u7b97\u4ea4\u6613\u5efa\u8b70\u3002');
  }

  const positionScore = toFiniteNumber(input.positionScore) ?? 0;
  const score = toFiniteNumber(input.score) ?? 0;
  const pullbackRatio = toFiniteNumber(input.pullbackRatio);
  const rSquared = toFiniteNumber(input.rSquared);
  const volumeRatio = toFiniteNumber(input.volumeRatio);
  const priceChange = toFiniteNumber(input.priceChange ?? input.priceChangePct);
  const patterns = input.patterns || {};
  const supportLevels = normalizeLevels(input.supportLevels);
  const resistanceLevels = normalizeLevels(input.resistanceLevels);
  const nearestSupport = nearestBelow(supportLevels, currentPrice);
  const nearestResistance = nearestAbove(resistanceLevels, currentPrice);
  const fallbackLevels = buildFallbackLevels(currentPrice);
  const reasons = [];
  const warnings = [];
  let direction = 'watch';
  let entry = currentPrice;
  let sl = null;
  let tp1 = null;
  let tp2 = null;
  let signalCount = 0;
  let lockedWatch = false;

  const harmonic = patterns.harmonic
    ? {
        type: patterns.harmonic.type || patterns.harmonic.key || patterns.harmonic.label,
        direction: patterns.harmonic.direction,
        stopLoss: toFiniteNumber(patterns.harmonic.stopLoss),
        t1: toFiniteNumber(patterns.harmonic.t1 ?? patterns.harmonic.target1),
        t2: toFiniteNumber(patterns.harmonic.t2 ?? patterns.harmonic.target2),
        confidence: toFiniteNumber(patterns.harmonic.confidence),
        reactionConfirmed: Boolean(patterns.harmonic.reactionConfirmed),
      }
    : null;

  if (harmonic && harmonic.confidence != null && harmonic.confidence >= 0.7) {
    if (harmonic.reactionConfirmed) {
      direction = harmonic.direction === 'bearish' ? 'short' : 'long';
      sl = harmonic.stopLoss;
      tp1 = harmonic.t1;
      tp2 = harmonic.t2;
      signalCount = 2;
      uniquePush(
        reasons,
        `\u5075\u6e2c\u5230 ${harmonicTypeLabel(harmonic.type)} ${direction === 'long' ? '\u725b' : '\u718a'}\u8ae7\u6ce2\uff08\u53ef\u4fe1\u5ea6 ${Math.round(
          harmonic.confidence * 100,
        )}%\uff09\uff0cD \u9ede\u53cd\u61c9\u5df2\u78ba\u8a8d`,
        4,
      );
    } else {
      lockedWatch = true;
      uniquePush(reasons, '\u8ae7\u6ce2\u5f62\u614b\u5f62\u6210\u4e2d\uff0c\u7b49\u5f85 D \u9ede\u78ba\u8a8d\u53cd\u61c9\u5f8c\u518d\u9032\u5834', 4);
      uniquePush(warnings, '\u26a0\ufe0f \u8ae7\u6ce2 D \u9ede\u5c1a\u672a\u78ba\u8a8d\u53cd\u61c9\uff0c\u4e0d\u5efa\u8b70\u6436\u5148\u9032\u5834');
    }
  }

  if (direction === 'watch' && !reasons.length && patterns.wBottom?.neckline != null && currentPrice > patterns.wBottom.neckline) {
    direction = 'long';
    signalCount = 1;
    sl = (nearestSupport?.price ?? fallbackLevels.support) * 0.97;
    tp1 = nearestResistance?.price ?? fallbackLevels.resistance;
    tp2 = tp1 + (tp1 - sl);
    uniquePush(reasons, `W\u5e95\u7a81\u7834\u9818\u7dda ${roundTo(patterns.wBottom.neckline)}\uff0c\u8da8\u52e2\u53cd\u8f49\u8a0a\u865f`, 4);
  }

  if (direction === 'watch' && !reasons.length && patterns.mTop?.neckline != null && currentPrice < patterns.mTop.neckline) {
    direction = 'short';
    signalCount = 1;
    sl = (nearestResistance?.price ?? fallbackLevels.resistance) * 1.03;
    tp1 = nearestSupport?.price ?? fallbackLevels.support;
    tp2 = tp1 - (sl - tp1);
    uniquePush(reasons, `M\u9802\u8dcc\u7834\u9818\u7dda ${roundTo(patterns.mTop.neckline)}\uff0c\u8da8\u52e2\u53cd\u8f49\u8a0a\u865f`, 4);
  }

  const distanceToSupport = nearestSupport ? (currentPrice - nearestSupport.price) / currentPrice : null;
  const distanceToResistance = nearestResistance ? (nearestResistance.price - currentPrice) / currentPrice : null;

  if (direction === 'watch' && nearestSupport && distanceToSupport != null && distanceToSupport < 0.03) {
    direction = 'long';
    signalCount = 1;
    sl = nearestSupport.price * 0.97;
    tp1 = nearestResistance?.price ?? fallbackLevels.resistance;
    tp2 = tp1 + ((nearestResistance?.price ?? fallbackLevels.resistance) - nearestSupport.price) * 0.618;
    uniquePush(
      reasons,
      `\u50f9\u683c\u63a5\u8fd1\u652f\u6490\u4f4d ${roundTo(nearestSupport.price)}\uff08\u8ddd\u96e2 ${(distanceToSupport * 100).toFixed(2)}%\uff09`,
      4,
    );
  }

  if (direction === 'watch' && nearestResistance && distanceToResistance != null && distanceToResistance < 0.03) {
    direction = 'short';
    signalCount = 1;
    sl = nearestResistance.price * 1.03;
    tp1 = nearestSupport?.price ?? fallbackLevels.support;
    tp2 = tp1 - (nearestResistance.price - (nearestSupport?.price ?? fallbackLevels.support)) * 0.618;
    uniquePush(
      reasons,
      `\u50f9\u683c\u63a5\u8fd1\u58d3\u529b\u4f4d ${roundTo(nearestResistance.price)}\uff08\u8ddd\u96e2 ${(distanceToResistance * 100).toFixed(2)}%\uff09`,
      4,
    );
  }

  if (direction === 'watch' && !lockedWatch) {
    if (positionScore < 0.5 && score >= 60) {
      direction = 'long';
      signalCount = 1;
      const supportBase = nearestSupport?.price ?? fallbackLevels.support;
      const resistanceBase = nearestResistance?.price ?? fallbackLevels.resistance;
      sl = supportBase * 0.97;
      tp1 = resistanceBase;
      tp2 = resistanceBase + (resistanceBase - supportBase);
      uniquePush(
        reasons,
        `\u8da8\u52e2\u5411\u4e0a\uff08\u5206\u6578 ${Math.round(score)}\uff09\uff0c\u76ee\u524d\u4f4d\u65bc\u5340\u9593\u4e2d\u6bb5\uff0c\u5c1a\u6709\u4e0a\u5347\u7a7a\u9593`,
        4,
      );
    } else {
      uniquePush(reasons, '\u76ee\u524d\u7121\u660e\u78ba\u9032\u5834\u8a0a\u865f\uff0c\u5efa\u8b70\u7b49\u5f85\u56de\u8e29\u6216\u5f62\u614b\u78ba\u8a8d', 4);
    }
  }

  if (rSquared != null && rSquared >= 0.8) {
    uniquePush(reasons, `\u8da8\u52e2\u7dda\u6027\u5ea6\u9ad8\uff08R\u00b2 ${rSquared.toFixed(2)}\uff09\uff0c\u8d70\u52e2\u7a69\u5b9a`, 4);
    if (direction !== 'watch') {
      signalCount += 1;
    }
  }

  if (volumeRatio != null && volumeRatio >= 1.5) {
    uniquePush(reasons, `\u6210\u4ea4\u91cf\u660e\u986f\u653e\u5927\uff08\u91cf\u6bd4 ${volumeRatio.toFixed(2)}x\uff09\uff0c\u52d5\u80fd\u5145\u8db3`, 4);
    if (direction !== 'watch') {
      signalCount += 1;
    }
  }

  if (pullbackRatio != null && pullbackRatio <= 0.2) {
    uniquePush(reasons, `\u56de\u8abf\u5e45\u5ea6\u5c0f\uff08${(pullbackRatio * 100).toFixed(1)}%\uff09\uff0c\u591a\u982d\u5f37\u52e2`, 4);
    if (direction === 'long') {
      signalCount += 1;
    }
  }

  if (patterns.triangle?.type === 'symmetric') {
    uniquePush(reasons, '\u5c0d\u7a31\u4e09\u89d2\u6536\u6582\u4e2d\uff0c\u7b49\u5f85\u7a81\u7834\u65b9\u5411\u78ba\u8a8d', 4);
  }

  let riskReward = calculateRiskReward(direction, entry, sl, tp1);

  if (positionScore > 0.85) {
    uniquePush(warnings, `\u26a0\ufe0f \u76ee\u524d\u4f4d\u65bc\u5340\u9593\u9ad8\u9ede\uff08${Math.round(positionScore * 100)}%\uff09\uff0c\u8ffd\u9ad8\u98a8\u96aa\u8f03\u5927`);
  }

  if (priceChange != null && priceChange > 15) {
    uniquePush(warnings, `\u26a0\ufe0f \u77ed\u671f\u6f32\u5e45\u5df2\u9054 ${priceChange.toFixed(2)}%\uff0c\u6ce8\u610f\u6025\u62c9\u56de\u8abf\u98a8\u96aa`);
  }

  if (riskReward != null && riskReward < 1.5) {
    uniquePush(warnings, `\u26a0\ufe0f \u98a8\u96aa\u5831\u916c\u6bd4\u504f\u4f4e\uff08${riskReward.toFixed(1)}\uff09\uff0c\u5efa\u8b70\u7b49\u5f85\u66f4\u597d\u9032\u5834\u9ede`);
  }

  if (harmonic && !harmonic.reactionConfirmed) {
    uniquePush(warnings, '\u26a0\ufe0f \u8ae7\u6ce2 D \u9ede\u5c1a\u672a\u78ba\u8a8d\u53cd\u61c9\uff0c\u4e0d\u5efa\u8b70\u6436\u5148\u9032\u5834');
  }

  let confidence = 'low';

  if (direction !== 'watch' && riskReward != null && signalCount >= 2 && riskReward >= 2) {
    confidence = 'high';
  } else if (direction !== 'watch' && riskReward != null && signalCount >= 1 && riskReward >= 1.5) {
    confidence = 'medium';
  }

  return {
    direction,
    entry: roundTo(entry),
    sl: roundTo(sl),
    tp1: roundTo(tp1),
    tp2: roundTo(tp2),
    riskReward,
    confidence,
    reasons: reasons.slice(0, 4),
    warnings: warnings.slice(0, 4),
  };
}
