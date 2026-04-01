import { findSwingPoints, detectSupportResistance, applySRFlip, detectTriangle, fitPivotLine, detectWBottom, detectMTop } from '../src/services/patternDetection.js';
import { fetchCandles } from './scanJob.js';

function lineValueAt(line, index) {
  if (!line || line.slope == null) return null;
  return line.slope * index + line.intercept;
}

function priceInBand(price, level) {
  return price >= (level.priceLow ?? level.price) && price <= (level.priceHigh ?? level.price);
}

export async function computeSignalScores(symbols, timeframe = '1h') {
  const limit = timeframe === '4h' ? 168 : 240;
  const results = [];

  for (let i = 0; i < symbols.length; i += 3) {
    const batch = symbols.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const candles = await fetchCandles(symbol, timeframe, limit);
          if (candles.length < 30) return null;

          const { swingHighs, swingLows } = findSwingPoints(candles, 3);
          const rawLevels = detectSupportResistance(swingHighs, swingLows);
          const currentClose = candles.at(-1)?.close ?? 0;
          const supportResistance = applySRFlip(rawLevels, currentClose);
          const triangle = detectTriangle(swingHighs, swingLows, candles.length);
          const wBottom = detectWBottom(swingHighs, swingLows, candles);
          const mTop = detectMTop(swingHighs, swingLows, candles);

          const last = candles.at(-1);
          const close = last.close;
          const isBull = close > last.open;
          const isBear = close < last.open;
          const lastIdx = candles.length - 1;

          let longScore = 0;
          let shortScore = 0;
          const triggered = [];

          // Long conditions
          if (supportResistance.some((l) => l.type === 'support' && !l.flipped && priceInBand(close, l) && isBull)) {
            longScore += 2; triggered.push('S/R 支撐反彈');
          }
          if (supportResistance.some((l) => l.flipped && l.type === 'support' && close > (l.priceHigh ?? l.price))) {
            longScore += 2; triggered.push('S/R Flip 確認');
          }
          if (triangle?.type === 'ascending' && triangle.highLine && close > lineValueAt(triangle.highLine, lastIdx)) {
            longScore += 1.5; triggered.push('上升三角突破');
          }
          if (wBottom?.isBreakout) {
            longScore += 1.5; triggered.push('W底確認');
          }
          if (triangle?.type === 'fallingWedge' && triangle.highLine && close > lineValueAt(triangle.highLine, lastIdx)) {
            longScore += 1; triggered.push('下降楔形突破');
          }

          // Short conditions
          if (supportResistance.some((l) => l.type === 'resistance' && !l.flipped && priceInBand(close, l) && isBear)) {
            shortScore += 2; triggered.push('S/R 壓力回檔');
          }
          if (supportResistance.some((l) => l.flipped && l.type === 'resistance' && close < (l.priceLow ?? l.price))) {
            shortScore += 2; triggered.push('S/R Flip 確認');
          }
          if (triangle?.type === 'descending' && triangle.lowLine && close < lineValueAt(triangle.lowLine, lastIdx)) {
            shortScore += 1.5; triggered.push('下降三角跌破');
          }
          if (mTop?.isBreakdown) {
            shortScore += 1.5; triggered.push('M頂確認');
          }
          if (triangle?.type === 'risingWedge' && triangle.lowLine && close < lineValueAt(triangle.lowLine, lastIdx)) {
            shortScore += 1; triggered.push('上升楔形跌破');
          }

          const direction = longScore >= shortScore && longScore > 0 ? 'long' : shortScore > longScore ? 'short' : 'neutral';
          const totalScore = Math.round(Math.max(longScore, shortScore) * 10) / 10;

          if (totalScore === 0) return null;

          return {
            symbol,
            timeframe,
            direction,
            totalScore,
            currentPrice: close,
            triggered,
            timestamp: Date.now(),
          };
        } catch {
          return null;
        }
      }),
    );
    results.push(...batchResults.filter(Boolean));

    if (i + 3 < symbols.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return results.sort((a, b) => b.totalScore - a.totalScore);
}
