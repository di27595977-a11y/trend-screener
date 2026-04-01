// ═══════════════════════════════════════════
//  lib/useMarketData.js — Binance 數據 Hook
//  支援任意幣種切換，自動刷新
// ═══════════════════════════════════════════
import { useState, useEffect, useCallback, useRef } from "react";
import { computeAll, calcRsi, estimateLiq } from "./indicators";

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
 * @param {string} symbol - Binance symbol, e.g. "ZECUSDT", "BTCUSDT"
 * @param {string} timeframe - "1h" | "4h" | "1d"
 * @param {number} refreshMs - auto-refresh interval (default 30s)
 */
export function useMarketData(symbol, timeframe = "4h", refreshMs = 30000) {
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState("連線中...");
  const [data, setData] = useState(null);
  const [apiStatus, setApiStatus] = useState({ spot: false, futures: false });
  const intervalRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoadMsg("載入現貨數據...");

      const [k4h, k1d, k1h, ticker] = await Promise.all([
        safeFetch(`${SPOT}/klines?symbol=${symbol}&interval=4h&limit=200`, []),
        safeFetch(`${SPOT}/klines?symbol=${symbol}&interval=1d&limit=200`, []),
        safeFetch(`${SPOT}/klines?symbol=${symbol}&interval=1h&limit=200`, []),
        safeFetch(`${SPOT}/ticker/24hr?symbol=${symbol}`, null),
      ]);

      if (!ticker || !Array.isArray(k4h) || !k4h.length) {
        setLoadMsg(`${symbol} 數據無回應，請確認幣種名稱`);
        setLoading(false);
        return;
      }

      setLoadMsg("載入合約數據...");

      const [fundRes, lsRes, oiRes] = await Promise.all([
        safeFetch(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&limit=10`, []),
        safeFetch(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=24`, []),
        safeFetch(`${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`, []),
      ]);

      const futuresOk = Array.isArray(fundRes) && fundRes.length > 0;
      setApiStatus({ spot: true, futures: futuresOk });

      const d4h = parseKlines(k4h), d1d = parseKlines(k1d), d1h = parseKlines(k1h);
      const price = +ticker.lastPrice, chg = +ticker.priceChangePercent;
      const vol = +ticker.quoteVolume, hi24 = +ticker.highPrice, lo24 = +ticker.lowPrice;

      const funding = Array.isArray(fundRes) && fundRes.length ? +fundRes[fundRes.length - 1].fundingRate : null;
      const fundHist = Array.isArray(fundRes) ? fundRes.map((r) => +r.fundingRate) : [];
      const lsRatio = Array.isArray(lsRes) && lsRes.length ? +lsRes[lsRes.length - 1].longShortRatio : null;
      const lsHist = Array.isArray(lsRes) ? lsRes.map((r) => +r.longShortRatio) : [];
      const oiHist = Array.isArray(oiRes) ? oiRes.map((r) => ({ v: +r.sumOpenInterestValue })) : [];
      const oiTrend = oiHist.length > 2 ? (oiHist[oiHist.length - 1].v > oiHist[0].v ? "rising" : "falling") : "flat";

      setLoadMsg("計算指標...");

      const tfMap = { "1h": d1h, "4h": d4h, "1d": d1d };
      const active = tfMap[timeframe];
      const ind = {
        ...computeAll(active),
        funding,
        lsRatio,
        oiTrend,
      };

      setData({
        symbol,
        price, chg, vol, hi24, lo24,
        funding, fundHist, lsRatio, lsHist, oiHist, oiTrend,
        ind,
        liq: estimateLiq(price),
        sparkline: d1h.C.slice(-48),
        multiRsi: {
          h1: calcRsi(d1h.C).value,
          h4: calcRsi(d4h.C).value,
          d1: calcRsi(d1d.C).value,
        },
        lastUpdate: new Date(),
      });

      setLoading(false);
    } catch (e) {
      console.error(`[useMarketData] ${symbol}:`, e);
      setLoadMsg(`錯誤: ${e.message}`);
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetchAll();

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchAll, refreshMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll, refreshMs]);

  return { loading, loadMsg, data, apiStatus, refetch: fetchAll };
}
