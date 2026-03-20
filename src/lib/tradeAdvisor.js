function toFiniteNumber(value) {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundToDisplayPrecision(value) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return null;
  }

  const abs = Math.abs(numeric);

  if (abs >= 1000) {
    return Number(numeric.toFixed(2));
  }

  if (abs >= 1) {
    return Number(numeric.toFixed(4));
  }

  if (abs >= 0.01) {
    return Number(numeric.toFixed(5));
  }

  return Number(numeric.toFixed(6));
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

export function formatTradePrice(price) {
  const numeric = toFiniteNumber(price);

  if (numeric == null) {
    return '--';
  }

  if (Math.abs(numeric) >= 1000) {
    return numeric.toFixed(2);
  }

  if (Math.abs(numeric) >= 1) {
    return numeric.toFixed(4);
  }

  if (Math.abs(numeric) >= 0.01) {
    return numeric.toFixed(5);
  }

  return numeric.toFixed(6);
}

export function formatTradePct(target, entry) {
  const targetValue = toFiniteNumber(target);
  const entryValue = toFiniteNumber(entry);

  if (targetValue == null || entryValue == null || entryValue === 0) {
    return '--';
  }

  return `${(((targetValue - entryValue) / entryValue) * 100).toFixed(2)}%`;
}

function calculateRiskReward(direction, entry, sl, tp1) {
  const entryValue = toFiniteNumber(entry);
  const stopLoss = toFiniteNumber(sl);
  const target = toFiniteNumber(tp1);

  if ([entryValue, stopLoss, target].some((value) => value == null)) {
    return null;
  }

  const longReward = target - entryValue;
  const longRisk = entryValue - stopLoss;
  const shortReward = entryValue - target;
  const shortRisk = stopLoss - entryValue;
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

  return raw == null || !Number.isFinite(raw) ? null : Math.max(0, Math.round(raw * 10) / 10);
}

function isValidTradeSetup(direction, entry, sl, tp1, tp2) {
  const entryValue = toFiniteNumber(entry);
  const stopLoss = toFiniteNumber(sl);
  const target1 = toFiniteNumber(tp1);
  const target2 = toFiniteNumber(tp2);

  if ([entryValue, stopLoss, target1].some((value) => value == null)) {
    return false;
  }

  if (direction === 'long') {
    if (stopLoss >= entryValue || target1 <= entryValue) {
      return false;
    }

    if (target2 != null && target2 <= entryValue) {
      return false;
    }
  }

  if (direction === 'short') {
    if (stopLoss <= entryValue || target1 >= entryValue) {
      return false;
    }

    if (target2 != null && target2 >= entryValue) {
      return false;
    }
  }

  return true;
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
  const priceChangePercent = toFiniteNumber(input.priceChangePercent ?? input.priceChange ?? input.priceChangePct);
  const patterns = input.patterns || {};
  const supportLevels = normalizeLevels(input.supportLevels);
  const resistanceLevels = normalizeLevels(input.resistanceLevels);
  const nearestSupport = nearestBelow(supportLevels, currentPrice);
  const nearestResistance = nearestAbove(resistanceLevels, currentPrice);
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
        prz: Array.isArray(patterns.harmonic.prz) ? patterns.harmonic.prz.map(toFiniteNumber).filter((value) => value != null) : [],
        stopLoss: toFiniteNumber(patterns.harmonic.stopLoss),
        t1: toFiniteNumber(patterns.harmonic.t1 ?? patterns.harmonic.target1),
        t2: toFiniteNumber(patterns.harmonic.t2 ?? patterns.harmonic.target2),
        confidence: toFiniteNumber(patterns.harmonic.confidence),
        reactionConfirmed: Boolean(patterns.harmonic.reactionConfirmed),
      }
    : null;

  function applyTradeSetup(nextDirection, { nextEntry = currentPrice, nextSl, nextTp1, nextTp2, reason, baseSignals = 1 }) {
    if (!isValidTradeSetup(nextDirection, nextEntry, nextSl, nextTp1, nextTp2)) {
      return false;
    }

    direction = nextDirection;
    entry = nextEntry;
    sl = nextSl;
    tp1 = nextTp1;
    tp2 = nextTp2;
    signalCount = Math.max(signalCount, baseSignals);
    uniquePush(reasons, reason, 4);
    return true;
  }

  if (harmonic && harmonic.confidence != null && harmonic.confidence >= 0.7) {
    if (harmonic.reactionConfirmed) {
      const harmonicDirection = harmonic.direction === 'bearish' ? 'short' : 'long';

      applyTradeSetup(harmonicDirection, {
        nextSl: harmonic.stopLoss,
        nextTp1: harmonic.t1,
        nextTp2: harmonic.t2,
        baseSignals: 2,
        reason: `\u5075\u6e2c\u5230 ${harmonicTypeLabel(harmonic.type)} ${harmonicDirection === 'long' ? '\u725b' : '\u718a'}\u8ae7\u6ce2\uff08\u53ef\u4fe1\u5ea6 ${Math.round(
          harmonic.confidence * 100,
        )}%\uff09\uff0cD \u9ede\u53cd\u61c9\u5df2\u78ba\u8a8d`,
      });
    } else {
      lockedWatch = true;
      uniquePush(
        reasons,
        `${harmonicTypeLabel(harmonic.type)} \u8ae7\u6ce2\u5f62\u614b\u5f62\u6210\u4e2d\uff08PRZ ${formatTradePrice(harmonic.prz[0])}-${formatTradePrice(
          harmonic.prz[1],
        )}\uff09\uff0c\u7b49\u5f85 D \u9ede\u78ba\u8a8d\u53cd\u61c9\u5f8c\u518d\u9032\u5834`,
        4,
      );
    }
  }

  if (!lockedWatch && direction === 'watch' && patterns.wBottom?.neckline != null && currentPrice > patterns.wBottom.neckline) {
    if (nearestSupport && nearestResistance) {
      applyTradeSetup('long', {
        nextSl: nearestSupport.price * 0.97,
        nextTp1: nearestResistance.price,
        nextTp2: nearestResistance.price + (nearestResistance.price - nearestSupport.price * 0.97),
        reason: `W \u5e95\u7a81\u7834\u9818\u7dda ${formatTradePrice(patterns.wBottom.neckline)}\uff0c\u8da8\u52e2\u53cd\u8f49\u8a0a\u865f`,
      });
    }
  }

  if (!lockedWatch && direction === 'watch' && patterns.mTop?.neckline != null && currentPrice < patterns.mTop.neckline) {
    if (nearestSupport && nearestResistance) {
      const stopLoss = nearestResistance.price * 1.03;
      const target1 = nearestSupport.price;

      applyTradeSetup('short', {
        nextSl: stopLoss,
        nextTp1: target1,
        nextTp2: target1 - (stopLoss - target1),
        reason: `M \u9802\u8dcc\u7834\u9818\u7dda ${formatTradePrice(patterns.mTop.neckline)}\uff0c\u8da8\u52e2\u53cd\u8f49\u8a0a\u865f`,
      });
    }
  }

  const distanceToSupport = nearestSupport ? (currentPrice - nearestSupport.price) / currentPrice : null;
  const distanceToResistance = nearestResistance ? (nearestResistance.price - currentPrice) / currentPrice : null;

  if (!lockedWatch && direction === 'watch' && nearestSupport && nearestResistance && distanceToSupport != null && distanceToSupport <= 0.03) {
    applyTradeSetup('long', {
      nextSl: nearestSupport.price * 0.97,
      nextTp1: nearestResistance.price,
      nextTp2: nearestResistance.price + (nearestResistance.price - nearestSupport.price) * 0.618,
      reason: `\u50f9\u683c\u63a5\u8fd1\u652f\u6490\u4f4d ${formatTradePrice(nearestSupport.price)}\uff08\u8ddd\u96e2 ${(
        distanceToSupport * 100
      ).toFixed(1)}%\uff09`,
    });
  }

  if (!lockedWatch && direction === 'watch' && nearestSupport && nearestResistance && distanceToResistance != null && distanceToResistance <= 0.03) {
    applyTradeSetup('short', {
      nextSl: nearestResistance.price * 1.03,
      nextTp1: nearestSupport.price,
      nextTp2: nearestSupport.price - (nearestResistance.price - nearestSupport.price) * 0.618,
      reason: `\u50f9\u683c\u63a5\u8fd1\u58d3\u529b\u4f4d ${formatTradePrice(nearestResistance.price)}\uff08\u8ddd\u96e2 ${(
        distanceToResistance * 100
      ).toFixed(1)}%\uff09`,
    });
  }

  if (!lockedWatch && direction === 'watch') {
    if (positionScore < 0.5 && score >= 60) {
      const stopLoss = nearestSupport ? nearestSupport.price * 0.97 : currentPrice * 0.95;
      const target1 = nearestResistance ? nearestResistance.price : currentPrice * 1.08;

      applyTradeSetup('long', {
        nextSl: stopLoss,
        nextTp1: target1,
        nextTp2: target1 + (target1 - stopLoss),
        reason: `\u8da8\u52e2\u5411\u4e0a\uff08\u5206\u6578 ${Math.round(score)}\uff09\uff0c\u76ee\u524d\u4f4d\u65bc\u5340\u9593\u4e2d\u6bb5\uff08${Math.round(
          positionScore * 100,
        )}%\uff09\uff0c\u5c1a\u6709\u4e0a\u5347\u7a7a\u9593`,
      });
    } else {
      entry = currentPrice;
      sl = null;
      tp1 = null;
      tp2 = null;
      uniquePush(reasons, '\u76ee\u524d\u7121\u660e\u78ba\u9032\u5834\u8a0a\u865f\uff0c\u5efa\u8b70\u7b49\u5f85\u56de\u8e29\u652f\u6490\u6216\u5f62\u614b\u78ba\u8a8d', 4);
    }
  }

  if (!lockedWatch && direction !== 'watch' && rSquared != null && rSquared >= 0.8) {
    uniquePush(reasons, `\u8da8\u52e2\u7dda\u6027\u5ea6\u9ad8\uff08R\u00b2 ${rSquared.toFixed(2)}\uff09\uff0c\u8d70\u52e2\u7a69\u5b9a`, 4);
    signalCount += 1;
  }

  if (!lockedWatch && direction !== 'watch' && volumeRatio != null && volumeRatio >= 1.5) {
    uniquePush(reasons, `\u6210\u4ea4\u91cf\u660e\u986f\u653e\u5927\uff08\u91cf\u6bd4 ${volumeRatio.toFixed(1)}x\uff09\uff0c\u52d5\u80fd\u5145\u8db3`, 4);
    signalCount += 1;
  }

  if (!lockedWatch && direction === 'long' && pullbackRatio != null && pullbackRatio <= 0.2) {
    uniquePush(reasons, `\u56de\u8abf\u5e45\u5ea6\u5c0f\uff08${(pullbackRatio * 100).toFixed(1)}%\uff09\uff0c\u591a\u982d\u5f37\u52e2`, 4);
    signalCount += 1;
  }

  if (!lockedWatch && direction !== 'watch' && patterns.triangle?.type === 'symmetric') {
    uniquePush(reasons, '\u5c0d\u7a31\u4e09\u89d2\u6536\u6582\u4e2d\uff0c\u7b49\u5f85\u7a81\u7834\u65b9\u5411\u78ba\u8a8d', 4);
  }

  let riskReward = direction === 'watch' ? null : calculateRiskReward(direction, entry, sl, tp1);

  if (positionScore > 0.85) {
    uniquePush(warnings, `\u26a0\ufe0f \u76ee\u524d\u4f4d\u65bc\u5340\u9593\u9ad8\u9ede\uff08${Math.round(positionScore * 100)}%\uff09\uff0c\u8ffd\u9ad8\u98a8\u96aa\u8f03\u5927`);
  }

  if (priceChangePercent != null && priceChangePercent > 15) {
    uniquePush(warnings, `\u26a0\ufe0f \u77ed\u671f\u6f32\u5e45\u5df2\u9054 ${priceChangePercent.toFixed(1)}%\uff0c\u6ce8\u610f\u6025\u62c9\u56de\u8abf\u98a8\u96aa`);
  }

  if (direction !== 'watch' && riskReward != null && riskReward < 1.5) {
    uniquePush(warnings, `\u26a0\ufe0f \u98a8\u96aa\u5831\u916c\u6bd4\u504f\u4f4e\uff081:${riskReward.toFixed(1)}\uff09\uff0c\u5efa\u8b70\u7b49\u5f85\u66f4\u597d\u9032\u5834\u9ede`);
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
    entry: roundToDisplayPrecision(entry),
    sl: roundToDisplayPrecision(sl),
    tp1: roundToDisplayPrecision(tp1),
    tp2: roundToDisplayPrecision(tp2),
    riskReward,
    confidence,
    reasons: reasons.slice(0, 4),
    warnings: warnings.slice(0, 4),
  };
}
