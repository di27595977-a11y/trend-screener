// ═══════════════════════════════════════════
//  components/CryptoAnalyzer.jsx
//  通用加密貨幣分析元件 — 支援任意 Binance 幣種
//
//  使用方式:
//    <CryptoAnalyzer />                        // 預設 ZEC
//    <CryptoAnalyzer defaultSymbol="BTCUSDT" /> // 指定幣種
//    <CryptoAnalyzer coins={["ZECUSDT","BTCUSDT","ETHUSDT"]} />
// ═══════════════════════════════════════════
import { useState, useMemo } from "react";
import { useMarketData } from "../lib/useMarketData";
import { winRateV3 } from "../lib/indicators";

// ── 預設幣種列表 ──
const DEFAULT_COINS = [
  { symbol: "ZECUSDT", label: "ZEC", name: "Zcash" },
  { symbol: "BTCUSDT", label: "BTC", name: "Bitcoin" },
  { symbol: "ETHUSDT", label: "ETH", name: "Ethereum" },
  { symbol: "SOLUSDT", label: "SOL", name: "Solana" },
  { symbol: "DOGEUSDT", label: "DOGE", name: "Dogecoin" },
  { symbol: "XRPUSDT", label: "XRP", name: "Ripple" },
  { symbol: "AVAXUSDT", label: "AVAX", name: "Avalanche" },
  { symbol: "LINKUSDT", label: "LINK", name: "Chainlink" },
];

// ── 色彩系統 ──
const C = {
  g: "#00e676", r: "#ff5252", y: "#ffd740", b: "#448aff", p: "#b388ff", c: "#18ffff",
  bg: "#060910", card: "rgba(255,255,255,0.025)", brd: "rgba(255,255,255,0.06)",
  dim: "rgba(255,255,255,0.3)", mid: "rgba(255,255,255,0.55)",
};
const MONO = "'JetBrains Mono','SF Mono','Fira Code',monospace";

// ── UI 子元件 ──
function Gauge({ value, label, color }) {
  const r = 52, circ = Math.PI * r, off = circ - (value / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={124} height={70} viewBox="0 0 124 70">
        <path d="M 10 62 A 52 52 0 0 1 114 62" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" strokeLinecap="round" />
        <path d="M 10 62 A 52 52 0 0 1 114 62" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 0.8s", filter: `drop-shadow(0 0 6px ${color}40)` }} />
        <text x="62" y="52" textAnchor="middle" fill="white" fontSize="22" fontWeight="800" fontFamily={MONO}>{value}%</text>
      </svg>
      <span style={{ fontSize: 10, color: C.mid, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

function Badge({ label, value, sig }) {
  const colors = { bullish: C.g, bearish: C.r, neutral: C.y, in_cloud: C.p, rising: C.g, falling: C.r };
  const c = colors[sig] || C.y;
  return (
    <div style={{ background: `${c}0d`, border: `1px solid ${c}20`, borderRadius: 7, padding: "6px 10px", display: "inline-flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: MONO }}>{value}</span>
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}

function STitle({ children, icon }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>{icon && <span style={{ fontSize: 13 }}>{icon}</span>}{children}</div>;
}

function MiniBar({ label, value, max, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
      <span style={{ width: 28, fontSize: 9, color: C.dim, textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min((value / max) * 100, 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
      </div>
      <span style={{ width: 38, fontSize: 9, fontFamily: MONO, color, textAlign: "right" }}>{typeof value === "number" ? value.toFixed(1) : value}</span>
    </div>
  );
}

function Spark({ data, w = 140, h = 38, color = C.g }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 4 - ((v - mn) / rng) * (h - 8)}`).join(" ");
  return (
    <svg width={w} height={h}>
      <defs><linearGradient id={`spk-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.2" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#spk-${color.replace('#', '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ═══════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════
export default function CryptoAnalyzer({
  defaultSymbol = "ZECUSDT",
  coins = DEFAULT_COINS,
  refreshInterval = 30000,
  onSymbolChange,
}) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [tf, setTf] = useState("4h");
  const [page, setPage] = useState("overview");
  const [entry, setEntry] = useState("");
  const [customSymbol, setCustomSymbol] = useState("");

  const { loading, loadMsg, data, apiStatus } = useMarketData(symbol, tf, refreshInterval);
  const coinInfo = coins.find((c) => c.symbol === symbol) || { symbol, label: symbol.replace("USDT", ""), name: symbol };

  const handleSymbolChange = (s) => {
    setSymbol(s);
    setEntry("");
    setPage("overview");
    onSymbolChange?.(s);
  };

  const handleCustomAdd = () => {
    const s = customSymbol.toUpperCase().trim();
    if (s && s.endsWith("USDT")) {
      handleSymbolChange(s);
      setCustomSymbol("");
    }
  };

  const eP = entry ? +entry : data?.price;
  const wr = data ? winRateV3(eP, data.price, data.ind, tf) : null;
  const sig = (v, lo, hi) => v === null ? "neutral" : v < lo ? "bullish" : v > hi ? "bearish" : "neutral";

  // Suggested entries
  const entries = useMemo(() => {
    if (!data) return [];
    const p = data.price, ind = data.ind, list = [];
    if (ind.bb) { list.push({ p: ind.bb.lower, l: "布林下軌", t: "long" }); list.push({ p: ind.bb.upper, l: "布林上軌", t: "short" }); }
    if (ind.ema50) list.push({ p: ind.ema50, l: "EMA50", t: ind.ema50 < p ? "long" : "short" });
    if (ind.ema200) list.push({ p: ind.ema200, l: "EMA200", t: "long" });
    if (ind.vwap) { list.push({ p: ind.vwap.vwap, l: "VWAP", t: ind.vwap.vwap < p ? "long" : "short" }); list.push({ p: ind.vwap.lower1, l: "VWAP-1σ", t: "long" }); }
    if (ind.vpvr) { list.push({ p: ind.vpvr.val, l: "VAL", t: "long" }); list.push({ p: ind.vpvr.vah, l: "VAH", t: "short" }); }
    if (ind.ichi) list.push({ p: ind.ichi.kijun, l: "基準線", t: ind.ichi.kijun < p ? "long" : "short" });
    if (ind.harm?.length) list.push({ p: ind.harm[0].prz, l: `${ind.harm[0].name} PRZ`, t: ind.harm[0].type === "bullish" ? "long" : "short" });
    const sup = ind.levels?.filter((l) => l.type === "support" && l.price < p).sort((a, b) => b.price - a.price);
    const res = ind.levels?.filter((l) => l.type === "resistance" && l.price > p).sort((a, b) => a.price - b.price);
    if (sup?.[0]) list.push({ p: sup[0].price, l: "支撐", t: "long" });
    if (res?.[0]) list.push({ p: res[0].price, l: "壓力", t: "short" });
    return list.filter((e) => e.p > 0 && isFinite(e.p)).sort((a, b) => a.p - b.p);
  }, [data]);

  const pages = [
    { id: "overview", icon: "📊", label: "總覽" },
    { id: "technical", icon: "📈", label: "技術面" },
    { id: "patterns", icon: "🦋", label: "形態" },
    { id: "volume", icon: "📦", label: "量價" },
    { id: "sentiment", icon: "🧠", label: "籌碼" },
  ];

  // ── Loading ──
  if (loading) return (
    <div style={{ background: C.bg, padding: 40, textAlign: "center", borderRadius: 16 }}>
      <div style={{ fontSize: 28, marginBottom: 10, animation: "spin 1s linear infinite" }}>⛏️</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.mid }}>{loadMsg}</div>
      <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>{symbol}</div>
      <style>{`@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!data) return (
    <div style={{ background: C.bg, padding: 40, textAlign: "center", borderRadius: 16 }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, color: C.r, marginBottom: 12 }}>{loadMsg}</div>
    </div>
  );

  const { price, chg, vol, hi24, lo24, ind, liq, sparkline, multiRsi, funding, fundHist, lsRatio, lsHist, oiHist, oiTrend } = data;

  return (
    <div style={{ background: C.bg, color: "white", borderRadius: 16, overflow: "hidden" }}>
      {/* ── COIN SELECTOR ── */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.brd}`, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {coins.map((c) => (
          <button key={c.symbol} onClick={() => handleSymbolChange(c.symbol)} style={{
            background: symbol === c.symbol ? `${C.b}25` : "rgba(255,255,255,0.04)",
            border: `1px solid ${symbol === c.symbol ? `${C.b}50` : C.brd}`,
            borderRadius: 6, padding: "4px 10px", cursor: "pointer", transition: "all 0.15s",
            color: symbol === c.symbol ? C.b : C.dim, fontSize: 11, fontWeight: 700, fontFamily: MONO,
          }}>
            {c.label}
          </button>
        ))}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          <input value={customSymbol} onChange={(e) => setCustomSymbol(e.target.value)} placeholder="自訂 XXXUSDT"
            onKeyDown={(e) => e.key === "Enter" && handleCustomAdd()}
            style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.brd}`, borderRadius: 6, padding: "4px 8px", color: "white", fontSize: 10, fontFamily: MONO, outline: "none", width: 110 }} />
          <button onClick={handleCustomAdd} style={{ background: `${C.g}20`, border: `1px solid ${C.g}30`, borderRadius: 6, padding: "4px 8px", color: C.g, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>+</button>
        </div>
      </div>

      {/* ── HEADER ── */}
      <div style={{ padding: "12px 16px 0", borderBottom: `1px solid ${C.brd}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 9, background: `${C.y}20`, color: C.y, padding: "1px 6px", borderRadius: 3, fontWeight: 700, letterSpacing: 1.5 }}>{coinInfo.label}/USDT</span>
              <span style={{ fontSize: 9, color: C.dim }}>{coinInfo.name}</span>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.g, display: "inline-block" }} />
              <span style={{ fontSize: 9, color: apiStatus.spot ? C.g : C.r }}>● Spot</span>
              <span style={{ fontSize: 9, color: apiStatus.futures ? C.g : C.r }}>● Futures</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 900, fontFamily: MONO, letterSpacing: -1 }}>${price.toFixed(price < 1 ? 6 : price < 100 ? 4 : 2)}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: chg >= 0 ? C.g : C.r }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: C.dim, marginTop: 3, flexWrap: "wrap" }}>
              <span>H <b style={{ color: C.mid }}>${hi24.toFixed(2)}</b></span>
              <span>L <b style={{ color: C.mid }}>${lo24.toFixed(2)}</b></span>
              <span>Vol <b style={{ color: C.mid }}>${(vol / 1e6).toFixed(1)}M</b></span>
              {funding !== null && <span>費率 <b style={{ color: funding > .005 ? C.r : funding < -.005 ? C.g : C.y }}>{(funding * 100).toFixed(4)}%</b></span>}
              {lsRatio !== null && <span>多空比 <b style={{ color: lsRatio > 1.5 ? C.r : lsRatio < .8 ? C.g : C.y }}>{lsRatio.toFixed(2)}</b></span>}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <Spark data={sparkline} color={chg >= 0 ? C.g : C.r} />
            <div style={{ fontSize: 8, color: C.dim, marginTop: 2 }}>{data.lastUpdate?.toLocaleTimeString("zh-TW")} · 30s</div>
          </div>
        </div>

        {/* NAV */}
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {pages.map((pg) => (
            <button key={pg.id} onClick={() => setPage(pg.id)} style={{
              background: page === pg.id ? "rgba(255,255,255,0.06)" : "transparent",
              border: "none", borderBottom: `2px solid ${page === pg.id ? C.b : "transparent"}`,
              padding: "8px 12px", color: page === pg.id ? "white" : C.dim,
              fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>
              {pg.icon} {pg.label}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, paddingRight: 4 }}>
            {["1h", "4h", "1d"].map((t) => (
              <button key={t} onClick={() => setTf(t)} style={{
                background: tf === t ? `${C.b}25` : "transparent",
                border: `1px solid ${tf === t ? `${C.b}50` : "transparent"}`,
                borderRadius: 4, padding: "3px 8px", color: tf === t ? C.b : C.dim,
                fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
              }}>{t.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ padding: 16 }}>

        {/* OVERVIEW */}
        {page === "overview" && (<>
          <Card style={{ marginBottom: 16 }}>
            <STitle icon="🎯">多空勝率 v3 — 14 指標</STitle>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>進場價:</span>
                  <input type="number" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder={price.toFixed(2)}
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.brd}`, borderRadius: 7, padding: "7px 11px", color: "white", fontSize: 14, fontFamily: MONO, outline: "none", width: 130 }} />
                </div>
                <div style={{ display: "flex", gap: 24 }}>
                  <Gauge value={wr?.long || 50} label="做多" color={C.g} />
                  <Gauge value={wr?.short || 50} label="做空" color={C.r} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{
                  background: wr?.long > wr?.short ? `${C.g}08` : `${C.r}08`,
                  border: `1px solid ${wr?.long > wr?.short ? `${C.g}18` : `${C.r}18`}`,
                  borderRadius: 10, padding: 14,
                }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: wr?.long > 55 ? C.g : wr?.short > 55 ? C.r : C.y, marginBottom: 4 }}>
                    {wr?.long > 55 ? "📈 偏多" : wr?.short > 55 ? "📉 偏空" : "⚖️ 震盪"}
                    <span style={{ fontSize: 11, fontWeight: 500, color: C.mid, marginLeft: 8 }}>@ ${eP?.toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.mid, lineHeight: 1.7 }}>
                    {wr?.long > 60 ? "多重指標共振偏多" : wr?.short > 60 ? "多重指標共振偏空" : "多空分歧，建議觀望"}
                  </div>
                  <div style={{ fontSize: 8, color: C.dim, marginTop: 6 }}>
                    {tf === "1h" ? "短線模式" : tf === "1d" ? "波段模式" : "均衡模式"}
                    {!apiStatus.futures && " · ⚠️ 合約數據未載入"}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Quick Signals */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(85px, 1fr))", gap: 6, marginBottom: 16 }}>
            <Badge label="RSI" value={ind.rsi?.toFixed(1) || "—"} sig={sig(ind.rsi, 40, 60)} />
            <Badge label="MACD" value={ind.macd?.histogram?.toFixed(3) || "—"} sig={ind.macd?.histogram > 0 ? "bullish" : "bearish"} />
            <Badge label="ADX" value={ind.adx?.adx?.toFixed(1) || "—"} sig={ind.adx?.adx > 25 ? (ind.adx.pdi > ind.adx.mdi ? "bullish" : "bearish") : "neutral"} />
            <Badge label="雲帶" value={ind.ichi ? ({ bullish: "多", bearish: "空", in_cloud: "雲中", neutral: "中" }[ind.ichi.signal]) : "—"} sig={ind.ichi?.signal || "neutral"} />
            <Badge label="OBV" value={ind.obv?.divergence !== "none" ? (ind.obv.divergence === "bullish" ? "多背離" : "空背離") : (ind.obv?.trend === "rising" ? "上升" : "下降")} sig={ind.obv?.divergence === "bullish" ? "bullish" : ind.obv?.divergence === "bearish" ? "bearish" : ind.obv?.trend === "rising" ? "bullish" : "bearish"} />
            <Badge label="背離" value={ind.divs?.length > 0 ? `${ind.divs[0].type === "bullish" ? "多" : "空"}${ind.divs[0].indicator}` : "無"} sig={ind.divs?.length > 0 ? ind.divs[0].type : "neutral"} />
            <Badge label="VWAP" value={ind.vwap ? `$${ind.vwap.vwap.toFixed(0)}` : "—"} sig={price > (ind.vwap?.vwap || 0) ? "bullish" : "bearish"} />
            <Badge label="OI" value={oiTrend === "rising" ? "增倉" : oiTrend === "falling" ? "減倉" : "—"} sig={oiTrend === "rising" ? "bullish" : "neutral"} />
          </div>

          {/* Entries */}
          <Card>
            <STitle icon="🎯">建議進場點位</STitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 5 }}>
              {entries.map((e, i) => {
                const w = winRateV3(e.p, price, ind, tf);
                const wv = e.t === "long" ? w.long : e.t === "short" ? w.short : Math.max(w.long, w.short);
                const diff = ((e.p - price) / price * 100);
                const tc = e.t === "long" ? C.g : e.t === "short" ? C.r : C.y;
                return (
                  <div key={i} onClick={() => setEntry(String(e.p.toFixed(2)))} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                    background: `${tc}06`, border: `1px solid ${tc}10`,
                  }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: MONO }}>${e.p.toFixed(2)}</span>
                      <span style={{ fontSize: 9, color: C.dim, marginLeft: 6 }}>{e.l}</span>
                      <span style={{ fontSize: 9, color: C.dim, marginLeft: 3 }}>({diff >= 0 ? "+" : ""}{diff.toFixed(1)}%)</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, fontFamily: MONO, color: tc }}>
                      {e.t === "long" ? "多" : e.t === "short" ? "空" : "中"} {wv}%
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>)}

        {/* TECHNICAL */}
        {page === "technical" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            <Card>
              <STitle icon="📉">RSI + 背離</STitle>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <Badge label="RSI" value={ind.rsi?.toFixed(1) || "—"} sig={sig(ind.rsi, 40, 60)} />
                <Badge label="狀態" value={ind.rsi < 30 ? "超賣" : ind.rsi > 70 ? "超買" : ind.rsi < 40 ? "偏低" : ind.rsi > 60 ? "偏高" : "中性"} sig={sig(ind.rsi, 40, 60)} />
              </div>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 6 }}>多週期 RSI</div>
              {[{ l: "1H", v: multiRsi.h1 }, { l: "4H", v: multiRsi.h4 }, { l: "1D", v: multiRsi.d1 }].map((r) => (
                <MiniBar key={r.l} label={r.l} value={r.v || 50} max={100} color={r.v < 40 ? C.g : r.v > 60 ? C.r : C.y} />
              ))}
              <div style={{ marginTop: 10, fontSize: 10, color: C.dim }}>背離偵測</div>
              {(!ind.divs || ind.divs.length === 0) ? <div style={{ fontSize: 11, color: C.dim, padding: 6 }}>🔍 無背離</div> :
                ind.divs.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 5, marginTop: 3, background: d.type === "bullish" ? `${C.g}08` : `${C.r}08` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: d.type === "bullish" ? C.g : C.r }}>{d.type === "bullish" ? "📈多方" : "📉空方"}</span>
                    <span style={{ fontSize: 10, color: C.dim }}>{d.indicator} ${d.price.toFixed(2)}</span>
                  </div>
                ))}
            </Card>
            <Card><STitle icon="〰️">MACD</STitle><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Badge label="MACD" value={ind.macd?.macd?.toFixed(3) || "—"} sig={ind.macd?.macd > 0 ? "bullish" : "bearish"} /><Badge label="信號" value={ind.macd?.signal?.toFixed(3) || "—"} sig="neutral" /><Badge label="柱" value={ind.macd?.histogram?.toFixed(3) || "—"} sig={ind.macd?.histogram > 0 ? "bullish" : "bearish"} /></div></Card>
            <Card><STitle icon="💪">ADX</STitle><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}><Badge label="ADX" value={ind.adx?.adx?.toFixed(1) || "—"} sig={ind.adx?.adx > 25 ? (ind.adx.pdi > ind.adx.mdi ? "bullish" : "bearish") : "neutral"} /><Badge label="+DI" value={ind.adx?.pdi?.toFixed(1) || "—"} sig="bullish" /><Badge label="-DI" value={ind.adx?.mdi?.toFixed(1) || "—"} sig="bearish" /></div><MiniBar label="ADX" value={ind.adx?.adx || 0} max={60} color={ind.adx?.adx > 25 ? C.b : C.y} /><MiniBar label="+DI" value={ind.adx?.pdi || 0} max={50} color={C.g} /><MiniBar label="-DI" value={ind.adx?.mdi || 0} max={50} color={C.r} /></Card>
            <Card><STitle icon="📊">OBV</STitle><div style={{ display: "flex", gap: 6, marginBottom: 10 }}><Badge label="趨勢" value={ind.obv?.trend === "rising" ? "上升" : "下降"} sig={ind.obv?.trend || "neutral"} /><Badge label="背離" value={ind.obv?.divergence === "none" ? "無" : ind.obv?.divergence} sig={ind.obv?.divergence === "bullish" ? "bullish" : ind.obv?.divergence === "bearish" ? "bearish" : "neutral"} /></div>{ind.obv && <Spark data={ind.obv.series} color={ind.obv.trend === "rising" ? C.g : C.r} w={260} h={45} />}</Card>
            <Card><STitle icon="⚓">VWAP</STitle><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Badge label="VWAP" value={ind.vwap ? `$${ind.vwap.vwap.toFixed(2)}` : "—"} sig={price > (ind.vwap?.vwap || 0) ? "bullish" : "bearish"} /><Badge label="+1σ" value={ind.vwap ? `$${ind.vwap.upper1.toFixed(2)}` : "—"} sig="bearish" /><Badge label="-1σ" value={ind.vwap ? `$${ind.vwap.lower1.toFixed(2)}` : "—"} sig="bullish" /></div></Card>
            <Card><STitle icon="🎛️">布林帶 + 均線</STitle><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}><Badge label="BB上" value={ind.bb ? `$${ind.bb.upper.toFixed(1)}` : "—"} sig="bearish" /><Badge label="BB中" value={ind.bb ? `$${ind.bb.middle.toFixed(1)}` : "—"} sig="neutral" /><Badge label="BB下" value={ind.bb ? `$${ind.bb.lower.toFixed(1)}` : "—"} sig="bullish" /><Badge label="EMA20" value={ind.ema20 ? `$${ind.ema20.toFixed(1)}` : "—"} sig={price > (ind.ema20 || 0) ? "bullish" : "bearish"} /><Badge label="EMA50" value={ind.ema50 ? `$${ind.ema50.toFixed(1)}` : "—"} sig={price > (ind.ema50 || 0) ? "bullish" : "bearish"} /><Badge label="EMA200" value={ind.ema200 ? `$${ind.ema200.toFixed(1)}` : "—"} sig={price > (ind.ema200 || 0) ? "bullish" : "bearish"} /><Badge label="ATR" value={ind.atr?.toFixed(2) || "—"} sig="neutral" /></div></Card>
          </div>
        )}

        {/* PATTERNS */}
        {page === "patterns" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
            <Card>
              <STitle icon="🦋">諧波形態</STitle>
              {(!ind.harm || ind.harm.length === 0) ? <div style={{ padding: 20, textAlign: "center" }}><div style={{ fontSize: 28 }}>🔍</div><div style={{ fontSize: 13, color: C.mid, marginTop: 6 }}>未偵測到諧波</div></div> :
                ind.harm.map((h, i) => {
                  const hc = h.type === "bullish" ? C.g : C.r;
                  return (
                    <div key={i} style={{ background: `${hc}08`, border: `1px solid ${hc}18`, borderRadius: 10, padding: 14, marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: hc }}>{h.name} {h.type === "bullish" ? "🐂" : "🐻"}</span>
                        <span style={{ fontSize: 12, fontFamily: MONO, color: hc, fontWeight: 700 }}>勝率 {h.wr}%</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, fontSize: 10 }}>
                        {[{ l: "PRZ", v: h.prz, c: "white" }, { l: "TP1", v: h.tp1, c: C.g }, { l: "TP2", v: h.tp2, c: C.g }, { l: "SL", v: h.sl, c: C.r }].map((x) => (
                          <div key={x.l}><span style={{ color: C.dim }}>{x.l}</span><div style={{ fontFamily: MONO, fontWeight: 600, color: x.c }}>${x.v.toFixed(2)}</div></div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </Card>
            <Card>
              <STitle icon="☁️">一目均衡表</STitle>
              {!ind.ichi ? <div style={{ color: C.dim }}>需52根K線</div> : (<>
                <div style={{ background: `${ind.ichi.signal === "bullish" ? C.g : ind.ichi.signal === "bearish" ? C.r : C.p}10`, borderRadius: 8, padding: "8px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{ind.ichi.signal === "bullish" ? "☀️" : ind.ichi.signal === "bearish" ? "🌧️" : "☁️"}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: ind.ichi.signal === "bullish" ? C.g : ind.ichi.signal === "bearish" ? C.r : C.p }}>{ind.ichi.signal === "bullish" ? "多方(雲上)" : ind.ichi.signal === "bearish" ? "空方(雲下)" : "雲中震盪"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  <Badge label="轉換線" value={`$${ind.ichi.tenkan.toFixed(2)}`} sig={ind.ichi.tenkan > ind.ichi.kijun ? "bullish" : "bearish"} />
                  <Badge label="基準線" value={`$${ind.ichi.kijun.toFixed(2)}`} sig="neutral" />
                  <Badge label="雲頂" value={`$${ind.ichi.top.toFixed(2)}`} sig="neutral" />
                  <Badge label="雲底" value={`$${ind.ichi.bot.toFixed(2)}`} sig="neutral" />
                </div>
              </>)}
            </Card>
          </div>
        )}

        {/* VOLUME */}
        {page === "volume" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            <Card>
              <STitle icon="📦">VPVR</STitle>
              {!ind.vpvr ? <div style={{ color: C.dim }}>數據不足</div> :
                <div>{ind.vpvr.profile.slice().reverse().map((lv, i) => {
                  const pct = (lv.vol / ind.vpvr.maxVol) * 100;
                  const isPOC = lv === ind.vpvr.poc;
                  const isCurr = price >= lv.from && price < lv.to;
                  const buyPct = lv.vol > 0 ? (lv.buy / lv.vol) * pct : 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, height: 14 }}>
                      <span style={{ width: 50, fontSize: 8, fontFamily: MONO, textAlign: "right", color: isPOC ? C.y : isCurr ? "white" : C.dim, fontWeight: isPOC || isCurr ? 700 : 400 }}>{isCurr ? "▸" : ""}{lv.mid.toFixed(1)}</span>
                      <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.03)", borderRadius: 2, overflow: "hidden", position: "relative" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${buyPct}%`, background: `${C.g}50` }} />
                        <div style={{ position: "absolute", left: `${buyPct}%`, top: 0, height: "100%", width: `${pct - buyPct}%`, background: `${C.r}50` }} />
                      </div>
                    </div>
                  );
                })}</div>}
            </Card>
            <Card><STitle icon="⚓">VWAP 分佈</STitle>{ind.vwap && [{ l: "+2σ", v: ind.vwap.upper2, c: C.r }, { l: "+1σ", v: ind.vwap.upper1, c: C.r }, { l: "VWAP", v: ind.vwap.vwap, c: C.b }, { l: "-1σ", v: ind.vwap.lower1, c: C.g }, { l: "-2σ", v: ind.vwap.lower2, c: C.g }].map((lv, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px" }}>
                <span style={{ width: 32, fontSize: 10, color: C.dim, textAlign: "right" }}>{lv.l}</span>
                <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 600, color: lv.c }}>${lv.v.toFixed(2)}</span>
                <span style={{ fontSize: 9, color: C.dim }}>({((lv.v - price) / price * 100).toFixed(1)}%)</span>
              </div>
            ))}</Card>
            <Card><STitle icon="📊">OBV</STitle>{ind.obv && <Spark data={ind.obv.series} color={ind.obv.trend === "rising" ? C.g : C.r} w={260} h={55} />}<div style={{ display: "flex", gap: 6, marginTop: 8 }}><Badge label="趨勢" value={ind.obv?.trend === "rising" ? "上升" : "下降"} sig={ind.obv?.trend || "neutral"} /><Badge label="背離" value={ind.obv?.divergence === "none" ? "無" : ind.obv?.divergence} sig={ind.obv?.divergence === "bullish" ? "bullish" : ind.obv?.divergence === "bearish" ? "bearish" : "neutral"} /></div></Card>
          </div>
        )}

        {/* SENTIMENT */}
        {page === "sentiment" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            {!apiStatus.futures && <Card style={{ gridColumn: "1/-1" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 18 }}>⚠️</span><div><div style={{ fontSize: 13, fontWeight: 700, color: C.y }}>Futures API 未連接</div><div style={{ fontSize: 11, color: C.dim }}>合約數據因 CORS 限制無法取得</div></div></div></Card>}
            <Card><STitle icon="💰">資金費率</STitle><div style={{ textAlign: "center" }}><div style={{ fontSize: 28, fontWeight: 900, fontFamily: MONO, color: funding !== null ? (funding > .005 ? C.r : funding < -.005 ? C.g : C.y) : C.dim }}>{funding !== null ? `${(funding * 100).toFixed(4)}%` : "N/A"}</div></div>{fundHist.length > 1 && <Spark data={fundHist.map((f) => f * 100)} color={funding > 0 ? C.r : C.g} w={260} h={35} />}</Card>
            <Card><STitle icon="⚖️">多空帳戶比</STitle><div style={{ textAlign: "center" }}><div style={{ fontSize: 28, fontWeight: 900, fontFamily: MONO, color: lsRatio !== null ? (lsRatio > 1.5 ? C.r : lsRatio < .8 ? C.g : C.y) : C.dim }}>{lsRatio !== null ? lsRatio.toFixed(3) : "N/A"}</div></div>{lsHist.length > 1 && <Spark data={lsHist} color={lsRatio > 1 ? C.r : C.g} w={260} h={35} />}</Card>
            <Card><STitle icon="📈">未平倉量</STitle><div style={{ display: "flex", gap: 6, marginBottom: 10 }}><Badge label="趨勢" value={oiTrend === "rising" ? "增倉" : oiTrend === "falling" ? "減倉" : "—"} sig={oiTrend === "rising" ? "bullish" : "neutral"} /></div>{oiHist.length > 1 && <Spark data={oiHist.map((o) => o.v)} color={C.c} w={260} h={45} />}</Card>
            <Card>
              <STitle icon="💥">清算估算</STitle>
              {liq.map((l, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, fontSize: 10 }}>
                  <span style={{ width: 32, textAlign: "right", color: C.mid, fontFamily: MONO, fontWeight: 700 }}>{l.leverage}x</span>
                  <span style={{ width: 60, fontFamily: MONO, color: C.r, fontSize: 9 }}>${l.longLiq.toFixed(0)}</span>
                  <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.03)", borderRadius: 3, position: "relative" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.15)" }} />
                  </div>
                  <span style={{ width: 60, fontFamily: MONO, color: C.g, fontSize: 9, textAlign: "right" }}>${l.shortLiq.toFixed(0)}</span>
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", padding: 12, fontSize: 9, color: "rgba(255,255,255,0.12)" }}>
        Crypto Analyzer v3 · 14指標 · Binance API · {refreshInterval / 1000}s 刷新 · ⚠️ 僅供參考
      </div>
    </div>
  );
}
