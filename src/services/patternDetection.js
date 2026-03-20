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

      const priceDistance = Math.abs(points[compareIndex].price - points[index].price) / points[index].price;

      if (priceDistance <= tolerance) {
        cluster.push(points[compareIndex]);
        used.add(compareIndex);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

export function detectSupportResistance(swingHighs, swingLows, tolerance = 0.005) {
  const levels = [];

  clusterPoints(swingHighs, tolerance).forEach((cluster) => {
    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((sum, point) => sum + point.price, 0) / cluster.length;
      levels.push({ price: avgPrice, type: 'resistance', touches: cluster.length, points: cluster });
    }
  });

  clusterPoints(swingLows, tolerance).forEach((cluster) => {
    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((sum, point) => sum + point.price, 0) / cluster.length;
      levels.push({ price: avgPrice, type: 'support', touches: cluster.length, points: cluster });
    }
  });

  return levels.sort((left, right) => right.touches - left.touches).slice(0, 6);
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

export function detectTriangle(swingHighs, swingLows, totalBars) {
  if (swingHighs.length < 2 || swingLows.length < 2) {
    return null;
  }

  const recentHighs = swingHighs.slice(-4);
  const recentLows = swingLows.slice(-4);
  const highLine = fitLine(recentHighs);
  const lowLine = fitLine(recentLows);

  if (highLine.slope > lowLine.slope) {
    return null;
  }

  if (highLine.slope === lowLine.slope) {
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

export function detectAllPatterns(candles, options = {}) {
  const lookback = options.lookback ?? 3;
  const tolerance = options.tolerance ?? 0.005;
  const reversalTolerance = options.reversalTolerance ?? 0.02;
  const { swingHighs, swingLows } = findSwingPoints(candles, lookback);

  return {
    supportResistance: detectSupportResistance(swingHighs, swingLows, tolerance),
    triangle: detectTriangle(swingHighs, swingLows, candles.length),
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
