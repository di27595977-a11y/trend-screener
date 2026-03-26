// server/ml/dataPipeline.js
// Fetches multi-timeframe data from Binance and computes ML features for storage.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { computeFeatures, FEATURE_COLUMNS } from './features.js';

dotenv.config();

const FUTURES_BASE = process.env.BINANCE_API_BASE || 'https://fapi.binance.com';
const SPOT_BASE    = 'https://api.binance.com';
const REQUESTS_PER_SECOND = Math.max(Number.parseInt(process.env.BINANCE_REQUESTS_PER_SECOND || '4', 10), 1);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(base, path, params = {}) {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

function normalizeKline(raw) {
  return {
    time:   Math.floor(raw[0] / 1000),
    open:   Number(raw[1]),
    high:   Number(raw[2]),
    low:    Number(raw[3]),
    close:  Number(raw[4]),
    volume: Number(raw[5]),
  };
}

/**
 * Fetch all data needed to compute features for one symbol.
 * @param {string} symbol  e.g. "BTCUSDT"
 * @returns {object}       { klines_1h, klines_4h, klines_1d, klines_15m, funding, oi_1h, spot_klines_1h, taker_1h }
 */
export async function fetchSymbolData(symbol) {
  const [
    raw1h, raw4h, raw1d, raw15m,
    fundingRaw, oiRaw, takerRaw, spotRaw,
  ] = await Promise.allSettled([
    fetchJson(FUTURES_BASE, '/fapi/v1/klines',          { symbol, interval: '1h',  limit: 210 }),
    fetchJson(FUTURES_BASE, '/fapi/v1/klines',          { symbol, interval: '4h',  limit: 110 }),
    fetchJson(FUTURES_BASE, '/fapi/v1/klines',          { symbol, interval: '1d',  limit: 210 }),
    fetchJson(FUTURES_BASE, '/fapi/v1/klines',          { symbol, interval: '15m', limit: 210 }),
    fetchJson(FUTURES_BASE, '/fapi/v1/fundingRate',     { symbol, limit: 24 }),
    fetchJson(FUTURES_BASE, '/futures/data/openInterestHist', { symbol, period: '1h', limit: 50 }),
    fetchJson(FUTURES_BASE, '/futures/data/takerBuySellVol',  { symbol, period: '1h', limit: 24 }),
    fetchJson(SPOT_BASE,    '/api/v3/klines',           { symbol, interval: '1h',  limit: 50 }),
  ]);

  const klines_1h       = raw1h.status  === 'fulfilled' ? raw1h.value.map(normalizeKline)    : [];
  const klines_4h       = raw4h.status  === 'fulfilled' ? raw4h.value.map(normalizeKline)    : [];
  const klines_1d       = raw1d.status  === 'fulfilled' ? raw1d.value.map(normalizeKline)    : [];
  const klines_15m      = raw15m.status === 'fulfilled' ? raw15m.value.map(normalizeKline)   : [];
  const funding         = fundingRaw.status === 'fulfilled' ? fundingRaw.value  : [];
  const oi_1h           = oiRaw.status     === 'fulfilled' ? oiRaw.value        : [];
  const taker_1h        = takerRaw.status  === 'fulfilled' ? takerRaw.value     : [];
  const spot_klines_1h  = spotRaw.status   === 'fulfilled' ? spotRaw.value.map(normalizeKline) : [];

  return { klines_1h, klines_4h, klines_1d, klines_15m, funding, oi_1h, spot_klines_1h, taker_1h };
}

/**
 * Compute and upsert ML features for one symbol (current bar).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} symbol
 * @returns {object|null}  The feature row inserted, or null on failure
 */
export async function collectFeaturesForSymbol(supabase, symbol) {
  try {
    const data     = await fetchSymbolData(symbol);
    const features = computeFeatures(data);

    if (!data.klines_1h.length) return null;

    const lastBar = data.klines_1h[data.klines_1h.length - 1];
    // Store close price as private key for label backfill
    features._close_price = lastBar.close;

    const ts = new Date(lastBar.time * 1000).toISOString();

    const { error } = await supabase
      .from('ml_features')
      .upsert(
        { symbol, ts, features },
        { onConflict: 'symbol,ts', ignoreDuplicates: false },
      );

    if (error) {
      console.error(`[dataPipeline] Upsert failed for ${symbol}:`, error.message);
      return null;
    }

    return { symbol, ts, features };
  } catch (err) {
    console.error(`[dataPipeline] Error collecting features for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Batch-collect historical features for a symbol going back N days.
 * Uses endTime pagination to walk backwards through 1h klines.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} symbol
 * @param {number} days
 */
async function collectHistoricalForSymbol(supabase, symbol, days) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const startMs  = Date.now() - days * msPerDay;
  let   endMs    = Date.now();
  let   inserted = 0;

  // Pre-fetch 4H klines for the full period (one request, used for all 1H bars)
  let klines_4h_all = [];
  try {
    const raw4h = await fetchJson(FUTURES_BASE, '/fapi/v1/klines', {
      symbol, interval: '4h', limit: 110,
    });
    klines_4h_all = raw4h.map(normalizeKline);
  } catch { /* 4H optional */ }

  // Pre-fetch funding rates for the period
  let fundingAll = [];
  try {
    const rawFunding = await fetchJson(FUTURES_BASE, '/fapi/v1/fundingRate', { symbol, limit: 100 });
    fundingAll = rawFunding || [];
  } catch { /* optional */ }

  while (endMs > startMs) {
    // Fetch 1h klines ending at endMs (200 bars = ~8.3 days)
    const endTime = endMs;
    let raw1h;
    try {
      raw1h = await fetchJson(FUTURES_BASE, '/fapi/v1/klines', {
        symbol, interval: '1h', limit: 200, endTime,
      });
    } catch {
      break;
    }

    if (!raw1h || raw1h.length === 0) break;

    const klines_1h = raw1h.map(normalizeKline);

    // Build batch rows for all valid bars in this window
    const batchRows = [];
    for (let i = klines_1h.length - 1; i >= 0; i--) {
      const sliceEnd = i + 1;
      if (sliceEnd < 30) continue;

      const barMs = klines_1h[i].time * 1000;
      if (barMs < startMs) break;

      const slice1h = klines_1h.slice(0, sliceEnd);
      // Get 4H bars with timestamp ≤ current bar
      const slice4h = klines_4h_all.filter(k => k.time * 1000 <= barMs);
      // Get funding rates with timestamp ≤ current bar
      const sliceFunding = fundingAll.filter(f =>
        Number(f.fundingTime || f.funding_time || 0) <= barMs
      );

      const features = computeFeatures({
        klines_1h: slice1h,
        klines_4h: slice4h,
        funding: sliceFunding,
      });
      features._close_price = klines_1h[i].close;

      batchRows.push({
        symbol,
        ts: new Date(barMs).toISOString(),
        features,
      });
    }

    // Single batch upsert for the entire window
    if (batchRows.length > 0) {
      const CHUNK = 50;
      for (let c = 0; c < batchRows.length; c += CHUNK) {
        const { error } = await supabase
          .from('ml_features')
          .upsert(batchRows.slice(c, c + CHUNK), { onConflict: 'symbol,ts', ignoreDuplicates: true });
        if (!error) inserted += Math.min(CHUNK, batchRows.length - c);
      }
    }

    // Move end pointer to before the earliest bar in this batch
    endMs = klines_1h[0].time * 1000 - 1;
    await sleep(Math.ceil(1000 / REQUESTS_PER_SECOND));
  }

  return inserted;
}

/**
 * Batch-collect historical features for all tradeable USDT-M perp symbols.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} days  lookback days (default 90)
 */
export async function collectAllHistorical(supabase, days = 90) {
  // Fetch symbol list
  const exchangeInfo = await fetchJson(FUTURES_BASE, '/fapi/v1/exchangeInfo');
  const symbols = exchangeInfo.symbols
    .filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
    .map((s) => s.symbol);

  console.log(`[dataPipeline] Collecting ${days} days of history for ${symbols.length} symbols...`);

  let done = 0;
  for (const symbol of symbols) {
    const n = await collectHistoricalForSymbol(supabase, symbol, days);
    done++;
    console.log(`[dataPipeline] ${done}/${symbols.length} ${symbol}: ${n} rows inserted`);
    await sleep(Math.ceil(1000 / REQUESTS_PER_SECOND));
  }

  console.log('[dataPipeline] Historical collection complete.');
}

// CLI runner
if (process.argv.includes('--collect')) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const days = Number.parseInt(process.argv[process.argv.indexOf('--days') + 1] || '90', 10);
  collectAllHistorical(supabase, days)
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
