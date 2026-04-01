const HARMONIC_RATIO_TOLERANCE = 0.08;
const DEFAULT_HARMONIC_MIN_CONFIDENCE = 0.7;
const DEFAULT_HARMONIC_MAX_PATTERNS = 3;

const HARMONIC_SPECS = [
  {
    key: 'gartley',
    label: 'Gartley',
    xab: [0.618, 0.618],
    abc: [0.382, 0.886],
    bcd: [1.13, 1.618],
    xad: [0.786, 0.786],
  },
  {
    key: 'bat',
    label: 'Bat',
    xab: [0.382, 0.5],
    abc: [0.382, 0.886],
    bcd: [1.618, 2.618],
    xad: [0.886, 0.886],
  },
  {
    key: 'butterfly',
    label: 'Butterfly',
    xab: [0.786, 0.786],
    abc: [0.382, 0.886],
    bcd: [1.618, 2.618],
    xad: [1.27, 1.618],
  },
  {
    key: 'crab',
    label: 'Crab',
    xab: [0.382, 0.618],
    abc: [0.382, 0.886],
    bcd: [2.24, 3.618],
    xad: [1.618, 1.618],
  },
];

export function findSwingPoints(candles, lookback = 3) {
  const swingHighs = [];
  const swingLows = [];

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

    if (isHigh) {
      swingHighs.push({ index, price: candles[index].high, time: candles[index].time });
    }

    if (isLow) {
      swingLows.push({ index, price: candles[index].low, time: candles[index].time });
    }
  }

  return { swingHighs, swingLows };
}

function clusterPoints(points, tolerance) {
  const clusters = [];
  const used = new Set();

  for (let index = 0; index < points.length; index += 1) {
    if (used.has(index)) {
      continue;
    }

    const cluster = [points[index]];
    used.add(index);

    for (let compareIndex = index + 1; compareIndex < points.length; compareIndex += 1) {
      if (used.has(compareIndex)) {
        continue;
      }

      const clusterAvg = cluster.reduce((sum, point) => sum + point.price, 0) / cluster.length;
      const priceDistance = Math.abs(points[compareIndex].price - clusterAvg) / clusterAvg;

      if (priceDistance <= tolerance) {
        cluster.push(points[compareIndex]);
        used.add(compareIndex);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function mergeSwingSequence(swingHighs, swingLows) {
  const merged = [
    ...swingHighs.map((point) => ({ ...point, type: 'high' })),
    ...swingLows.map((point) => ({ ...point, type: 'low' })),
  ].sort((left, right) => left.index - right.index);

  const compressed = [];

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

function isWithinRange(value, [min, max], tolerance = HARMONIC_RATIO_TOLERANCE) {
  return value >= min - tolerance && value <= max + tolerance;
}

function scoreRangeFit(value, [min, max], tolerance = HARMONIC_RATIO_TOLERANCE) {
  if (!isWithinRange(value, [min, max], tolerance)) {
    return 0;
  }

  const center = (min + max) / 2;
  const halfSpan = (max - min) / 2 + tolerance || tolerance || 1;
  return Math.max(0, 1 - Math.abs(value - center) / halfSpan);
}

function sortPriceRange(values) {
  return [...values].sort((left, right) => left - right);
}

function nearestValue(values, target) {
  return [...values].sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0];
}

function getHarmonicStatus(direction, dPoint, levels, candles) {
  const followThrough = candles.slice(dPoint.index + 1);
  let reactionConfirmed = false;
  let firstTrigger = 'forming';

  for (const candle of followThrough) {
    if (direction === 'bullish') {
      if (candle.low <= levels.stopLoss) {
        firstTrigger = 'sl_hit';
        break;
      }

      if (candle.high >= levels.target2) {
        reactionConfirmed = true;
        firstTrigger = 'tp2_hit';
        break;
      }

      if (candle.high >= levels.target1) {
        reactionConfirmed = true;
        firstTrigger = 'tp1_hit';
        break;
      }

      if (candle.close > dPoint.price) {
        reactionConfirmed = true;
        firstTrigger = 'confirmed';
      }
    } else {
      if (candle.high >= levels.stopLoss) {
        firstTrigger = 'sl_hit';
        break;
      }

      if (candle.low <= levels.target2) {
        reactionConfirmed = true;
        firstTrigger = 'tp2_hit';
        break;
      }

      if (candle.low <= levels.target1) {
        reactionConfirmed = true;
        firstTrigger = 'tp1_hit';
        break;
      }

      if (candle.close < dPoint.price) {
        reactionConfirmed = true;
        firstTrigger = 'confirmed';
      }
    }
  }

  const statusMap = {
    forming: { key: 'forming', label: '形成中', shortLabel: '形成中', tone: 'neutral' },
    confirmed: { key: 'confirmed', label: '反應確認', shortLabel: '確認', tone: 'info' },
    tp1_hit: { key: 'tp1_hit', label: '止盈一', shortLabel: '止盈1', tone: 'success' },
    tp2_hit: { key: 'tp2_hit', label: '止盈完成', shortLabel: '止盈', tone: 'success' },
    sl_hit: { key: 'sl_hit', label: '停損失效', shortLabel: '止損', tone: 'danger' },
  };

  return {
    ...statusMap[firstTrigger],
    reactionConfirmed,
  };
}

function projectHarmonicLevels(spec, direction, points) {
  const { x, a, b, c, d } = points;
  const xa = Math.abs(a.price - x.price);
  const bc = Math.abs(c.price - b.price);
  const ad = Math.abs(a.price - d.price);
  const xadRange =
    direction === 'bullish'
      ? sortPriceRange([a.price - xa * spec.xad[0], a.price - xa * spec.xad[1]])
      : sortPriceRange([a.price + xa * spec.xad[0], a.price + xa * spec.xad[1]]);
  const bcdRange =
    direction === 'bullish'
      ? sortPriceRange([c.price - bc * spec.bcd[0], c.price - bc * spec.bcd[1]])
      : sortPriceRange([c.price + bc * spec.bcd[0], c.price + bc * spec.bcd[1]]);
  const przRange = sortPriceRange([nearestValue(xadRange, d.price), d.price, nearestValue(bcdRange, d.price)]);
  const stopAnchor = direction === 'bullish' ? Math.min(x.price, przRange[0]) : Math.max(x.price, przRange[2]);
  const stopLoss = direction === 'bullish' ? stopAnchor - xa * 0.03 : stopAnchor + xa * 0.03;
  const target1 = direction === 'bullish' ? d.price + ad * 0.382 : d.price - ad * 0.382;
  const target2 = direction === 'bullish' ? d.price + ad * 0.618 : d.price - ad * 0.618;

  return {
    xadRange,
    bcdRange,
    przRange: [przRange[0], przRange[2]],
    stopLoss,
    target1,
    target2,
  };
}

function buildHarmonicCandidate(points, candles) {
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

  const candidates = [];

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
    const levels = projectHarmonicLevels(spec, direction, { x, a, b, c, d });
    const status = getHarmonicStatus(direction, d, levels, candles);

    candidates.push({
      type: 'harmonic',
      key: spec.key,
      label: spec.label,
      direction,
      x,
      a,
      b,
      c,
      d,
      ratios,
      ratioTargets: {
        xab: spec.xab,
        abc: spec.abc,
        bcd: spec.bcd,
        xad: spec.xad,
      },
      projectionRanges: {
        xad: levels.xadRange,
        bcd: levels.bcdRange,
      },
      confidence: fitScore + (status.reactionConfirmed ? 0.08 : 0),
      reactionConfirmed: status.reactionConfirmed,
      status,
      przPrice: d.price,
      przRange: levels.przRange,
      stopLoss: levels.stopLoss,
      targetPrice: levels.target1,
      target1: levels.target1,
      target2: levels.target2,
    });
  });

  return candidates.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export function detectSupportResistance(swingHighs, swingLows, tolerance = 0.015) {
  const levels = [];

  clusterPoints(swingHighs, tolerance).forEach((cluster) => {
    if (cluster.length >= 2) {
      const prices = cluster.map((point) => point.price);
      const avgPrice = prices.reduce((sum, value) => sum + value, 0) / prices.length;
      levels.push({
        price: avgPrice,
        priceHigh: Math.max(...prices),
        priceLow: Math.min(...prices),
        type: 'resistance',
        touches: cluster.length,
        points: cluster,
        strength: cluster.length >= 3 ? 'strong' : 'normal',
        flipped: false,
      });
    }
  });

  clusterPoints(swingLows, tolerance).forEach((cluster) => {
    if (cluster.length >= 2) {
      const prices = cluster.map((point) => point.price);
      const avgPrice = prices.reduce((sum, value) => sum + value, 0) / prices.length;
      levels.push({
        price: avgPrice,
        priceHigh: Math.max(...prices),
        priceLow: Math.min(...prices),
        type: 'support',
        touches: cluster.length,
        points: cluster,
        strength: cluster.length >= 3 ? 'strong' : 'normal',
        flipped: false,
      });
    }
  });

  return levels.sort((left, right) => right.touches - left.touches).slice(0, 6);
}

export function applySRFlip(levels, currentClose, flipTolerance = 0.005) {
  return levels.map((level) => {
    const { priceHigh, priceLow, type } = level;
    if (type === 'resistance' && currentClose > priceHigh * (1 + flipTolerance)) {
      return { ...level, type: 'support', flipped: true };
    }
    if (type === 'support' && currentClose < priceLow * (1 - flipTolerance)) {
      return { ...level, type: 'resistance', flipped: true };
    }
    return { ...level, flipped: false };
  });
}

export function fitLine(points) {
  const length = points.length;

  if (!length) {
    return { slope: 0, intercept: 0, points: [] };
  }

  const xs = points.map((point) => point.index);
  const ys = points.map((point) => point.price);
  const xSum = xs.reduce((sum, value) => sum + value, 0);
  const ySum = ys.reduce((sum, value) => sum + value, 0);
  const xySum = xs.reduce((sum, value, index) => sum + value * ys[index], 0);
  const xSquaredSum = xs.reduce((sum, value) => sum + value * value, 0);
  const denominator = length * xSquaredSum - xSum * xSum;
  const slope = denominator === 0 ? 0 : (length * xySum - xSum * ySum) / denominator;
  const intercept = (ySum - slope * xSum) / length;

  return { slope, intercept, points };
}

export function fitPivotLine(points) {
  if (points.length < 2) {
    return null;
  }

  const p1 = points.at(-2);
  const p2 = points.at(-1);

  if (p2.index === p1.index) {
    return null;
  }

  const slope = (p2.price - p1.price) / (p2.index - p1.index);
  const intercept = p1.price - slope * p1.index;

  return { slope, intercept, p1, p2, points };
}

export function detectTriangle(swingHighs, swingLows, totalBars) {
  if (swingHighs.length < 2 || swingLows.length < 2) {
    return null;
  }

  const recentHighs = swingHighs.slice(-4);
  const recentLows = swingLows.slice(-4);
  const highLine = fitPivotLine(recentHighs);
  const lowLine = fitPivotLine(recentLows);

  if (!highLine || !lowLine) {
    return null;
  }

  if (highLine.slope > lowLine.slope || highLine.slope === lowLine.slope) {
    return null;
  }

  const apexIndex = (lowLine.intercept - highLine.intercept) / (highLine.slope - lowLine.slope);
  const lastIndex = Math.max(recentHighs.at(-1)?.index ?? 0, recentLows.at(-1)?.index ?? 0);

  if (apexIndex <= lastIndex || apexIndex > lastIndex + totalBars * 0.5) {
    return null;
  }

  let type = 'symmetric';

  if (Math.abs(highLine.slope) < 0.0001) {
    type = 'ascending';
  } else if (Math.abs(lowLine.slope) < 0.0001) {
    type = 'descending';
  }

  return {
    type,
    highLine,
    lowLine,
    upperPoints: recentHighs,
    lowerPoints: recentLows,
    apexIndex,
  };
}

export function detectWBottom(swingHighs, swingLows, candles, tolerance = 0.02) {
  const patterns = [];

  for (let leftIndex = 0; leftIndex < swingLows.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < swingLows.length; rightIndex += 1) {
      const left = swingLows[leftIndex];
      const right = swingLows[rightIndex];

      if (Math.abs(left.price - right.price) / left.price > tolerance) {
        continue;
      }

      const spacing = right.index - left.index;
      if (spacing < 5 || spacing > 48) {
        continue;
      }

      const middleHighs = swingHighs.filter((point) => point.index > left.index && point.index < right.index);
      if (!middleHighs.length) {
        continue;
      }

      const neckline = middleHighs.reduce((currentMax, point) => (point.price > currentMax.price ? point : currentMax));
      if ((neckline.price - Math.max(left.price, right.price)) / neckline.price < 0.01) {
        continue;
      }

      const lastClose = candles.at(-1)?.close ?? 0;

      patterns.push({
        type: 'w_bottom',
        leftFoot: left,
        rightFoot: right,
        neckline,
        necklinePrice: neckline.price,
        isBreakout: lastClose > neckline.price,
        targetPrice: neckline.price + (neckline.price - Math.min(left.price, right.price)),
        confidence: 1 - Math.abs(left.price - right.price) / left.price,
      });
    }
  }

  return patterns.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export function detectMTop(swingHighs, swingLows, candles, tolerance = 0.02) {
  const patterns = [];

  for (let leftIndex = 0; leftIndex < swingHighs.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < swingHighs.length; rightIndex += 1) {
      const left = swingHighs[leftIndex];
      const right = swingHighs[rightIndex];

      if (Math.abs(left.price - right.price) / left.price > tolerance) {
        continue;
      }

      const spacing = right.index - left.index;
      if (spacing < 5 || spacing > 48) {
        continue;
      }

      const middleLows = swingLows.filter((point) => point.index > left.index && point.index < right.index);
      if (!middleLows.length) {
        continue;
      }

      const neckline = middleLows.reduce((currentMin, point) => (point.price < currentMin.price ? point : currentMin));
      if ((Math.min(left.price, right.price) - neckline.price) / neckline.price < 0.01) {
        continue;
      }

      const lastClose = candles.at(-1)?.close ?? 0;

      patterns.push({
        type: 'm_top',
        leftPeak: left,
        rightPeak: right,
        neckline,
        necklinePrice: neckline.price,
        isBreakdown: lastClose < neckline.price,
        targetPrice: neckline.price - (Math.max(left.price, right.price) - neckline.price),
        confidence: 1 - Math.abs(left.price - right.price) / left.price,
      });
    }
  }

  return patterns.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export function detectHarmonicPatterns(
  swingHighs,
  swingLows,
  candles,
  {
    minConfidence = DEFAULT_HARMONIC_MIN_CONFIDENCE,
    maxPatterns = DEFAULT_HARMONIC_MAX_PATTERNS,
  } = {},
) {
  const mergedSwings = mergeSwingSequence(swingHighs, swingLows);
  const candidates = [];

  for (let index = 0; index <= mergedSwings.length - 5; index += 1) {
    const candidate = buildHarmonicCandidate(mergedSwings.slice(index, index + 5), candles);

    if (candidate) {
      candidates.push(candidate);
    }
  }

  const deduped = [];
  const seen = new Set();

  candidates
    .filter((candidate) => candidate.confidence >= minConfidence)
    .sort((left, right) => {
      const statusPriority = {
        confirmed: 5,
        forming: 4,
        tp1_hit: 3,
        tp2_hit: 2,
        sl_hit: 1,
      };

      const leftStatus = statusPriority[left.status?.key] || 0;
      const rightStatus = statusPriority[right.status?.key] || 0;

      if (rightStatus !== leftStatus) {
        return rightStatus - leftStatus;
      }

      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return (right.d?.index ?? 0) - (left.d?.index ?? 0);
    })
    .forEach((candidate) => {
      const dedupeKey = `${candidate.key}:${candidate.direction}:${candidate.d?.index ?? 'na'}`;

      if (seen.has(dedupeKey) || deduped.length >= maxPatterns) {
        return;
      }

      seen.add(dedupeKey);
      deduped.push(candidate);
    });

  return deduped;
}

export function detectHarmonicPattern(swingHighs, swingLows, candles, minConfidence = DEFAULT_HARMONIC_MIN_CONFIDENCE) {
  return (
    detectHarmonicPatterns(swingHighs, swingLows, candles, {
      minConfidence,
      maxPatterns: 1,
    })[0] ?? null
  );
}

export function detectAllPatterns(candles, options = {}) {
  const lookback = options.lookback ?? 3;
  const tolerance = options.tolerance ?? 0.005;
  const reversalTolerance = options.reversalTolerance ?? 0.02;
  const minHarmonicConfidence = options.minHarmonicConfidence ?? DEFAULT_HARMONIC_MIN_CONFIDENCE;
  const maxHarmonicPatterns = options.maxHarmonicPatterns ?? DEFAULT_HARMONIC_MAX_PATTERNS;
  const { swingHighs, swingLows } = findSwingPoints(candles, lookback);
  const harmonics = detectHarmonicPatterns(swingHighs, swingLows, candles, {
    minConfidence: minHarmonicConfidence,
    maxPatterns: maxHarmonicPatterns,
  });

  const rawLevels = detectSupportResistance(swingHighs, swingLows, tolerance);
  const currentClose = candles.at(-1)?.close ?? 0;
  const supportResistance = applySRFlip(rawLevels, currentClose);

  return {
    supportResistance,
    triangle: detectTriangle(swingHighs, swingLows, candles.length),
    harmonics,
    harmonic: harmonics[0] ?? null,
    wBottom: detectWBottom(swingHighs, swingLows, candles, reversalTolerance),
    mTop: detectMTop(swingHighs, swingLows, candles, reversalTolerance),
    swingPoints: { swingHighs, swingLows },
  };
}

export function summarizePatterns(patterns) {
  const summary = [];

  if (!patterns) {
    return summary;
  }

  if (patterns.triangle) {
    summary.push(`triangle:${patterns.triangle.type}`);
  }

  const harmonicPatterns =
    patterns.harmonics?.length
      ? patterns.harmonics
      : patterns.harmonic
        ? [patterns.harmonic]
        : [];

  harmonicPatterns.slice(0, 2).forEach((pattern) => {
    summary.push(`harmonic:${pattern.key}:${pattern.direction}`);
  });

  if (patterns.wBottom) {
    summary.push('w_bottom');
  }

  if (patterns.mTop) {
    summary.push('m_top');
  }

  patterns.supportResistance?.slice(0, 2).forEach((level) => {
    summary.push(`${level.type}:${level.touches}`);
  });

  return summary;
}
