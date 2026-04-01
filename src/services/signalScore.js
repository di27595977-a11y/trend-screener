/**
 * Signal scoring engine — evaluates pattern-based long/short conditions.
 *
 * Depends on the output of detectAllPatterns():
 *   { supportResistance, triangle, harmonic, wBottom, mTop, swingPoints }
 *
 * Returns a SignalResult: { symbol, timeframe, direction, totalScore, conditions, timestamp }
 */

export const DEFAULT_SCORE_THRESHOLD = 3;

// ─── Condition evaluators ────────────────────────────────────────────────────

function priceInBand(price, level) {
  return price >= (level.priceLow ?? level.price) && price <= (level.priceHigh ?? level.price);
}

function lineValueAt(line, index) {
  if (!line || line.slope == null) return null;
  return line.slope * index + line.intercept;
}

function evaluateConditions(patterns, candles) {
  if (!patterns || !candles.length) return [];

  const last = candles.at(-1);
  const close = last.close;
  const isBullishCandle = close > last.open;
  const isBearishCandle = close < last.open;
  const lastIndex = candles.length - 1;

  const { supportResistance = [], triangle, wBottom, mTop } = patterns;

  const conditions = [];

  // ── Long conditions ────────────────────────────────────────────────────

  // S/R support bounce: close inside support band + bullish candle
  const supportBounce = supportResistance.some(
    (level) => level.type === 'support' && !level.flipped && priceInBand(close, level) && isBullishCandle,
  );
  conditions.push({
    key: 'sr_support_bounce',
    label: 'S/R 支撐反彈',
    direction: 'long',
    score: 2,
    triggered: supportBounce,
  });

  // S/R flip long: flipped support, price above it
  const flipLong = supportResistance.some(
    (level) => level.flipped && level.type === 'support' && close > (level.priceHigh ?? level.price),
  );
  conditions.push({
    key: 'sr_flip_long',
    label: 'S/R Flip 確認',
    direction: 'long',
    score: 2,
    triggered: flipLong,
  });

  // Ascending triangle breakout
  const ascBreak =
    triangle?.type === 'ascending' &&
    triangle.highLine &&
    lineValueAt(triangle.highLine, lastIndex) != null &&
    close > lineValueAt(triangle.highLine, lastIndex);
  conditions.push({
    key: 'triangle_ascending_break',
    label: '上升三角突破',
    direction: 'long',
    score: 1.5,
    triggered: Boolean(ascBreak),
  });

  // W bottom confirmed
  const wConfirmed = wBottom && wBottom.isBreakout;
  conditions.push({
    key: 'w_bottom_confirmed',
    label: 'W底確認',
    direction: 'long',
    score: 1.5,
    triggered: Boolean(wConfirmed),
  });

  // Falling wedge breakout
  const fwBreak =
    triangle?.type === 'fallingWedge' &&
    triangle.highLine &&
    lineValueAt(triangle.highLine, lastIndex) != null &&
    close > lineValueAt(triangle.highLine, lastIndex);
  conditions.push({
    key: 'falling_wedge_break',
    label: '下降楔形突破',
    direction: 'long',
    score: 1,
    triggered: Boolean(fwBreak),
  });

  // ── Short conditions ───────────────────────────────────────────────────

  // S/R resistance rejection: close inside resistance band + bearish candle
  const resistReject = supportResistance.some(
    (level) => level.type === 'resistance' && !level.flipped && priceInBand(close, level) && isBearishCandle,
  );
  conditions.push({
    key: 'sr_resistance_reject',
    label: 'S/R 壓力回檔',
    direction: 'short',
    score: 2,
    triggered: resistReject,
  });

  // S/R flip short: flipped resistance, price below it
  const flipShort = supportResistance.some(
    (level) => level.flipped && level.type === 'resistance' && close < (level.priceLow ?? level.price),
  );
  conditions.push({
    key: 'sr_flip_short',
    label: 'S/R Flip 確認',
    direction: 'short',
    score: 2,
    triggered: flipShort,
  });

  // Descending triangle breakdown
  const descBreak =
    triangle?.type === 'descending' &&
    triangle.lowLine &&
    lineValueAt(triangle.lowLine, lastIndex) != null &&
    close < lineValueAt(triangle.lowLine, lastIndex);
  conditions.push({
    key: 'triangle_descending_break',
    label: '下降三角跌破',
    direction: 'short',
    score: 1.5,
    triggered: Boolean(descBreak),
  });

  // M top confirmed
  const mConfirmed = mTop && mTop.isBreakdown;
  conditions.push({
    key: 'm_top_confirmed',
    label: 'M頂確認',
    direction: 'short',
    score: 1.5,
    triggered: Boolean(mConfirmed),
  });

  // Rising wedge breakdown
  const rwBreak =
    triangle?.type === 'risingWedge' &&
    triangle.lowLine &&
    lineValueAt(triangle.lowLine, lastIndex) != null &&
    close < lineValueAt(triangle.lowLine, lastIndex);
  conditions.push({
    key: 'rising_wedge_break',
    label: '上升楔形跌破',
    direction: 'short',
    score: 1,
    triggered: Boolean(rwBreak),
  });

  return conditions;
}

// ─── Main scoring function ───────────────────────────────────────────────────

export function calculateSignalScore(symbol, timeframe, patterns, candles) {
  const conditions = evaluateConditions(patterns, candles);

  const longScore = conditions
    .filter((c) => c.direction === 'long' && c.triggered)
    .reduce((sum, c) => sum + c.score, 0);

  const shortScore = conditions
    .filter((c) => c.direction === 'short' && c.triggered)
    .reduce((sum, c) => sum + c.score, 0);

  const direction =
    longScore >= shortScore && longScore > 0
      ? 'long'
      : shortScore > longScore
        ? 'short'
        : 'neutral';

  const totalScore = Math.max(longScore, shortScore);

  return {
    symbol,
    timeframe,
    direction,
    totalScore: Math.round(totalScore * 10) / 10,
    conditions,
    timestamp: Date.now(),
  };
}

export function getConfidenceLabel(totalScore) {
  if (totalScore >= 4) return { label: '高信心', emoji: '🔥' };
  if (totalScore >= 3) return { label: '中信心', emoji: '⚡' };
  return { label: '低信心', emoji: '' };
}
