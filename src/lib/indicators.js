// ═══════════════════════════════════════════
//  lib/indicators.js — 14 指標計算引擎
//  純函數，不依賴任何框架，可獨立測試
// ═══════════════════════════════════════════

export function calcEma(data, p) {
  if (data.length < p) return { v: null, s: [] };
  const k = 2 / (p + 1);
  let e = data.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const s = new Array(p - 1).fill(null);
  s.push(e);
  for (let i = p; i < data.length; i++) { e = data[i] * k + e * (1 - k); s.push(e); }
  return { v: e, s };
}

export function calcRsi(closes, p = 14) {
  if (closes.length < p + 1) return { value: null, series: [] };
  const series = [];
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL -= d;
  }
  avgG /= p; avgL /= p;
  series.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (p - 1) + (d > 0 ? d : 0)) / p;
    avgL = (avgL * (p - 1) + (d < 0 ? -d : 0)) / p;
    series.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  }
  return { value: series[series.length - 1], series };
}

export function calcMacd(closes) {
  const e12 = calcEma(closes, 12), e26 = calcEma(closes, 26);
  if (!e12.v || !e26.v) return { macd: null, signal: null, histogram: null, series: [] };
  const ms = e12.s.map((v, i) => v !== null && e26.s[i] !== null ? v - e26.s[i] : null).filter(v => v !== null);
  const sig = calcEma(ms, 9);
  const line = e12.v - e26.v;
  return { macd: line, signal: sig.v, histogram: sig.v !== null ? line - sig.v : null, series: ms };
}

export function calcBollinger(closes, p = 20) {
  if (closes.length < p) return null;
  const s = closes.slice(-p), m = s.reduce((a, b) => a + b, 0) / p;
  const std = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / p);
  return { upper: m + 2 * std, middle: m, lower: m - 2 * std, bw: std > 0 ? (4 * std) / m * 100 : 0 };
}

export function calcAtr(H, L, C, p = 14) {
  if (C.length < p + 1) return null;
  const trs = [];
  for (let i = 1; i < C.length; i++) trs.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
  return trs.slice(-p).reduce((a, b) => a + b, 0) / p;
}

export function calcADX(H, L, C, p = 14) {
  if (C.length < p * 2 + 1) return { adx: null, pdi: null, mdi: null };
  const pd = [], md = [], tr = [];
  for (let i = 1; i < H.length; i++) {
    const u = H[i] - H[i - 1], d = L[i - 1] - L[i];
    pd.push(u > d && u > 0 ? u : 0);
    md.push(d > u && d > 0 ? d : 0);
    tr.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
  }
  let sT = tr.slice(0, p).reduce((a, b) => a + b, 0);
  let sP = pd.slice(0, p).reduce((a, b) => a + b, 0);
  let sM = md.slice(0, p).reduce((a, b) => a + b, 0);
  const dx = [];
  for (let i = p; i < tr.length; i++) {
    sT = sT - sT / p + tr[i]; sP = sP - sP / p + pd[i]; sM = sM - sM / p + md[i];
    const pdi = sT > 0 ? (sP / sT) * 100 : 0, mdi = sT > 0 ? (sM / sT) * 100 : 0;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : Math.abs(pdi - mdi) / sum * 100);
  }
  if (dx.length < p) return { adx: null, pdi: null, mdi: null };
  let adx = dx.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < dx.length; i++) adx = (adx * (p - 1) + dx[i]) / p;
  return { adx, pdi: sT > 0 ? (sP / sT) * 100 : 0, mdi: sT > 0 ? (sM / sT) * 100 : 0 };
}

export function calcOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i]);
    else obv.push(obv[i - 1]);
  }
  const trend = obv.length > 5 ? (obv[obv.length - 1] > obv[obv.length - 5] ? "rising" : "falling") : "flat";
  const priceTrend = closes.length > 5 ? (closes[closes.length - 1] > closes[closes.length - 5] ? "rising" : "falling") : "flat";
  let divergence = "none";
  if (priceTrend === "rising" && trend === "falling") divergence = "bearish";
  if (priceTrend === "falling" && trend === "rising") divergence = "bullish";
  return { series: obv.slice(-40), trend, divergence };
}

export function calcVWAP(H, L, C, V) {
  let cumTPV = 0, cumV = 0;
  const series = [];
  for (let i = 0; i < C.length; i++) {
    const tp = (H[i] + L[i] + C[i]) / 3;
    cumTPV += tp * V[i]; cumV += V[i];
    series.push(cumV > 0 ? cumTPV / cumV : tp);
  }
  const vwap = series[series.length - 1];
  let sumSq = 0;
  for (let i = 0; i < C.length; i++) { const tp = (H[i] + L[i] + C[i]) / 3; sumSq += (tp - series[i]) ** 2; }
  const std = Math.sqrt(sumSq / C.length);
  return { vwap, upper1: vwap + std, lower1: vwap - std, upper2: vwap + 2 * std, lower2: vwap - 2 * std, series: series.slice(-40) };
}

export function detectDivergence(closes, rsiSeries, macdSeries) {
  const divs = [], len = closes.length;
  if (rsiSeries.length < 20) return divs;
  const startIdx = Math.max(2, len - 60);
  const pL = [], pH = [];
  for (let i = startIdx; i < len - 2; i++) {
    if (closes[i] < closes[i - 1] && closes[i] < closes[i - 2] && closes[i] < closes[i + 1] && closes[i] < closes[i + 2]) pL.push({ idx: i, p: closes[i] });
    if (closes[i] > closes[i - 1] && closes[i] > closes[i - 2] && closes[i] > closes[i + 1] && closes[i] > closes[i + 2]) pH.push({ idx: i, p: closes[i] });
  }
  const rOff = len - rsiSeries.length;
  const gR = idx => idx - rOff >= 0 && idx - rOff < rsiSeries.length ? rsiSeries[idx - rOff] : null;
  for (let i = 1; i < pL.length; i++) { const pr = pL[i - 1], cu = pL[i]; const rP = gR(pr.idx), rC = gR(cu.idx); if (rP !== null && rC !== null && cu.p < pr.p && rC > rP) divs.push({ type: "bullish", indicator: "RSI", price: cu.p, idx: cu.idx, strength: Math.abs(rC - rP) }); }
  for (let i = 1; i < pH.length; i++) { const pr = pH[i - 1], cu = pH[i]; const rP = gR(pr.idx), rC = gR(cu.idx); if (rP !== null && rC !== null && cu.p > pr.p && rC < rP) divs.push({ type: "bearish", indicator: "RSI", price: cu.p, idx: cu.idx, strength: Math.abs(rC - rP) }); }
  if (macdSeries.length > 20) {
    const mOff = len - macdSeries.length;
    const gM = idx => idx - mOff >= 0 && idx - mOff < macdSeries.length ? macdSeries[idx - mOff] : null;
    for (let i = 1; i < pL.length; i++) { const pr = pL[i - 1], cu = pL[i]; const mP = gM(pr.idx), mC = gM(cu.idx); if (mP !== null && mC !== null && cu.p < pr.p && mC > mP) divs.push({ type: "bullish", indicator: "MACD", price: cu.p, idx: cu.idx, strength: Math.abs(mC - mP) }); }
    for (let i = 1; i < pH.length; i++) { const pr = pH[i - 1], cu = pH[i]; const mP = gM(pr.idx), mC = gM(cu.idx); if (mP !== null && mC !== null && cu.p > pr.p && mC < mP) divs.push({ type: "bearish", indicator: "MACD", price: cu.p, idx: cu.idx, strength: Math.abs(mC - mP) }); }
  }
  return divs.sort((a, b) => b.idx - a.idx).slice(0, 6);
}

export function calcIchimoku(H, L, C) {
  if (C.length < 52) return null;
  const tenkan = (Math.max(...H.slice(-9)) + Math.min(...L.slice(-9))) / 2;
  const kijun = (Math.max(...H.slice(-26)) + Math.min(...L.slice(-26))) / 2;
  const sA = (tenkan + kijun) / 2, sB = (Math.max(...H.slice(-52)) + Math.min(...L.slice(-52))) / 2;
  const top = Math.max(sA, sB), bot = Math.min(sA, sB), p = C[C.length - 1];
  let signal = "neutral";
  if (p > top && tenkan > kijun) signal = "bullish";
  else if (p < bot && tenkan < kijun) signal = "bearish";
  else if (p >= bot && p <= top) signal = "in_cloud";
  return { tenkan, kijun, top, bot, signal };
}

export function calcVpvr(H, L, C, V, bins = 24) {
  if (C.length < 10) return null;
  const cc = [...C];
  const mn = Math.min(...L), mx = Math.max(...H), step = (mx - mn) / bins;
  if (step === 0) return null;
  const profile = Array.from({ length: bins }, (_, i) => ({
    from: mn + i * step, to: mn + (i + 1) * step, mid: mn + (i + 0.5) * step, vol: 0, buy: 0, sell: 0,
  }));
  for (let i = 0; i < cc.length; i++) {
    const idx = Math.min(Math.floor((cc[i] - mn) / step), bins - 1);
    if (idx >= 0) { profile[idx].vol += V[i]; cc[i] >= (i > 0 ? cc[i - 1] : cc[i]) ? profile[idx].buy += V[i] : profile[idx].sell += V[i]; }
  }
  const maxVol = Math.max(...profile.map(p => p.vol));
  const poc = profile.reduce((a, b) => b.vol > a.vol ? b : a);
  const totalVol = profile.reduce((a, b) => a + b.vol, 0);
  const sorted = [...profile].sort((a, b) => b.vol - a.vol);
  let vaV = 0; const vaL = [];
  for (const l of sorted) { vaV += l.vol; vaL.push(l); if (vaV >= totalVol * 0.7) break; }
  return { profile, maxVol, poc, vah: Math.max(...vaL.map(l => l.mid)), val: Math.min(...vaL.map(l => l.mid)), step };
}

export function calcHarmonics(H, L, C) {
  const sw = [];
  for (let i = 3; i < C.length - 3; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= 3; j++) { if (H[i] <= H[i - j] || H[i] <= H[i + j]) isH = false; if (L[i] >= L[i - j] || L[i] >= L[i + j]) isL = false; }
    if (isH) sw.push({ t: "high", p: H[i], i });
    if (isL) sw.push({ t: "low", p: L[i], i });
  }
  if (sw.length < 5) return [];
  const defs = {
    Gartley: { XB: [.55, .7], AC: [.38, .89], BD: [1.27, 1.62], XD: [.72, .85], wr: 70 },
    Bat: { XB: [.33, .55], AC: [.38, .89], BD: [1.62, 2.62], XD: [.82, .95], wr: 68 },
    Butterfly: { XB: [.72, .85], AC: [.38, .89], BD: [1.62, 2.62], XD: [1.22, 1.68], wr: 65 },
    Crab: { XB: [.33, .65], AC: [.38, .89], BD: [2.62, 3.62], XD: [1.55, 1.7], wr: 63 },
    Shark: { XB: [.33, .65], AC: [1.08, 1.65], BD: [1.62, 2.24], XD: [.85, 1.15], wr: 62 },
  };
  const pats = [];
  const recent = sw.slice(-10);
  for (let i = 0; i <= recent.length - 5; i++) {
    const [X, A, B, Cp, D] = recent.slice(i, i + 5);
    const XA = Math.abs(A.p - X.p);
    if (XA === 0) continue;
    const xb = Math.abs(B.p - A.p) / XA, ac = Math.abs(Cp.p - B.p) / (Math.abs(B.p - A.p) || 1);
    const bd = Math.abs(D.p - Cp.p) / (Math.abs(Cp.p - B.p) || 1), xd = Math.abs(D.p - X.p) / XA;
    for (const [n, d] of Object.entries(defs)) {
      if (xb >= d.XB[0] && xb <= d.XB[1] && ac >= d.AC[0] && ac <= d.AC[1] && bd >= d.BD[0] && bd <= d.BD[1] && xd >= d.XD[0] && xd <= d.XD[1]) {
        const bull = D.t === "low";
        pats.push({ name: n, type: bull ? "bullish" : "bearish", prz: D.p, tp1: bull ? D.p + XA * .382 : D.p - XA * .382, tp2: bull ? D.p + XA * .618 : D.p - XA * .618, sl: bull ? D.p - XA * .15 : D.p + XA * .15, wr: d.wr });
      }
    }
  }
  return pats.slice(0, 3);
}

export function findSR(H, L, C) {
  const levels = [];
  for (let i = 2; i < C.length - 2; i++) {
    if (L[i] < L[i - 1] && L[i] < L[i - 2] && L[i] < L[i + 1] && L[i] < L[i + 2]) levels.push({ type: "support", price: L[i] });
    if (H[i] > H[i - 1] && H[i] > H[i - 2] && H[i] > H[i + 1] && H[i] > H[i + 2]) levels.push({ type: "resistance", price: H[i] });
  }
  return levels.slice(-12);
}

export function estimateLiq(price) {
  return [5, 10, 20, 25, 50, 75, 100].map(lev => ({
    leverage: lev,
    longLiq: Math.round(price * (1 - 0.9 / lev) * 100) / 100,
    shortLiq: Math.round(price * (1 + 0.9 / lev) * 100) / 100,
  }));
}

// ═══════════════════════════════════════════
//  WIN RATE v3 — 14 指標加權
// ═══════════════════════════════════════════
export function winRateV3(entry, curr, ind, tf) {
  const isS = tf === "1h", isD = tf === "1d";
  const w = { rsi: isS ? 8 : 7, macd: isS ? 7 : 8, bb: 7, ema: isD ? 10 : 7, sr: 6, ichi: isD ? 10 : 7, harm: isD ? 12 : 8, vpvr: isS ? 9 : 7, sent: isS ? 10 : 7, div: 10, obv: 6, adx: 5, vwap: isS ? 8 : 4, oi: isS ? 8 : 6 };
  let L = 0, S = 0;

  if (ind.rsi !== null) { if (ind.rsi < 30) L += w.rsi; else if (ind.rsi < 40) L += w.rsi * .5; else if (ind.rsi > 70) S += w.rsi; else if (ind.rsi > 60) S += w.rsi * .5; }
  if (ind.macd?.histogram !== null) { ind.macd.histogram > 0 ? L += w.macd : S += w.macd; }
  if (ind.bb) { const p = (entry - ind.bb.lower) / (ind.bb.upper - ind.bb.lower); if (p < .2) L += w.bb; else if (p < .35) L += w.bb * .5; else if (p > .8) S += w.bb; else if (p > .65) S += w.bb * .5; }
  if (ind.ema50 && ind.ema200) { ind.ema50 > ind.ema200 ? L += w.ema * .6 : S += w.ema * .6; }
  if (ind.ema20 && ind.ema50) { ind.ema20 > ind.ema50 ? L += w.ema * .4 : S += w.ema * .4; }
  if (ind.levels) { if (ind.levels.filter(l => l.type === "support" && Math.abs(l.price - entry) / entry < .025).length) L += w.sr; if (ind.levels.filter(l => l.type === "resistance" && Math.abs(l.price - entry) / entry < .025).length) S += w.sr; }
  if (ind.ichi) { if (ind.ichi.signal === "bullish") L += w.ichi; else if (ind.ichi.signal === "bearish") S += w.ichi; ind.ichi.tenkan > ind.ichi.kijun ? L += w.ichi * .3 : S += w.ichi * .3; }
  if (ind.harm?.length > 0) { const h = ind.harm[0]; const d = Math.abs(entry - h.prz) / entry; if (d < .03) { h.type === "bullish" ? L += w.harm : S += w.harm; } else if (d < .06) { h.type === "bullish" ? L += w.harm * .4 : S += w.harm * .4; } }
  if (ind.vpvr) { if (entry <= ind.vpvr.val) L += w.vpvr * .7; if (entry >= ind.vpvr.vah) S += w.vpvr * .7; }
  if (ind.funding !== null) { if (ind.funding > .01) S += w.sent * .4; else if (ind.funding < -.01) L += w.sent * .4; }
  if (ind.lsRatio !== null) { if (ind.lsRatio > 2) S += w.sent * .6; else if (ind.lsRatio < .7) L += w.sent * .6; else if (ind.lsRatio > 1.5) S += w.sent * .3; else if (ind.lsRatio < .9) L += w.sent * .3; }
  if (ind.divs?.length > 0) { ind.divs[0].type === "bullish" ? L += w.div : S += w.div; }
  if (ind.obv) { if (ind.obv.divergence === "bullish") L += w.obv; else if (ind.obv.divergence === "bearish") S += w.obv; else ind.obv.trend === "rising" ? L += w.obv * .4 : S += w.obv * .4; }
  if (ind.adx?.adx > 25) { ind.adx.pdi > ind.adx.mdi ? L += w.adx : S += w.adx; }
  if (ind.vwap) { if (entry < ind.vwap.lower1) L += w.vwap; else if (entry > ind.vwap.upper1) S += w.vwap; else entry < ind.vwap.vwap ? L += w.vwap * .3 : S += w.vwap * .3; }
  if (ind.oiTrend === "rising" && (ind.funding || 0) > .005) S += w.oi * .5;
  if (ind.oiTrend === "rising" && (ind.funding || 0) < -.005) L += w.oi * .5;

  const tot = L + S || 1;
  const lp = Math.round((L / tot) * 100);
  return { long: Math.max(12, Math.min(88, lp)), short: Math.max(12, Math.min(88, 100 - lp)) };
}

// ═══════════════════════════════════════════
//  Compute all indicators for a given dataset
// ═══════════════════════════════════════════
export function computeAll(klines) {
  const { H, L, C, V } = klines;
  const rsiD = calcRsi(C);
  const macdD = calcMacd(C);
  return {
    rsi: rsiD.value,
    macd: macdD,
    bb: calcBollinger(C),
    ema20: calcEma(C, 20).v,
    ema50: calcEma(C, 50).v,
    ema200: calcEma(C, 200).v,
    atr: calcAtr(H, L, C),
    adx: calcADX(H, L, C),
    obv: calcOBV(C, V),
    vwap: calcVWAP(H, L, C, V),
    divs: detectDivergence(C, rsiD.series, macdD.series),
    levels: findSR(H, L, C),
    ichi: calcIchimoku(H, L, C),
    vpvr: calcVpvr(H, L, C, V),
    harm: calcHarmonics(H, L, C),
  };
}
