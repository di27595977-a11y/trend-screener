// ═══════════════════════════════════════════
//  lib/alertEngine.js — 勝率推播掃描引擎
//  純邏輯，不依賴 React
// ═══════════════════════════════════════════
import { computeAll, winRateV3, calcRsi, estimateLiq } from "./indicators";

const SPOT = "https://api.binance.com/api/v3";
const FAPI = "https://fapi.binance.com";

async function safeFetch(url, fallback = null) {
  try {
    const r = await fetch(url);
    if (!r.ok) return fallback;
    return await r.json();
  } catch {
    return fallback;
  }
}

function parseKlines(k) {
  return {
    H: k.map((c) => +c[2]),
    L: k.map((c) => +c[3]),
    C: k.map((c) => +c[4]),
    V: k.map((c) => +c[5]),
  };
}

/**
 * 取得符合成交量門檻的 USDT 交易對
 */
export async function getQualifiedCoins(minVolume = 100000000) {
  const tickers = await safeFetch(`${SPOT}/ticker/24hr`, []);
  if (!Array.isArray(tickers)) return [];
  return tickers
    .filter(
      (t) =>
        t.symbol.endsWith("USDT") &&
        !t.symbol.includes("UP") &&
        !t.symbol.includes("DOWN") &&
        !t.symbol.includes("BEAR") &&
        !t.symbol.includes("BULL") &&
        +t.quoteVolume >= minVolume
    )
    .map((t) => ({
      symbol: t.symbol,
      price: +t.lastPrice,
      change: +t.priceChangePercent,
      volume: +t.quoteVolume,
    }))
    .sort((a, b) => b.volume - a.volume);
}

/**
 * 對單一幣種執行完整 14 指標分析
 */
export async function analyzeCoin(symbol, timeframe = "4h") {
  const [k1h, k4h, k1d, ticker] = await Promise.all([
    safeFetch(`${SPOT}/klines?symbol=${symbol}&interval=1h&limit=200`, []),
    safeFetch(`${SPOT}/klines?symbol=${symbol}&interval=4h&limit=200`, []),
    safeFetch(`${SPOT}/klines?symbol=${symbol}&interval=1d&limit=200`, []),
    safeFetch(`${SPOT}/ticker/24hr?symbol=${symbol}`, null),
  ]);

  if (!ticker || !Array.isArray(k4h) || !k4h.length) {
    return null;
  }

  const d1h = parseKlines(k1h);
  const d4h = parseKlines(k4h);
  const d1d = parseKlines(k1d);
  const price = +ticker.lastPrice;
  const change = +ticker.priceChangePercent;
  const volume = +ticker.quoteVolume;

  // Futures data (optional)
  const [fundRes, lsRes] = await Promise.all([
    safeFetch(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&limit=10`, []),
    safeFetch(
      `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=24`,
      []
    ),
  ]);

  const funding =
    Array.isArray(fundRes) && fundRes.length
      ? +fundRes[fundRes.length - 1].fundingRate
      : null;
  const lsRatio =
    Array.isArray(lsRes) && lsRes.length
      ? +lsRes[lsRes.length - 1].longShortRatio
      : null;

  const tfMap = { "1h": d1h, "4h": d4h, "1d": d1d };
  const active = tfMap[timeframe] || d4h;

  const ind = {
    ...computeAll(active),
    funding,
    lsRatio,
    oiTrend: "flat",
  };

  const winRate = winRateV3(price, price, ind, timeframe);

  return {
    symbol,
    price,
    change,
    volume,
    winRate,
    indicators: ind,
    timestamp: Date.now(),
  };
}

/**
 * Rate-limited sequential scan
 */
export async function rateLimitedScan(
  coins,
  timeframe,
  onProgress,
  shouldStop
) {
  const results = [];
  for (let i = 0; i < coins.length; i++) {
    if (shouldStop && shouldStop()) break;
    try {
      const result = await analyzeCoin(coins[i].symbol, timeframe);
      if (result) results.push(result);
      else
        results.push({
          symbol: coins[i].symbol,
          price: coins[i].price,
          change: coins[i].change,
          volume: coins[i].volume,
          winRate: { long: 50, short: 50 },
          indicators: null,
          timestamp: Date.now(),
          error: true,
        });
    } catch {
      results.push({
        symbol: coins[i].symbol,
        price: coins[i].price,
        change: coins[i].change,
        volume: coins[i].volume,
        winRate: { long: 50, short: 50 },
        indicators: null,
        timestamp: Date.now(),
        error: true,
      });
    }
    if (onProgress) onProgress(i + 1, coins.length, results[results.length - 1]);
    if (i < coins.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return results;
}

// ═══════════════════════════════════════════
//  Cooldown 機制
// ═══════════════════════════════════════════
const cooldownMap = new Map();
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

export function shouldAlert(symbol, direction) {
  const key = `${symbol}_${direction}`;
  const last = cooldownMap.get(key);
  if (!last) return true;
  return Date.now() - last > COOLDOWN_MS;
}

export function markAlerted(symbol, direction) {
  cooldownMap.set(`${symbol}_${direction}`, Date.now());
}

export function getCooldownInfo(symbol, direction) {
  const key = `${symbol}_${direction}`;
  const last = cooldownMap.get(key);
  if (!last) return null;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : null;
}

// ═══════════════════════════════════════════
//  Telegram
// ═══════════════════════════════════════════
export async function sendTelegram(token, chatId, message) {
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      }
    );
    const data = await r.json();
    return { ok: data.ok, error: data.ok ? null : data.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function formatAlertMessage(result, direction, winRate) {
  const isLong = direction === "long";
  const emoji = isLong ? "🟢" : "🔴";
  const label = isLong ? "做多信號" : "做空信號";
  const chgStr =
    result.change >= 0 ? `+${result.change.toFixed(2)}%` : `${result.change.toFixed(2)}%`;

  const ind = result.indicators || {};
  const lines = [];

  if (ind.rsi != null) {
    const tag = ind.rsi < 30 ? " (偏低)" : ind.rsi > 70 ? " (偏高)" : "";
    lines.push(`  RSI: ${ind.rsi.toFixed(1)}${tag}`);
  }
  if (ind.macd?.histogram != null) {
    lines.push(`  MACD: ${ind.macd.histogram > 0 ? "多方" : "空方"}`);
  }
  if (ind.adx?.adx != null) {
    const tag = ind.adx.adx > 25 ? " (趨勢明確)" : " (震盪)";
    lines.push(`  ADX: ${ind.adx.adx.toFixed(1)}${tag}`);
  }
  if (ind.ichi) {
    const m = { bullish: "多方", bearish: "空方", in_cloud: "雲內", neutral: "中立" };
    lines.push(`  雲帶: ${m[ind.ichi.signal] || ind.ichi.signal}`);
  }
  if (ind.divs?.length > 0) {
    const d = ind.divs[0];
    lines.push(`  背離: ${d.indicator} ${d.type === "bullish" ? "多方" : "空方"}背離`);
  }

  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const wr = result.winRate;

  let msg = `${emoji} ${label} — ${result.symbol}\n\n`;
  msg += `💰 價格: $${result.price} (${chgStr})\n`;
  msg += `📊 做多勝率: ${wr.long}%\n`;
  msg += `📉 做空勝率: ${wr.short}%\n`;

  if (lines.length > 0) {
    msg += `\n📋 關鍵指標:\n${lines.join("\n")}\n`;
  }

  msg += `\n⏰ ${ts}`;

  return msg;
}
