// server/ml/features.js
// 193-feature ML pipeline for Trend Screener
// Groups: A(12) B(24) C(18) D(14) E(16) F(12) G(10) H(18) I(14) J(10) K(25) L/M/N(20)

// ─── Utility Functions ──────────────────────────────────────────────────────

function safeDivide(a, b, fallback = 0) {
  if (b === 0 || !isFinite(b) || isNaN(b)) return fallback;
  const r = a / b;
  return isFinite(r) ? r : fallback;
}

function safeVal(v, fallback = 0) {
  return isFinite(v) && !isNaN(v) ? v : fallback;
}

function last(arr, offset = 1) {
  const idx = arr.length - offset;
  return idx >= 0 ? arr[idx] : NaN;
}

export function ema(values, period) {
  if (!values || values.length < period) return new Array(values?.length || 0).fill(NaN);
  const k = 2 / (period + 1);
  const result = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function rsi(values, period = 14) {
  const result = new Array(values.length).fill(NaN);
  if (values.length <= period) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    isNaN(emaFast[i]) || isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );
  const firstValid = macdLine.findIndex((v) => !isNaN(v));
  const macdSignal = new Array(closes.length).fill(NaN);
  const histogram = new Array(closes.length).fill(NaN);
  if (firstValid < 0 || firstValid + signal > closes.length) {
    return { macdLine, macdSignal, histogram };
  }
  const sigStart = firstValid + signal - 1;
  let sum = 0;
  for (let i = firstValid; i < firstValid + signal; i++) sum += macdLine[i];
  macdSignal[sigStart] = sum / signal;
  const k = 2 / (signal + 1);
  for (let i = sigStart + 1; i < closes.length; i++) {
    if (!isNaN(macdLine[i])) {
      macdSignal[i] = macdLine[i] * k + macdSignal[i - 1] * (1 - k);
    }
  }
  for (let i = sigStart; i < closes.length; i++) {
    if (!isNaN(macdLine[i]) && !isNaN(macdSignal[i])) {
      histogram[i] = macdLine[i] - macdSignal[i];
    }
  }
  return { macdLine, macdSignal, histogram };
}

export function atr(highs, lows, closes, period = 14) {
  const n = highs.length;
  const tr = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  const result = new Array(n).fill(NaN);
  if (period >= n) return result;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  result[period] = sum / period;
  for (let i = period + 1; i < n; i++) {
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
  }
  return result;
}

export function bollingerBands(closes, period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return { upper: NaN, middle: NaN, lower: NaN, width: NaN, position: NaN };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    const upper = mean + mult * std;
    const lower = mean - mult * std;
    const width = mean !== 0 ? (upper - lower) / mean : 0;
    const position = upper !== lower ? (closes[i] - lower) / (upper - lower) : 0.5;
    return { upper, middle: mean, lower, width, position };
  });
}

export function stochastic(highs, lows, closes, period = 14, smooth = 3) {
  const n = closes.length;
  const rawK = new Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    const highMax = Math.max(...highs.slice(i - period + 1, i + 1));
    const lowMin = Math.min(...lows.slice(i - period + 1, i + 1));
    rawK[i] = highMax !== lowMin ? ((closes[i] - lowMin) / (highMax - lowMin)) * 100 : 50;
  }
  const kLine = new Array(n).fill(NaN);
  for (let i = period + smooth - 2; i < n; i++) {
    const slice = rawK.slice(i - smooth + 1, i + 1);
    if (slice.every((v) => !isNaN(v))) kLine[i] = slice.reduce((a, b) => a + b, 0) / smooth;
  }
  const dLine = new Array(n).fill(NaN);
  for (let i = smooth - 1; i < n; i++) {
    const slice = kLine.slice(i - smooth + 1, i + 1).filter((v) => !isNaN(v));
    if (slice.length === smooth) dLine[i] = slice.reduce((a, b) => a + b, 0) / smooth;
  }
  return { k: kLine, d: dLine };
}

export function linearSlope(values, n) {
  if (!values || values.length === 0) return 0;
  const slice = values.slice(-Math.min(n, values.length));
  const len = slice.length;
  if (len < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < len; i++) {
    sumX += i; sumY += slice[i]; sumXY += i * slice[i]; sumX2 += i * i;
  }
  const denom = len * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  const slope = (len * sumXY - sumX * sumY) / denom;
  const lastVal = slice[len - 1];
  return lastVal !== 0 ? slope / Math.abs(lastVal) : 0;
}

export function rollingMax(values, n) {
  const slice = values.slice(-Math.min(n, values.length));
  return slice.length ? Math.max(...slice) : NaN;
}

export function rollingMin(values, n) {
  const slice = values.slice(-Math.min(n, values.length));
  return slice.length ? Math.min(...slice) : NaN;
}

export function rollingMean(values, n) {
  const slice = values.slice(-Math.min(n, values.length));
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : NaN;
}

export function rollingStd(values, n) {
  const slice = values.slice(-Math.min(n, values.length));
  if (slice.length < 2) return 0;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(variance);
}

export function obv(closes, volumes) {
  const result = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) result[i] = result[i - 1] + volumes[i];
    else if (closes[i] < closes[i - 1]) result[i] = result[i - 1] - volumes[i];
    else result[i] = result[i - 1];
  }
  return result;
}

export function consecutiveCount(boolArr) {
  let count = 0;
  for (let i = boolArr.length - 1; i >= 0; i--) {
    if (boolArr[i]) count++;
    else break;
  }
  return count;
}

function skewness(values) {
  const n = values.length;
  if (n < 3) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  if (std === 0) return 0;
  return values.reduce((s, v) => s + ((v - mean) / std) ** 3, 0) / n;
}

function excessKurtosis(values) {
  const n = values.length;
  if (n < 4) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  if (std === 0) return 0;
  return values.reduce((s, v) => s + ((v - mean) / std) ** 4, 0) / n - 3;
}

function maxDrawdown(values) {
  if (!values.length) return 0;
  let peak = values[0];
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function cci(highs, lows, closes, period = 14) {
  if (closes.length < period) return 0;
  const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const slice = typicalPrices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const mad = slice.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
  if (mad === 0) return 0;
  return (slice[slice.length - 1] - mean) / (0.015 * mad);
}

function vwap(klines, period = 24) {
  const slice = klines.slice(-Math.min(period, klines.length));
  let tvSum = 0, vSum = 0;
  for (const k of slice) {
    const tp = (k.high + k.low + k.close) / 3;
    tvSum += tp * k.volume;
    vSum += k.volume;
  }
  return vSum > 0 ? tvSum / vSum : (slice.length ? slice[slice.length - 1].close : 0);
}

// ─── Feature Columns ────────────────────────────────────────────────────────

export const FEATURE_COLUMNS = [
  // A. Price Returns (12)
  'return_1h', 'return_2h', 'return_4h', 'return_8h', 'return_12h', 'return_24h',
  'return_accel', 'consecutive_up', 'consecutive_down', 'return_skew', 'return_kurt', 'max_drawdown_24h',
  // B. Moving Averages (24)
  'ema_dist_7', 'ema_dist_14', 'ema_dist_20', 'ema_dist_50', 'ema_dist_100', 'ema_dist_200',
  'ema_slope_7', 'ema_slope_14', 'ema_slope_20', 'ema_slope_50', 'ema_slope_100', 'ema_slope_200',
  'ema_7_above_14', 'ema_14_above_20', 'ema_20_above_50', 'ema_50_above_100', 'ema_100_above_200',
  'ema_align_bull', 'ema_cross_7_14_up', 'ema_cross_7_14_down',
  'ema_price_above_count', 'ema_price_above_20', 'ema_price_above_50', 'ema_price_above_200',
  // C. Momentum (18)
  'rsi_6', 'rsi_14', 'rsi_24',
  'rsi_6_slope', 'rsi_14_slope', 'rsi_overbought', 'rsi_oversold',
  'macd_line', 'macd_signal', 'macd_hist', 'macd_bull', 'macd_hist_slope',
  'stoch_k', 'stoch_d', 'stoch_overbought', 'stoch_oversold', 'stoch_k_slope', 'cci_14',
  // D. Volatility (14)
  'atr_14_norm', 'atr_14_ratio',
  'bb_width', 'bb_position', 'bb_above_upper', 'bb_below_lower', 'bb_squeeze',
  'hist_vol_24h', 'hist_vol_168h', 'hist_vol_ratio', 'vol_percentile',
  'range_pct', 'avg_range_pct', 'vol_trend',
  // E. Volume (16)
  'vol_ma_ratio', 'vol_ma_5_ratio', 'vol_std',
  'taker_ratio', 'taker_ratio_ma', 'taker_ratio_change',
  'obv_slope', 'obv_trend',
  'vwap_dist', 'vwap_above',
  'buy_pressure', 'sell_pressure',
  'vol_surge', 'large_vol_count', 'vol_trend_slope', 'rel_vol_hour',
  // F. Candlestick Patterns (12)
  'upper_shadow_ratio', 'lower_shadow_ratio', 'body_ratio', 'body_dir',
  'doji', 'hammer', 'shooting_star',
  'engulf_bull', 'engulf_bear', 'consec_pattern', 'gap_up', 'gap_down',
  // G. Support/Resistance (10)
  'dist_high_24h', 'dist_low_24h', 'dist_high_168h', 'dist_low_168h',
  'range_pos_24h', 'range_pos_168h', 'near_support', 'near_resistance',
  'pivot_dist', 'channel_pos',
  // H. Multi-timeframe (18)
  'tf_4h_trend', 'tf_4h_rsi', 'tf_4h_macd_bull', 'tf_4h_bb_pos', 'tf_4h_slope',
  'tf_4h_above_ema20', 'tf_4h_above_ema50',
  'tf_1d_trend', 'tf_1d_rsi', 'tf_1d_above_ema50', 'tf_1d_above_ema200', 'tf_1d_vol_ratio',
  'tf_15m_rsi', 'tf_15m_trend', 'tf_15m_macd_bull', 'tf_15m_bb_pos', 'tf_15m_vol_surge',
  'trend_align_score',
  // I. Funding Rate + OI (14)
  'funding_rate', 'funding_1h_avg', 'funding_8h_avg',
  'funding_extreme_pos', 'funding_extreme_neg',
  'oi_change_1h', 'oi_change_4h', 'oi_change_24h',
  'oi_above_ma', 'oi_trend', 'funding_oi_bull', 'funding_oi_bear',
  'oi_vol_ratio', 'oi_zscore',
  // J. Spot vs Futures (10)
  'spot_vol_ratio', 'spot_above_futures', 'basis_pct',
  'spot_obv_slope', 'futures_obv_slope', 'obv_divergence',
  'spot_taker_ratio', 'spot_vol_surge', 'vol_lead', 'basis_trend',
  // K. Manipulation Detection (25)
  'pump_score', 'dump_score', 'pump_dump_velocity', 'price_spike',
  'wash_trade_score', 'vol_price_div', 'periodic_vol',
  'pin_dist', 'round_num_resist', 'price_cluster',
  'bid_ask_imbalance', 'delta_accum', 'delta_divergence',
  'manipulation_score', 'is_manipulated',
  'vol_anomaly', 'return_anomaly',
  'wick_ratio', 'wick_rejection', 'stop_hunt',
  'consec_small_bodies', 'large_wick_count_24h', 'shadow_asymmetry',
  'candle_consistency', 'vol_spike_ratio',
  // L/M/N. Time + Fundamentals (20)
  'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
  'is_weekend', 'is_asia_session', 'is_london_session', 'is_us_session',
  'vol_tier', 'market_cap_proxy', 'liquidity_score',
  'is_btc_corr', 'btc_beta_proxy', 'sector_momentum',
  'turnover_ratio', 'contract_perp', 'quote_vol_ratio',
  'price_level', 'avg_trade_size', 'market_activity',
];

// ─── Main Feature Computation ────────────────────────────────────────────────

/**
 * Compute 193 ML features from multi-timeframe market data.
 * All klines arrays should be oldest-first: [{time, open, high, low, close, volume}, ...]
 *
 * @param {object} data
 * @param {Array} data.klines_1h       - 1H klines, at least 200 bars
 * @param {Array} data.klines_4h       - 4H klines, at least 100 bars
 * @param {Array} data.klines_1d       - 1D klines, at least 50 bars
 * @param {Array} data.klines_15m      - 15M klines, at least 200 bars
 * @param {Array} data.funding         - [{fundingTime, fundingRate}]
 * @param {Array} data.oi_1h           - [{timestamp, sumOpenInterest}]
 * @param {Array} data.spot_klines_1h  - Spot 1H klines
 * @param {Array} data.taker_1h        - [{timestamp, buySellRatio, buyVol, sellVol}]
 * @returns {object} 193-key feature object
 */
export function computeFeatures({
  klines_1h = [],
  klines_4h = [],
  klines_1d = [],
  klines_15m = [],
  funding = [],
  oi_1h = [],
  spot_klines_1h = [],
  taker_1h = [],
} = {}) {
  // Return zeros for missing data
  if (klines_1h.length < 30) {
    return Object.fromEntries(FEATURE_COLUMNS.map((k) => [k, 0]));
  }

  const f = {};

  // Extract 1H arrays
  const opens_1h   = klines_1h.map((k) => k.open);
  const highs_1h   = klines_1h.map((k) => k.high);
  const lows_1h    = klines_1h.map((k) => k.low);
  const closes_1h  = klines_1h.map((k) => k.close);
  const volumes_1h = klines_1h.map((k) => k.volume);
  const n = klines_1h.length;

  const c0  = closes_1h[n - 1];
  const c1  = closes_1h[n - 2] ?? c0;
  const c2  = closes_1h[n - 3] ?? c0;
  const c4  = closes_1h[Math.max(0, n - 5)] ?? c0;
  const c8  = closes_1h[Math.max(0, n - 9)] ?? c0;
  const c12 = closes_1h[Math.max(0, n - 13)] ?? c0;
  const c24 = closes_1h[Math.max(0, n - 25)] ?? c0;

  // ── A. Price Returns (12) ────────────────────────────────────────────────
  f.return_1h   = safeVal(safeDivide(c0 - c1,  c1));
  f.return_2h   = safeVal(safeDivide(c0 - c2,  c2));
  f.return_4h   = safeVal(safeDivide(c0 - c4,  c4));
  f.return_8h   = safeVal(safeDivide(c0 - c8,  c8));
  f.return_12h  = safeVal(safeDivide(c0 - c12, c12));
  f.return_24h  = safeVal(safeDivide(c0 - c24, c24));
  f.return_accel = safeVal(f.return_1h - safeDivide(c1 - c2, c2));

  const isUp_24 = closes_1h.slice(-25).map((v, i, a) => i > 0 && v > a[i - 1]).slice(1);
  const isDn_24 = closes_1h.slice(-25).map((v, i, a) => i > 0 && v < a[i - 1]).slice(1);
  f.consecutive_up   = consecutiveCount(isUp_24);
  f.consecutive_down = consecutiveCount(isDn_24);

  const logRets24 = closes_1h.slice(-25).map((v, i, a) =>
    i > 0 && a[i - 1] > 0 ? Math.log(v / a[i - 1]) : 0,
  ).slice(1);
  f.return_skew      = safeVal(skewness(logRets24));
  f.return_kurt      = safeVal(excessKurtosis(logRets24));
  f.max_drawdown_24h = safeVal(maxDrawdown(closes_1h.slice(-25)));

  // ── B. Moving Averages (24) ──────────────────────────────────────────────
  const ema7   = ema(closes_1h, 7);
  const ema14  = ema(closes_1h, 14);
  const ema20  = ema(closes_1h, 20);
  const ema50  = ema(closes_1h, 50);
  const ema100 = ema(closes_1h, 100);
  const ema200 = ema(closes_1h, 200);

  const e7   = safeVal(last(ema7),   c0);
  const e14  = safeVal(last(ema14),  c0);
  const e20  = safeVal(last(ema20),  c0);
  const e50  = safeVal(last(ema50),  c0);
  const e100 = safeVal(last(ema100), c0);
  const e200 = safeVal(last(ema200), c0);

  f.ema_dist_7   = safeVal(safeDivide(c0 - e7,   e7));
  f.ema_dist_14  = safeVal(safeDivide(c0 - e14,  e14));
  f.ema_dist_20  = safeVal(safeDivide(c0 - e20,  e20));
  f.ema_dist_50  = safeVal(safeDivide(c0 - e50,  e50));
  f.ema_dist_100 = safeVal(safeDivide(c0 - e100, e100));
  f.ema_dist_200 = safeVal(safeDivide(c0 - e200, e200));

  f.ema_slope_7   = safeVal(linearSlope(ema7.filter((v)   => !isNaN(v)), 5));
  f.ema_slope_14  = safeVal(linearSlope(ema14.filter((v)  => !isNaN(v)), 5));
  f.ema_slope_20  = safeVal(linearSlope(ema20.filter((v)  => !isNaN(v)), 5));
  f.ema_slope_50  = safeVal(linearSlope(ema50.filter((v)  => !isNaN(v)), 5));
  f.ema_slope_100 = safeVal(linearSlope(ema100.filter((v) => !isNaN(v)), 5));
  f.ema_slope_200 = safeVal(linearSlope(ema200.filter((v) => !isNaN(v)), 5));

  f.ema_7_above_14    = e7   > e14  ? 1 : 0;
  f.ema_14_above_20   = e14  > e20  ? 1 : 0;
  f.ema_20_above_50   = e20  > e50  ? 1 : 0;
  f.ema_50_above_100  = e50  > e100 ? 1 : 0;
  f.ema_100_above_200 = e100 > e200 ? 1 : 0;
  f.ema_align_bull = (e7 > e14 && e14 > e20 && e20 > e50 && e50 > e100 && e100 > e200) ? 1 : 0;

  const prevE7  = safeVal(ema7[Math.max(0, n - 4)],  e7);
  const prevE14 = safeVal(ema14[Math.max(0, n - 4)], e14);
  f.ema_cross_7_14_up   = (prevE7 < prevE14 && e7 >= e14) ? 1 : 0;
  f.ema_cross_7_14_down = (prevE7 > prevE14 && e7 <= e14) ? 1 : 0;
  f.ema_price_above_count = [e7, e14, e20, e50, e100, e200].filter((e) => c0 > e).length;
  f.ema_price_above_20  = c0 > e20  ? 1 : 0;
  f.ema_price_above_50  = c0 > e50  ? 1 : 0;
  f.ema_price_above_200 = c0 > e200 ? 1 : 0;

  // ── C. Momentum (18) ────────────────────────────────────────────────────
  const rsi6v  = rsi(closes_1h, 6);
  const rsi14v = rsi(closes_1h, 14);
  const rsi24v = rsi(closes_1h, 24);

  f.rsi_6  = safeVal(last(rsi6v),  50);
  f.rsi_14 = safeVal(last(rsi14v), 50);
  f.rsi_24 = safeVal(last(rsi24v), 50);

  f.rsi_6_slope  = safeVal(linearSlope(rsi6v.filter((v)  => !isNaN(v)), 5));
  f.rsi_14_slope = safeVal(linearSlope(rsi14v.filter((v) => !isNaN(v)), 5));
  f.rsi_overbought = f.rsi_14 >= 70 ? 1 : 0;
  f.rsi_oversold   = f.rsi_14 <= 30 ? 1 : 0;

  const macdResult = macd(closes_1h);
  f.macd_line   = safeVal(last(macdResult.macdLine));
  f.macd_signal = safeVal(last(macdResult.macdSignal));
  f.macd_hist   = safeVal(last(macdResult.histogram));
  f.macd_bull   = f.macd_line > f.macd_signal ? 1 : 0;
  f.macd_hist_slope = safeVal(linearSlope(macdResult.histogram.filter((v) => !isNaN(v)), 5));

  const stochResult = stochastic(highs_1h, lows_1h, closes_1h);
  f.stoch_k         = safeVal(last(stochResult.k), 50);
  f.stoch_d         = safeVal(last(stochResult.d), 50);
  f.stoch_overbought = f.stoch_k >= 80 ? 1 : 0;
  f.stoch_oversold   = f.stoch_k <= 20 ? 1 : 0;
  f.stoch_k_slope    = safeVal(linearSlope(stochResult.k.filter((v) => !isNaN(v)), 5));
  f.cci_14           = safeVal(cci(highs_1h, lows_1h, closes_1h, 14));

  // ── D. Volatility (14) ──────────────────────────────────────────────────
  const atrValues = atr(highs_1h, lows_1h, closes_1h, 14);
  const atr14     = safeVal(last(atrValues), 0);
  f.atr_14_norm   = safeVal(safeDivide(atr14, c0));
  const atrMa5    = safeVal(rollingMean(atrValues.filter((v) => !isNaN(v)), 5));
  f.atr_14_ratio  = safeVal(safeDivide(atr14, atrMa5, 1));

  const bb     = bollingerBands(closes_1h, 20, 2);
  const bbLast = bb[n - 1];
  f.bb_width      = safeVal(bbLast.width);
  f.bb_position   = safeVal(bbLast.position, 0.5);
  f.bb_above_upper = c0 > safeVal(bbLast.upper, Number.POSITIVE_INFINITY) ? 1 : 0;
  f.bb_below_lower = c0 < safeVal(bbLast.lower, Number.NEGATIVE_INFINITY) ? 1 : 0;

  const widths20  = bb.slice(-20).map((b) => b.width).filter((v) => !isNaN(v));
  const avgWidth  = widths20.length ? widths20.reduce((a, b) => a + b, 0) / widths20.length : 0;
  f.bb_squeeze    = f.bb_width < avgWidth * 0.8 ? 1 : 0;

  const logRets168 = closes_1h.slice(-169).map((v, i, a) =>
    i > 0 && a[i - 1] > 0 ? Math.log(v / a[i - 1]) : 0,
  ).slice(1);
  f.hist_vol_24h  = safeVal(rollingStd(logRets168, 23) * Math.sqrt(24));
  f.hist_vol_168h = safeVal(rollingStd(logRets168, 167) * Math.sqrt(24));
  f.hist_vol_ratio = safeVal(safeDivide(f.hist_vol_24h, f.hist_vol_168h, 1));

  const volWindows = [];
  for (let i = 30; i < logRets168.length; i++) {
    volWindows.push(rollingStd(logRets168.slice(0, i), 23) * Math.sqrt(24));
  }
  const curVol = f.hist_vol_24h;
  f.vol_percentile = volWindows.length
    ? safeVal(volWindows.filter((v) => v <= curVol).length / volWindows.length)
    : 0.5;

  const h0 = highs_1h[n - 1], l0 = lows_1h[n - 1];
  f.range_pct     = safeVal(safeDivide(h0 - l0, c0));
  f.avg_range_pct = safeVal(
    rollingMean(klines_1h.slice(-20).map((k) => safeDivide(k.high - k.low, k.close)), 20),
  );
  f.vol_trend = linearSlope(atrValues.filter((v) => !isNaN(v)), 10) > 0 ? 1 : 0;

  // ── E. Volume (16) ──────────────────────────────────────────────────────
  const vol0   = volumes_1h[n - 1];
  const volMa20 = safeVal(rollingMean(volumes_1h, 20));
  const volMa5  = safeVal(rollingMean(volumes_1h.slice(-5), 5));
  f.vol_ma_ratio   = safeVal(safeDivide(vol0, volMa20, 1));
  f.vol_ma_5_ratio = safeVal(safeDivide(vol0, volMa5, 1));
  f.vol_std        = safeVal(safeDivide(rollingStd(volumes_1h, 20), volMa20));

  if (taker_1h.length >= 1) {
    const lt    = taker_1h[taker_1h.length - 1];
    const buyVol  = safeVal(Number(lt.buyVol  ?? lt.buy_vol  ?? 0));
    const sellVol = safeVal(Number(lt.sellVol ?? lt.sell_vol ?? 0));
    const totalTaker = buyVol + sellVol;
    f.taker_ratio = safeVal(safeDivide(buyVol, totalTaker, 0.5));
    const recentRatios = taker_1h.slice(-5).map((t) => {
      const b = safeVal(Number(t.buyVol ?? t.buy_vol ?? 0));
      const s = safeVal(Number(t.sellVol ?? t.sell_vol ?? 0));
      return safeDivide(b, b + s, 0.5);
    });
    f.taker_ratio_ma     = safeVal(rollingMean(recentRatios, 5));
    f.taker_ratio_change = safeVal(f.taker_ratio - f.taker_ratio_ma);
  } else {
    f.taker_ratio = 0.5; f.taker_ratio_ma = 0.5; f.taker_ratio_change = 0;
  }

  const obvValues = obv(closes_1h, volumes_1h);
  f.obv_slope = safeVal(linearSlope(obvValues.slice(-10), 10));
  f.obv_trend = f.obv_slope > 0 ? 1 : -1;

  const vwapVal = vwap(klines_1h, 24);
  f.vwap_dist  = safeVal(safeDivide(c0 - vwapVal, vwapVal));
  f.vwap_above = c0 > vwapVal ? 1 : 0;

  const pressureSlice = klines_1h.slice(-10);
  const buyPressures  = pressureSlice.map((k) => {
    const r = k.high - k.low;
    return r > 0 ? safeDivide(k.close - k.low, r) : 0.5;
  });
  const sellPressures = pressureSlice.map((k) => {
    const r = k.high - k.low;
    return r > 0 ? safeDivide(k.high - k.close, r) : 0.5;
  });
  f.buy_pressure  = safeVal(rollingMean(buyPressures,  10));
  f.sell_pressure = safeVal(rollingMean(sellPressures, 10));

  const maxVol5  = safeVal(rollingMax(volumes_1h, 5));
  f.vol_surge       = safeVal(safeDivide(maxVol5, volMa20, 1));
  f.large_vol_count = volumes_1h.slice(-24).filter((v) => v > volMa20 * 2).length;
  f.vol_trend_slope = safeVal(linearSlope(volumes_1h.slice(-10), 10));

  const curHour      = new Date((klines_1h[n - 1].time) * 1000).getUTCHours();
  const sameHourVols = klines_1h.slice(-168).filter((k) =>
    new Date(k.time * 1000).getUTCHours() === curHour,
  ).map((k) => k.volume);
  const avgSameHour = sameHourVols.length > 1
    ? sameHourVols.slice(0, -1).reduce((a, b) => a + b, 0) / (sameHourVols.length - 1)
    : volMa20;
  f.rel_vol_hour = safeVal(safeDivide(vol0, avgSameHour, 1));

  // ── F. Candlestick Patterns (12) ────────────────────────────────────────
  const o0    = opens_1h[n - 1];
  const o1    = opens_1h[n - 2] ?? o0;
  const c1f   = closes_1h[n - 2] ?? c0;
  const h1    = highs_1h[n - 2]  ?? h0;
  const l1    = lows_1h[n - 2]   ?? l0;
  const range = h0 - l0;
  const body  = Math.abs(c0 - o0);

  f.upper_shadow_ratio = safeVal(safeDivide(h0 - Math.max(c0, o0), range + 1e-10));
  f.lower_shadow_ratio = safeVal(safeDivide(Math.min(c0, o0) - l0,  range + 1e-10));
  f.body_ratio         = safeVal(safeDivide(body, range + 1e-10));
  f.body_dir           = c0 >= o0 ? 1 : -1;
  f.doji               = body < range * 0.1 ? 1 : 0;
  f.hammer = (f.lower_shadow_ratio > 0.6 && f.upper_shadow_ratio < 0.1 && c0 >= o0) ? 1 : 0;
  f.shooting_star = (f.upper_shadow_ratio > 0.6 && f.lower_shadow_ratio < 0.1 && c0 <= o0) ? 1 : 0;

  f.engulf_bull = (c0 >= o0 && c1f < o1 && c0 > o1 && o0 < c1f) ? 1 : 0;
  f.engulf_bear = (c0 <= o0 && c1f > o1 && c0 < o1 && o0 > c1f) ? 1 : 0;

  const lastDirs = closes_1h.slice(-4).map((v, i, a) =>
    i > 0 ? (v >= a[i - 1] ? 1 : -1) : 0,
  ).slice(1);
  f.consec_pattern = lastDirs.every((d) => d === 1) ? 1 : (lastDirs.every((d) => d === -1) ? -1 : 0);
  f.gap_up   = o0 > c1f ? 1 : 0;
  f.gap_down = o0 < c1f ? 1 : 0;

  // ── G. Support/Resistance (10) ───────────────────────────────────────────
  const hi24  = rollingMax(highs_1h,  24);
  const lo24  = rollingMin(lows_1h,   24);
  const hi168 = rollingMax(highs_1h, 168);
  const lo168 = rollingMin(lows_1h,  168);

  f.dist_high_24h  = safeVal(safeDivide(hi24  - c0, c0));
  f.dist_low_24h   = safeVal(safeDivide(c0 - lo24,  c0));
  f.dist_high_168h = safeVal(safeDivide(hi168 - c0, c0));
  f.dist_low_168h  = safeVal(safeDivide(c0 - lo168, c0));
  f.range_pos_24h  = safeVal(safeDivide(c0 - lo24,  hi24  - lo24,  0.5));
  f.range_pos_168h = safeVal(safeDivide(c0 - lo168, hi168 - lo168, 0.5));
  f.near_support    = f.dist_low_24h   < 0.005 ? 1 : 0;
  f.near_resistance = f.dist_high_24h  < 0.005 ? 1 : 0;
  f.pivot_dist      = safeVal(safeDivide(c0 - (hi24 + lo24 + c0) / 3, c0));
  f.channel_pos     = safeVal(f.range_pos_24h * 2 - 1);

  // ── H. Multi-Timeframe (18) ──────────────────────────────────────────────
  if (klines_4h.length >= 20) {
    const c4h  = klines_4h.map((k) => k.close);
    const h4h  = klines_4h.map((k) => k.high);
    const l4h  = klines_4h.map((k) => k.low);
    const n4h  = klines_4h.length;
    const e20_4h = safeVal(last(ema(c4h, 20)), c4h[n4h - 1]);
    const e50_4h = safeVal(last(ema(c4h, 50)), c4h[n4h - 1]);
    const c0_4h  = c4h[n4h - 1];
    f.tf_4h_trend       = e20_4h > e50_4h ? 1 : 0;
    f.tf_4h_rsi         = safeVal(last(rsi(c4h, 14).filter((v) => !isNaN(v))), 50);
    const m4h = macd(c4h);
    f.tf_4h_macd_bull   = safeVal(last(m4h.macdLine)) > safeVal(last(m4h.macdSignal)) ? 1 : 0;
    f.tf_4h_bb_pos      = safeVal(bollingerBands(c4h, 20, 2)[n4h - 1].position, 0.5);
    f.tf_4h_slope       = safeVal(linearSlope(c4h.slice(-10), 10));
    f.tf_4h_above_ema20 = c0_4h > e20_4h ? 1 : 0;
    f.tf_4h_above_ema50 = c0_4h > e50_4h ? 1 : 0;
  } else {
    f.tf_4h_trend = 0; f.tf_4h_rsi = 50; f.tf_4h_macd_bull = 0;
    f.tf_4h_bb_pos = 0.5; f.tf_4h_slope = 0;
    f.tf_4h_above_ema20 = 0; f.tf_4h_above_ema50 = 0;
  }

  if (klines_1d.length >= 50) {
    const c1d  = klines_1d.map((k) => k.close);
    const v1d  = klines_1d.map((k) => k.volume);
    const n1d  = klines_1d.length;
    const e50_1d  = safeVal(last(ema(c1d, 50)),  c1d[n1d - 1]);
    const e200_1d = safeVal(last(ema(c1d, 200)), c1d[n1d - 1]);
    const c0_1d   = c1d[n1d - 1];
    f.tf_1d_trend        = e50_1d > e200_1d ? 1 : 0;
    f.tf_1d_rsi          = safeVal(last(rsi(c1d, 14).filter((v) => !isNaN(v))), 50);
    f.tf_1d_above_ema50  = c0_1d > e50_1d  ? 1 : 0;
    f.tf_1d_above_ema200 = c0_1d > e200_1d ? 1 : 0;
    const vm20_1d = safeVal(rollingMean(v1d, 20));
    f.tf_1d_vol_ratio = safeVal(safeDivide(v1d[n1d - 1], vm20_1d, 1));
  } else {
    f.tf_1d_trend = 0; f.tf_1d_rsi = 50;
    f.tf_1d_above_ema50 = 0; f.tf_1d_above_ema200 = 0; f.tf_1d_vol_ratio = 1;
  }

  if (klines_15m.length >= 50) {
    const c15m = klines_15m.map((k) => k.close);
    const v15m = klines_15m.map((k) => k.volume);
    const n15m = klines_15m.length;
    f.tf_15m_rsi  = safeVal(last(rsi(c15m, 14).filter((v) => !isNaN(v))), 50);
    f.tf_15m_trend = safeVal(last(ema(c15m, 9))) > safeVal(last(ema(c15m, 21))) ? 1 : 0;
    const m15 = macd(c15m);
    f.tf_15m_macd_bull = safeVal(last(m15.macdLine)) > safeVal(last(m15.macdSignal)) ? 1 : 0;
    f.tf_15m_bb_pos    = safeVal(bollingerBands(c15m, 20, 2)[n15m - 1].position, 0.5);
    const vm20_15m = safeVal(rollingMean(v15m, 20));
    f.tf_15m_vol_surge = safeVal(safeDivide(v15m[n15m - 1], vm20_15m, 1));
  } else {
    f.tf_15m_rsi = 50; f.tf_15m_trend = 0; f.tf_15m_macd_bull = 0;
    f.tf_15m_bb_pos = 0.5; f.tf_15m_vol_surge = 1;
  }

  const bullSignals = [
    f.tf_4h_trend, f.tf_4h_above_ema50, f.tf_4h_macd_bull,
    f.tf_1d_trend, f.tf_1d_above_ema50,
    f.tf_15m_trend, f.tf_15m_macd_bull,
  ];
  f.trend_align_score = safeVal(bullSignals.filter((v) => v === 1).length / 7);

  // ── I. Funding Rate + OI (14) ────────────────────────────────────────────
  if (funding.length > 0) {
    const rates = funding.map((r) => safeVal(Number(r.fundingRate ?? r.funding_rate ?? 0)));
    f.funding_rate       = safeVal(last(rates));
    f.funding_1h_avg     = safeVal(rollingMean(rates, Math.min(1, rates.length)));
    f.funding_8h_avg     = safeVal(rollingMean(rates, Math.min(3, rates.length)));
    f.funding_extreme_pos = f.funding_rate > 0.0005  ? 1 : 0;
    f.funding_extreme_neg = f.funding_rate < -0.0005 ? 1 : 0;
  } else {
    f.funding_rate = 0; f.funding_1h_avg = 0; f.funding_8h_avg = 0;
    f.funding_extreme_pos = 0; f.funding_extreme_neg = 0;
  }

  if (oi_1h.length >= 2) {
    const oiVals = oi_1h.map((o) => safeVal(Number(o.sumOpenInterest ?? o.open_interest ?? 0)));
    const oi0    = oiVals[oiVals.length - 1];
    const oi1h   = oiVals[oiVals.length - 2] ?? oi0;
    const oi4h   = oiVals[Math.max(0, oiVals.length - 5)]  ?? oi0;
    const oi24h  = oiVals[Math.max(0, oiVals.length - 25)] ?? oi0;
    const oiMa24 = safeVal(rollingMean(oiVals, 24));
    f.oi_change_1h  = safeVal(safeDivide(oi0 - oi1h,  oi1h));
    f.oi_change_4h  = safeVal(safeDivide(oi0 - oi4h,  oi4h));
    f.oi_change_24h = safeVal(safeDivide(oi0 - oi24h, oi24h));
    f.oi_above_ma   = oi0 > oiMa24 ? 1 : 0;
    f.oi_trend      = safeVal(linearSlope(oiVals.slice(-10), 10));
    f.funding_oi_bull = (f.funding_rate > 0 && f.oi_change_1h > 0) ? 1 : 0;
    f.funding_oi_bear = (f.funding_rate < 0 && f.oi_change_1h < 0) ? 1 : 0;
    f.oi_vol_ratio  = safeVal(safeDivide(oi0, volMa20));
    f.oi_zscore     = safeVal(safeDivide(oi0 - oiMa24, rollingStd(oiVals, 24)));
  } else {
    f.oi_change_1h = 0; f.oi_change_4h = 0; f.oi_change_24h = 0;
    f.oi_above_ma  = 0; f.oi_trend = 0;
    f.funding_oi_bull = 0; f.funding_oi_bear = 0;
    f.oi_vol_ratio = 0; f.oi_zscore = 0;
  }

  // ── J. Spot vs Futures (10) ──────────────────────────────────────────────
  if (spot_klines_1h.length >= 2) {
    const sc  = spot_klines_1h.map((k) => k.close);
    const sv  = spot_klines_1h.map((k) => k.volume);
    const ns  = spot_klines_1h.length;
    const sc0 = sc[ns - 1];
    const svol0 = sv[ns - 1];
    const svMa20 = safeVal(rollingMean(sv, 20));
    f.spot_vol_ratio     = safeVal(safeDivide(svol0, vol0, 1));
    f.spot_above_futures = sc0 > c0 ? 1 : 0;
    f.basis_pct          = safeVal(safeDivide(c0 - sc0, sc0));
    const spotObvVals = obv(sc, sv);
    f.spot_obv_slope    = safeVal(linearSlope(spotObvVals.slice(-10), 10));
    f.futures_obv_slope = safeVal(linearSlope(obvValues.slice(-10), 10));
    f.obv_divergence    = (f.spot_obv_slope > 0) !== (f.futures_obv_slope > 0) ? 1 : 0;
    const spotBuyP = spot_klines_1h.slice(-5).map((k) => {
      const r = k.high - k.low;
      return r > 0 ? safeDivide(k.close - k.low, r) : 0.5;
    });
    f.spot_taker_ratio = safeVal(rollingMean(spotBuyP, 5));
    f.spot_vol_surge   = safeVal(safeDivide(svol0, svMa20, 1));
    const prevSvol = sv[ns - 2] ?? svol0;
    const prevFvol = volumes_1h[n - 2] ?? vol0;
    f.vol_lead    = safeDivide(svol0 - prevSvol, prevSvol) > safeDivide(vol0 - prevFvol, prevFvol) ? 1 : 0;
    const prevBasis = safeVal(safeDivide(closes_1h[n - 2] - sc[ns - 2], sc[ns - 2]));
    f.basis_trend = f.basis_pct > prevBasis ? 1 : (f.basis_pct < prevBasis ? -1 : 0);
  } else {
    f.spot_vol_ratio = 1; f.spot_above_futures = 0; f.basis_pct = 0;
    f.spot_obv_slope = 0; f.futures_obv_slope  = safeVal(linearSlope(obvValues.slice(-10), 10));
    f.obv_divergence = 0;
    f.spot_taker_ratio = 0.5; f.spot_vol_surge = 1;
    f.vol_lead = 0; f.basis_trend = 0;
  }

  // ── K. Manipulation Detection (25) ──────────────────────────────────────
  const returns5  = closes_1h.slice(-6).map((v, i, a) =>
    i > 0 ? safeDivide(v - a[i - 1], a[i - 1]) : 0,
  ).slice(1);
  const maxRet    = Math.max(...returns5);
  const minRet    = Math.min(...returns5);
  const volSurge5 = safeVal(safeDivide(rollingMax(volumes_1h, 5), volMa20, 1));

  f.pump_score = safeVal(Math.min(1, maxRet > 0.03 ? (maxRet / 0.05) * Math.min(volSurge5, 3) / 3 : 0));
  f.dump_score = safeVal(Math.min(1, minRet < -0.03 ? (Math.abs(minRet) / 0.05) * Math.min(volSurge5, 3) / 3 : 0));
  f.pump_dump_velocity = safeVal(Math.max(Math.abs(maxRet), Math.abs(minRet)) * volSurge5);
  f.price_spike = safeVal(safeDivide(Math.abs(f.return_1h), safeVal(f.hist_vol_24h, 0.01))) > 3 ? 1 : 0;

  f.wash_trade_score = safeVal(1 - Math.min(1, safeDivide(f.range_pct, safeDivide(vol0, volMa20, 1) * 0.01)));
  f.vol_price_div    = (volSurge5 > 2 && f.range_pct < f.avg_range_pct * 0.5) ? 1 : 0;

  const vols24    = volumes_1h.slice(-24);
  const volMean24 = vols24.reduce((a, b) => a + b, 0) / vols24.length;
  const volSd24   = Math.sqrt(vols24.reduce((s, v) => s + (v - volMean24) ** 2, 0) / vols24.length);
  f.periodic_vol  = safeDivide(volSd24, volMean24) < 0.2 ? 1 : 0;

  const roundLevel = Math.round(c0 / 100) * 100 || Math.round(c0 / 10) * 10;
  f.pin_dist       = safeVal(safeDivide(Math.abs(c0 - roundLevel), c0));
  f.round_num_resist = f.pin_dist < 0.005 ? 1 : 0;

  const closes24  = closes_1h.slice(-24);
  const clustered = closes24.filter((v) => Math.abs(safeDivide(v - c0, c0)) < 0.01).length;
  f.price_cluster = safeVal(clustered / 24);

  f.bid_ask_imbalance = safeVal(f.taker_ratio - 0.5) * 2;
  const takerDeltas = taker_1h.slice(-10).map((t) => {
    const b = safeVal(Number(t.buyVol  ?? t.buy_vol  ?? 0));
    const s = safeVal(Number(t.sellVol ?? t.sell_vol ?? 0));
    return b - s;
  });
  f.delta_accum     = safeVal(takerDeltas.reduce((a, b) => a + b, 0));
  const priceDir    = f.return_1h > 0 ? 1 : -1;
  const deltaDir    = f.delta_accum > 0 ? 1 : -1;
  f.delta_divergence = priceDir !== deltaDir ? 1 : 0;

  const manipFactors = [
    f.pump_score * 20,
    f.dump_score * 20,
    f.wash_trade_score * 15,
    f.vol_price_div * 15,
    f.price_spike * 10,
    f.delta_divergence * 10,
    f.periodic_vol * 10,
  ];
  f.manipulation_score = safeVal(Math.min(100, manipFactors.reduce((a, b) => a + b, 0)));
  f.is_manipulated     = f.manipulation_score > 60 ? 1 : 0;

  f.vol_anomaly    = volSurge5 > 3 ? 1 : 0;
  f.return_anomaly = safeVal(safeDivide(Math.abs(f.return_1h), safeVal(f.hist_vol_24h, 0.01))) > 3 ? 1 : 0;

  const upperShadow = h0 - Math.max(c0, o0);
  const lowerShadow = Math.min(c0, o0) - l0;
  f.wick_ratio      = safeVal(safeDivide(upperShadow + lowerShadow, body + 1e-10));
  f.wick_rejection  = (upperShadow > body * 2 || lowerShadow > body * 2) ? 1 : 0;

  const recentHigh9 = rollingMax(highs_1h.slice(-10, -1), 9);
  const recentLow9  = rollingMin(lows_1h.slice(-10, -1),  9);
  const prevMid     = (highs_1h[n - 2] + lows_1h[n - 2]) / 2 ?? c0;
  f.stop_hunt = (h0 > recentHigh9 && c0 < prevMid) || (l0 < recentLow9 && c0 > prevMid) ? 1 : 0;

  const recentBodyRatios = klines_1h.slice(-10).map((k) => safeDivide(Math.abs(k.close - k.open), k.close));
  f.consec_small_bodies = consecutiveCount(recentBodyRatios.map((b) => b < f.avg_range_pct * 0.3));

  f.large_wick_count_24h = klines_1h.slice(-24).filter((k) => {
    const r = k.high - k.low;
    const b = Math.abs(k.close - k.open);
    return r > 0 && b < r * 0.3;
  }).length;

  f.shadow_asymmetry  = safeVal(f.upper_shadow_ratio - f.lower_shadow_ratio);
  const bodyRatiosAll = klines_1h.slice(-20).map((k) => {
    const r = k.high - k.low;
    return r > 0 ? safeDivide(Math.abs(k.close - k.open), r) : 0;
  });
  f.candle_consistency = safeVal(1 - Math.min(1, rollingStd(bodyRatiosAll, 20)));
  f.vol_spike_ratio    = safeVal(safeDivide(vol0, safeVal(rollingMax(volumes_1h.slice(-10, -1), 9), vol0)));

  // ── L/M/N. Time + Fundamentals (20) ────────────────────────────────────
  const barDate = new Date((klines_1h[n - 1].time) * 1000);
  const hour    = barDate.getUTCHours();
  const dow     = barDate.getUTCDay();
  f.hour_sin = Math.sin(2 * Math.PI * hour / 24);
  f.hour_cos = Math.cos(2 * Math.PI * hour / 24);
  f.dow_sin  = Math.sin(2 * Math.PI * dow  / 7);
  f.dow_cos  = Math.cos(2 * Math.PI * dow  / 7);
  f.is_weekend      = (dow === 0 || dow === 6) ? 1 : 0;
  f.is_asia_session   = (hour >= 0  && hour < 8)  ? 1 : 0;
  f.is_london_session = (hour >= 8  && hour < 16) ? 1 : 0;
  f.is_us_session     = (hour >= 13 && hour < 22) ? 1 : 0;

  const avgDailyVol = safeVal(rollingMean(volumes_1h, 24)) * 24;
  f.vol_tier         = avgDailyVol > 1e9 ? 2 : (avgDailyVol > 1e8 ? 1 : 0);
  f.market_cap_proxy = safeVal(Math.log10(avgDailyVol + 1));
  f.liquidity_score  = safeVal(
    Math.min(1, safeDivide(safeVal(rollingMean(volumes_1h, 24)), safeVal(rollingStd(volumes_1h, 24)) + 1e-10)),
  );
  f.is_btc_corr    = 1;
  f.btc_beta_proxy = safeVal(f.return_24h / 0.05);
  f.sector_momentum = safeVal((f.return_24h + f.return_1h * 4) / 5);

  const oi0Val = oi_1h.length
    ? safeVal(Number(oi_1h[oi_1h.length - 1].sumOpenInterest ?? oi_1h[oi_1h.length - 1].open_interest ?? 0))
    : 0;
  f.turnover_ratio  = safeVal(safeDivide(vol0 * c0, oi0Val + 1e-10));
  f.contract_perp   = 1;
  const prevQuoteVol = (volumes_1h[n - 2] ?? vol0) * (closes_1h[n - 2] ?? c0);
  f.quote_vol_ratio = safeVal(safeDivide(vol0 * c0, prevQuoteVol + 1e-10, 1));
  f.price_level     = safeVal(Math.log10(c0 + 1));
  f.avg_trade_size  = safeVal(Math.log10(safeDivide(vol0 * c0, 1000) + 1));
  f.market_activity = safeVal(Math.min(1, (f.vol_ma_ratio + f.taker_ratio) / 2));

  // Clamp all values to finite
  for (const key of FEATURE_COLUMNS) {
    const v = f[key];
    f[key] = isFinite(v) && !isNaN(v) ? v : 0;
  }

  return f;
}

/**
 * Convert feature object to ordered array for TensorFlow.js
 * @param {object} featureObj
 * @returns {number[]}
 */
export function featureObjectToArray(featureObj) {
  return FEATURE_COLUMNS.map((k) => featureObj[k] ?? 0);
}
