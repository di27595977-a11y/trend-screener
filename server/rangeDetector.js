import { fetchCandles, fetchTradableSymbols } from './scanJob.js';

// ─── Configuration defaults ──────────────────────────────────────────────────

const DEFAULT_RANGE_CONFIG = {
  proximityPct: 0.3,        // % distance from S/R to trigger signal
  minTouches: 2,            // minimum touches for a valid level
  minRangeWidthPct: 1.0,    // minimum range width between S/R (%)
  maxRangeWidthPct: 8.0,    // maximum range width (%)
  top30Only: true,           // only scan top-30 by market cap (volume proxy)
  cooldownMinutes: 60,       // per-symbol cooldown between Telegram pushes
  rsiOverbought: 65,         // RSI above this near resistance = stronger short
  rsiOversold: 35,           // RSI below this near support = stronger long
  lookback1h: 120,           // candles for 1H S/R detection
  lookback4h: 70,            // candles for 4H S/R detection
  swingLookback: 3,          // bars for swing point detection
  clusterTolerance: 0.005,   // 0.5% clustering tolerance
};

// ─── Technical Helpers ───────────────────────────────────────────────────────

function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcBollingerWidth(candles, period = 20) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const closes = slice.map((c) => c.close);
  const mean = closes.reduce((s, v) => s + v, 0) / period;
  const variance = closes.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return (std / mean) * 100; // width as % of mean
}

function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    atr += tr;
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

// ─── Support / Resistance Detection (ported from patternDetection.js) ────────

function findSwingPoints(candles, lookback = 3) {
  const swingHighs = [];
  const swingLows = [];

  for (let index = lookback; index < candles.length - lookback; index++) {
    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= lookback; offset++) {
      if (candles[index].high <= candles[index - offset].high || candles[index].high <= candles[index + offset].high) {
        isHigh = false;
      }
      if (candles[index].low >= candles[index - offset].low || candles[index].low >= candles[index + offset].low) {
        isLow = false;
      }
    }

    if (isHigh) swingHighs.push({ index, price: candles[index].high, time: candles[index].time });
    if (isLow) swingLows.push({ index, price: candles[index].low, time: candles[index].time });
  }

  return { swingHighs, swingLows };
}

function clusterPoints(points, tolerance) {
  const clusters = [];
  const used = new Set();

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const cluster = [points[i]];
    used.add(i);

    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(points[j].price - points[i].price) / points[i].price <= tolerance) {
        cluster.push(points[j]);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

function detectSupportResistance(candles, cfg) {
  const { swingHighs, swingLows } = findSwingPoints(candles, cfg.swingLookback);
  const levels = [];

  clusterPoints(swingHighs, cfg.clusterTolerance).forEach((cluster) => {
    if (cluster.length >= cfg.minTouches) {
      const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      levels.push({ price: avgPrice, type: 'resistance', touches: cluster.length, points: cluster });
    }
  });

  clusterPoints(swingLows, cfg.clusterTolerance).forEach((cluster) => {
    if (cluster.length >= cfg.minTouches) {
      const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      levels.push({ price: avgPrice, type: 'support', touches: cluster.length, points: cluster });
    }
  });

  return levels.sort((a, b) => b.touches - a.touches).slice(0, 6);
}

// ─── Top-30 Market Cap Filter (using 24h quote volume as proxy) ──────────────

async function fetchTop30Symbols() {
  const data = await fetch(
    `${process.env.BINANCE_API_BASE || 'https://fapi.binance.com'}/fapi/v1/ticker/24hr`,
  ).then((r) => r.json());

  return data
    .filter((t) => t.symbol.endsWith('USDT'))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 80)
    .map((t) => t.symbol);
}

// ─── Scoring Engine ──────────────────────────────────────────────────────────

function scoreSignal({ proximity, touches, rsi, signalSide, bbWidth, volumeRatio, has4hConfirm }) {
  let score = 0;

  // 1. Proximity (closer = better, max 30)
  score += Math.round(Math.max(0, 30 - (proximity / 0.3) * 20));

  // 2. Touches (more = stronger level, max 25)
  score += Math.min(touches * 8, 25);

  // 3. RSI confirmation (max 20)
  if (signalSide === 'short' && rsi > 65) score += Math.min(Math.round((rsi - 65) * 0.6), 20);
  if (signalSide === 'long' && rsi < 35) score += Math.min(Math.round((35 - rsi) * 0.6), 20);
  // Neutral RSI still gets partial credit
  if (signalSide === 'short' && rsi >= 50 && rsi <= 65) score += 5;
  if (signalSide === 'long' && rsi >= 35 && rsi <= 50) score += 5;

  // 4. Bollinger Band width — narrow = ranging (max 10)
  if (bbWidth != null && bbWidth < 3) score += Math.round(Math.max(0, 10 - bbWidth * 2));

  // 5. Volume ratio — lower volume near S/R = better reversal setup (max 5)
  if (volumeRatio != null && volumeRatio < 1.2) score += 5;

  // 6. 4H timeframe confirmation (max 10)
  if (has4hConfirm) score += 10;

  return Math.min(score, 100);
}

// ─── Main Range Detector ─────────────────────────────────────────────────────

export class RangeDetector {
  constructor({ logger = console, config = {} } = {}) {
    this.logger = logger;
    this.config = { ...DEFAULT_RANGE_CONFIG, ...config };
    this.signals = [];            // current active signals
    this.cooldowns = new Map();   // symbol -> last notified timestamp
    this.lastScanAt = null;
  }

  updateConfig(patch) {
    Object.assign(this.config, patch);
  }

  getSignals() {
    return this.signals;
  }

  getConfig() {
    return { ...this.config };
  }

  isOnCooldown(symbol) {
    const last = this.cooldowns.get(symbol);
    if (!last) return false;
    return Date.now() - last < this.config.cooldownMinutes * 60 * 1000;
  }

  markNotified(symbol) {
    this.cooldowns.set(symbol, Date.now());
  }

  async scan() {
    const cfg = this.config;
    const startedAt = Date.now();

    // 1. Get target symbols
    const symbols = cfg.top30Only ? await fetchTop30Symbols() : await fetchTradableSymbols();
    this.logger.log(`[Range] Scanning ${symbols.length} symbols...`);

    const signals = [];
    const batchSize = 3;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((sym) => this._analyzeSymbol(sym, cfg)));
      signals.push(...batchResults.filter(Boolean));

      if (i + batchSize < symbols.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Sort by score descending
    signals.sort((a, b) => b.score - a.score);
    this.signals = signals;
    this.lastScanAt = new Date().toISOString();

    this.logger.log(`[Range] Scan complete: ${signals.length} signals found in ${Date.now() - startedAt}ms`);
    return signals;
  }

  async _analyzeSymbol(symbol, cfg) {
    try {
      // Fetch 1H candles (primary)
      const candles1h = await fetchCandles(symbol, '1h', cfg.lookback1h);
      if (candles1h.length < 30) return null;

      const currentPrice = candles1h[candles1h.length - 1].close;
      const levels1h = detectSupportResistance(candles1h, cfg);

      if (levels1h.length < 2) return null;

      // Find nearest support and resistance
      const resistances = levels1h.filter((l) => l.type === 'resistance' && l.price > currentPrice);
      const supports = levels1h.filter((l) => l.type === 'support' && l.price < currentPrice);

      if (!resistances.length && !supports.length) return null;

      const nearestResistance = resistances.sort((a, b) => a.price - b.price)[0] || null;
      const nearestSupport = supports.sort((a, b) => b.price - a.price)[0] || null;

      // Check range width
      if (nearestResistance && nearestSupport) {
        const rangeWidth = ((nearestResistance.price - nearestSupport.price) / currentPrice) * 100;
        if (rangeWidth < cfg.minRangeWidthPct || rangeWidth > cfg.maxRangeWidthPct) return null;
      }

      // Determine which level is closer
      const resDist = nearestResistance ? ((nearestResistance.price - currentPrice) / currentPrice) * 100 : Infinity;
      const supDist = nearestSupport ? ((currentPrice - nearestSupport.price) / currentPrice) * 100 : Infinity;

      let signalSide = null;
      let targetLevel = null;
      let proximity = null;

      if (resDist <= cfg.proximityPct && resDist <= supDist) {
        signalSide = 'short';
        targetLevel = nearestResistance;
        proximity = resDist;
      } else if (supDist <= cfg.proximityPct && supDist < resDist) {
        signalSide = 'long';
        targetLevel = nearestSupport;
        proximity = supDist;
      }

      if (!signalSide) return null;

      // Calculate indicators
      const rsi = calcRSI(candles1h);
      const bbWidth = calcBollingerWidth(candles1h);
      const atr = calcATR(candles1h);
      const recentVolumes = candles1h.slice(-5).map((c) => c.volume);
      const avgVol = candles1h.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
      const currentVol = recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length;
      const volumeRatio = avgVol > 0 ? currentVol / avgVol : 1;

      // 4H confirmation: fetch 4H candles and check if same level exists
      let has4hConfirm = false;
      let levels4h = [];
      try {
        const candles4h = await fetchCandles(symbol, '4h', cfg.lookback4h);
        if (candles4h.length >= 20) {
          levels4h = detectSupportResistance(candles4h, cfg);
          // Check if 4H has a level within 1% of the 1H level
          has4hConfirm = levels4h.some(
            (l4) =>
              l4.type === targetLevel.type &&
              Math.abs(l4.price - targetLevel.price) / targetLevel.price < 0.01,
          );
        }
      } catch {
        // non-critical
      }

      const score = scoreSignal({
        proximity,
        touches: targetLevel.touches,
        rsi,
        signalSide,
        bbWidth,
        volumeRatio,
        has4hConfirm,
      });

      return {
        symbol,
        signalSide,
        score,
        currentPrice,
        targetLevel: {
          price: targetLevel.price,
          type: targetLevel.type,
          touches: targetLevel.touches,
        },
        proximity: Math.round(proximity * 1000) / 1000,
        rsi: Math.round(rsi * 10) / 10,
        bbWidth: bbWidth != null ? Math.round(bbWidth * 100) / 100 : null,
        atr: Math.round(atr * 100) / 100,
        volumeRatio: Math.round(volumeRatio * 100) / 100,
        has4hConfirm,
        nearestSupport: nearestSupport ? { price: nearestSupport.price, touches: nearestSupport.touches } : null,
        nearestResistance: nearestResistance ? { price: nearestResistance.price, touches: nearestResistance.touches } : null,
        levels4h: levels4h.slice(0, 4).map((l) => ({ price: l.price, type: l.type, touches: l.touches })),
        detectedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}

export { DEFAULT_RANGE_CONFIG };
