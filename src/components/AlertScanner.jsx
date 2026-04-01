import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getQualifiedCoins,
  rateLimitedScan,
  shouldAlert,
  markAlerted,
  sendTelegram,
  formatAlertMessage,
} from "../lib/alertEngine";

const C = {
  g: "#00e676",
  r: "#ff5252",
  y: "#ffd740",
  b: "#448aff",
  bg: "#060910",
  card: "rgba(255,255,255,0.025)",
  brd: "rgba(255,255,255,0.06)",
  dim: "rgba(255,255,255,0.3)",
  mid: "rgba(255,255,255,0.55)",
  txt: "rgba(255,255,255,0.87)",
};

const LS_KEYS = {
  token: "alert_telegram_token",
  chatId: "alert_chat_id",
  threshold: "alert_threshold",
  volume: "alert_volume_min",
  timeframe: "alert_timeframe",
  interval: "alert_interval",
};

function ls(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(0) + "M";
  return (v / 1e3).toFixed(0) + "K";
}

function fmtTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function fmtCountdown(ms) {
  if (ms <= 0) return "0:00";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AlertScanner() {
  const navigate = useNavigate();

  const [token, setToken] = useState(() => ls(LS_KEYS.token, ""));
  const [chatId, setChatId] = useState(() => ls(LS_KEYS.chatId, ""));
  const [threshold, setThreshold] = useState(() => +ls(LS_KEYS.threshold, "70"));
  const [volumeMin, setVolumeMin] = useState(() => +ls(LS_KEYS.volume, "100000000"));
  const [timeframe, setTimeframe] = useState(() => ls(LS_KEYS.timeframe, "4h"));
  const [intervalMin, setIntervalMin] = useState(() => +ls(LS_KEYS.interval, "5"));
  const [showToken, setShowToken] = useState(false);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0, symbol: "" });
  const [qualifiedCount, setQualifiedCount] = useState(0);
  const [lastScan, setLastScan] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [results, setResults] = useState([]);
  const [logs, setLogs] = useState([]);
  const [testMsg, setTestMsg] = useState(null);
  const [sortBy, setSortBy] = useState("long");

  const stopFlag = useRef(false);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);
  const nextScanRef = useRef(0);

  // refs for latest values — avoid stale closures
  const settingsRef = useRef({ token, chatId, threshold, volumeMin, timeframe });
  useEffect(() => { settingsRef.current = { token, chatId, threshold, volumeMin, timeframe }; });

  useEffect(() => { lsSet(LS_KEYS.token, token); }, [token]);
  useEffect(() => { lsSet(LS_KEYS.chatId, chatId); }, [chatId]);
  useEffect(() => { lsSet(LS_KEYS.threshold, String(threshold)); }, [threshold]);
  useEffect(() => { lsSet(LS_KEYS.volume, String(volumeMin)); }, [volumeMin]);
  useEffect(() => { lsSet(LS_KEYS.timeframe, timeframe); }, [timeframe]);
  useEffect(() => { lsSet(LS_KEYS.interval, String(intervalMin)); }, [intervalMin]);

  const handleTest = async () => {
    if (!token || !chatId) {
      setTestMsg({ ok: false, text: "請先填入 Bot Token 和 Chat ID" });
      return;
    }
    setTestMsg({ ok: null, text: "傳送中..." });
    const res = await sendTelegram(token, chatId, "🔔 測試推播成功！勝率推播掃描器已連線。");
    setTestMsg(res.ok ? { ok: true, text: "✅ 傳送成功" } : { ok: false, text: `❌ ${res.error}` });
  };

  const addLog = useCallback((symbol, direction, winRate, price, error) => {
    setLogs((prev) => [
      { ts: Date.now(), symbol, direction, winRate, price, error: error || null },
      ...prev.slice(0, 99),
    ]);
  }, []);

  const runScanRef = useRef(null);
  runScanRef.current = async () => {
    if (stopFlag.current) return;

    const s = settingsRef.current;
    setStatus("scanning");
    setProgress({ current: 0, total: 0, symbol: "載入市場數據..." });

    const coins = await getQualifiedCoins(s.volumeMin);
    setQualifiedCount(coins.length);

    if (coins.length === 0 || stopFlag.current) {
      setStatus("waiting");
      setLastScan(Date.now());
      return;
    }

    setProgress({ current: 0, total: coins.length, symbol: "" });

    const scanResults = await rateLimitedScan(
      coins,
      s.timeframe,
      (cur, tot, result) => {
        setProgress({ current: cur, total: tot, symbol: result?.symbol || "" });
      },
      () => stopFlag.current
    );

    if (stopFlag.current) return;

    setResults(scanResults);
    setLastScan(Date.now());

    // 推播檢查
    const curToken = settingsRef.current.token;
    const curChatId = settingsRef.current.chatId;
    const curThreshold = settingsRef.current.threshold;

    console.log("[AlertScanner] 掃描完成，檢查推播:", {
      hasToken: !!curToken,
      hasChatId: !!curChatId,
      threshold: curThreshold,
      resultCount: scanResults.length,
      topLong: scanResults.length > 0 ? Math.max(...scanResults.map(r => r.winRate.long)) : 0,
      topShort: scanResults.length > 0 ? Math.max(...scanResults.map(r => r.winRate.short)) : 0,
    });

    if (curToken && curChatId) {
      let newAlerts = 0;
      for (const r of scanResults) {
        if (r.error) continue;

        const longHit = r.winRate.long >= curThreshold;
        const shortHit = r.winRate.short >= curThreshold;

        if (longHit || shortHit) {
          console.log("[AlertScanner] 觸發:", r.symbol, "多方:", r.winRate.long, "空方:", r.winRate.short, "門檻:", curThreshold);
        }

        if (longHit && shouldAlert(r.symbol, "long")) {
          const msg = formatAlertMessage(r, "long", r.winRate.long);
          console.log("[AlertScanner] 發送多方推播:", r.symbol);
          const res = await sendTelegram(curToken, curChatId, msg);
          console.log("[AlertScanner] 推播結果:", res);
          if (res.ok) {
            markAlerted(r.symbol, "long");
            newAlerts++;
            addLog(r.symbol, "long", r.winRate.long, r.price);
          } else {
            addLog(r.symbol, "long", r.winRate.long, r.price, res.error);
          }
        }

        if (shortHit && shouldAlert(r.symbol, "short")) {
          const msg = formatAlertMessage(r, "short", r.winRate.short);
          console.log("[AlertScanner] 發送空方推播:", r.symbol);
          const res = await sendTelegram(curToken, curChatId, msg);
          console.log("[AlertScanner] 推播結果:", res);
          if (res.ok) {
            markAlerted(r.symbol, "short");
            newAlerts++;
            addLog(r.symbol, "short", r.winRate.short, r.price);
          } else {
            addLog(r.symbol, "short", r.winRate.short, r.price, res.error);
          }
        }
      }
      if (newAlerts > 0) setTotalAlerts((p) => p + newAlerts);
    } else {
      console.log("[AlertScanner] 跳過推播：Token 或 ChatId 為空");
    }

    setStatus("waiting");
  };

  const handleStart = () => {
    stopFlag.current = false;
    setRunning(true);
    runScanRef.current();
    const ms = intervalMin * 60 * 1000;
    nextScanRef.current = Date.now() + ms;
    timerRef.current = setInterval(() => {
      nextScanRef.current = Date.now() + ms;
      runScanRef.current();
    }, ms);
  };

  const handleStop = () => {
    stopFlag.current = true;
    setRunning(false);
    setStatus("idle");
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  useEffect(() => {
    if (running) {
      countdownRef.current = setInterval(() => {
        const rem = nextScanRef.current - Date.now();
        setCountdown(Math.max(0, rem));
      }, 1000);
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(0);
    }
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [running]);

  useEffect(() => {
    return () => {
      stopFlag.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const sorted = [...results].sort((a, b) =>
    sortBy === "long" ? b.winRate.long - a.winRate.long : b.winRate.short - a.winRate.short
  );

  const card = {
    background: C.card,
    border: `1px solid ${C.brd}`,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  };
  const label = { color: C.dim, fontSize: 12, marginBottom: 4 };
  const input = {
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${C.brd}`,
    borderRadius: 8,
    padding: "8px 12px",
    color: C.txt,
    fontSize: 14,
    width: "100%",
    outline: "none",
  };
  const btn = (bg) => ({
    background: bg,
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  });

  return (
    <div style={{ color: C.txt, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, color: "#fff" }}>
        {"🔔"} 勝率推播掃描器
      </h2>
      <p style={{ color: C.dim, fontSize: 13, marginBottom: 20 }}>
        自動掃描全市場大幣的 14 指標勝率，超過門檻自動發 Telegram 通知
      </p>

      {/* ─── Telegram 設定 ─── */}
      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Telegram 推播設定</div>
        <div style={{ fontSize: 11, color: C.y, background: "rgba(255,215,64,0.08)", padding: "6px 10px", borderRadius: 6, marginBottom: 14 }}>
          Token 存在瀏覽器 localStorage，建議使用專用推播 Bot，不要用有管理權限的 Bot
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={label}>Bot Token</div>
            <div style={{ position: "relative" }}>
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                style={input}
              />
              <button
                onClick={() => setShowToken(!showToken)}
                style={{ position: "absolute", right: 8, top: 6, background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 12 }}
              >
                {showToken ? "隱藏" : "顯示"}
              </button>
            </div>
          </div>
          <div>
            <div style={label}>Chat ID</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="-1001234567890"
                style={{ ...input, flex: 1 }}
              />
              <button onClick={handleTest} style={{ ...btn("rgba(255,255,255,0.1)"), whiteSpace: "nowrap", fontSize: 13, padding: "8px 14px" }}>
                {"📨"} 測試
              </button>
            </div>
            {testMsg && (
              <div style={{ fontSize: 12, marginTop: 4, color: testMsg.ok ? C.g : testMsg.ok === false ? C.r : C.y }}>
                {testMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── 掃描參數 ─── */}
      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>掃描參數</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <div style={label}>勝率門檻</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <input
                type="range" min="55" max="85" value={threshold}
                onChange={(e) => setThreshold(+e.target.value)}
                style={{ flex: 1, accentColor: C.g }}
              />
              <span style={{ color: C.g, fontWeight: 700, fontSize: 18, minWidth: 48, textAlign: "right" }}>{threshold}%</span>
            </div>
            <div style={label}>成交量門檻 (USDT)</div>
            <input
              type="number" value={volumeMin}
              onChange={(e) => setVolumeMin(+e.target.value)}
              style={input}
            />
          </div>
          <div>
            <div style={label}>分析週期</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {["1h", "4h", "1d"].map((tf) => (
                <button key={tf} onClick={() => setTimeframe(tf)}
                  style={{ ...btn(tf === timeframe ? C.b : "rgba(255,255,255,0.06)"), padding: "8px 0", fontSize: 14, flex: 1, opacity: tf === timeframe ? 1 : 0.45 }}>
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={label}>掃描間隔</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 3, 5, 10].map((m) => (
                <button key={m} onClick={() => setIntervalMin(m)}
                  style={{ ...btn(m === intervalMin ? C.b : "rgba(255,255,255,0.06)"), padding: "8px 0", fontSize: 14, flex: 1, opacity: m === intervalMin ? 1 : 0.45 }}>
                  {m}分
                </button>
              ))}
            </div>
          </div>
        </div>

        {!running ? (
          <button onClick={handleStart} style={{ ...btn(C.g), color: "#000", width: "100%", padding: "14px 0", fontSize: 16, borderRadius: 10 }}>
            {"▶"} 啟動掃描
          </button>
        ) : (
          <button onClick={handleStop} style={{ ...btn(C.r), width: "100%", padding: "14px 0", fontSize: 16, borderRadius: 10 }}>
            {"■"} 停止掃描
          </button>
        )}
      </div>

      {/* ─── 掃描狀態 ─── */}
      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16, textAlign: "center" }}>
          <div>
            <div style={label}>狀態</div>
            <div style={{ color: status === "scanning" ? C.y : status === "waiting" ? C.g : C.dim, fontWeight: 600, fontSize: 14 }}>
              {status === "idle" ? "閒置" : status === "scanning" ? `掃描中 (${progress.current}/${progress.total})` : "等待中"}
            </div>
          </div>
          <div>
            <div style={label}>符合條件</div>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: 18 }}>{qualifiedCount}</div>
          </div>
          <div>
            <div style={label}>當前掃描</div>
            <div style={{ color: C.b, fontSize: 13, fontWeight: 500 }}>{progress.symbol || "-"}</div>
          </div>
          <div>
            <div style={label}>上次掃描</div>
            <div style={{ fontSize: 13 }}>{lastScan ? fmtTime(lastScan) : "-"}</div>
          </div>
          <div>
            <div style={label}>下次掃描</div>
            <div style={{ color: C.y, fontSize: 15, fontWeight: 600 }}>
              {running && status === "waiting" ? fmtCountdown(countdown) : "-"}
            </div>
          </div>
          <div>
            <div style={label}>累計推播</div>
            <div style={{ color: C.g, fontWeight: 700, fontSize: 18 }}>{totalAlerts}</div>
          </div>
        </div>

        {status === "scanning" && progress.total > 0 && (
          <div style={{ marginTop: 12, background: "rgba(255,255,255,0.05)", borderRadius: 4, height: 6, overflow: "hidden" }}>
            <div
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${C.b}, ${C.g})`,
                borderRadius: 4,
                transition: "width 0.3s",
              }}
            />
          </div>
        )}
      </div>

      {/* ─── 掃描結果 ─── */}
      {results.length > 0 && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {"📊"} 掃描結果 ({results.length} 個幣種)
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setSortBy("long")}
                style={{
                  ...btn(sortBy === "long" ? C.g : "rgba(255,255,255,0.05)"),
                  padding: "4px 12px",
                  fontSize: 12,
                  color: sortBy === "long" ? "#000" : C.dim,
                }}
              >
                按多方排序
              </button>
              <button
                onClick={() => setSortBy("short")}
                style={{
                  ...btn(sortBy === "short" ? C.r : "rgba(255,255,255,0.05)"),
                  padding: "4px 12px",
                  fontSize: 12,
                  color: sortBy === "short" ? "#fff" : C.dim,
                }}
              >
                按空方排序
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.brd}` }}>
                  {["幣種", "價格", "24h", "成交量", "多方勝率", "空方勝率", "狀態"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 6px", color: C.dim, fontWeight: 500 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const longHit = r.winRate.long >= threshold;
                  const shortHit = r.winRate.short >= threshold;
                  const rowBg = longHit
                    ? "rgba(0,230,118,0.06)"
                    : shortHit
                    ? "rgba(255,82,82,0.06)"
                    : "transparent";

                  return (
                    <tr key={r.symbol} style={{ borderBottom: `1px solid ${C.brd}`, background: rowBg }}>
                      <td style={{ padding: "8px 6px" }}>
                        <button
                          onClick={() => navigate(`/analyzer?symbol=${r.symbol}`)}
                          style={{ background: "none", border: "none", color: C.b, cursor: "pointer", fontWeight: 600, fontSize: 13, textDecoration: "underline" }}
                        >
                          {r.symbol.replace("USDT", "")}
                        </button>
                      </td>
                      <td style={{ padding: "8px 6px", color: "#fff" }}>${r.price}</td>
                      <td style={{ padding: "8px 6px", color: r.change >= 0 ? C.g : C.r }}>
                        {r.change >= 0 ? "+" : ""}
                        {r.change.toFixed(2)}%
                      </td>
                      <td style={{ padding: "8px 6px", color: C.mid }}>{fmtVol(r.volume)}</td>
                      <td
                        style={{
                          padding: "8px 6px",
                          color: longHit ? "#000" : r.winRate.long >= 60 ? C.g : C.mid,
                          fontWeight: longHit ? 700 : 400,
                          background: longHit ? C.g : "transparent",
                          borderRadius: longHit ? 4 : 0,
                        }}
                      >
                        {r.winRate.long}%
                      </td>
                      <td
                        style={{
                          padding: "8px 6px",
                          color: shortHit ? "#fff" : r.winRate.short >= 60 ? C.r : C.mid,
                          fontWeight: shortHit ? 700 : 400,
                          background: shortHit ? C.r : "transparent",
                          borderRadius: shortHit ? 4 : 0,
                        }}
                      >
                        {r.winRate.short}%
                      </td>
                      <td style={{ padding: "8px 6px", fontSize: 12 }}>
                        {longHit && (
                          <span style={{ color: C.g, marginRight: 4 }}>{"🟢"}多</span>
                        )}
                        {shortHit && (
                          <span style={{ color: C.r }}>{"🔴"}空</span>
                        )}
                        {!longHit && !shortHit && (
                          <span style={{ color: C.dim }}>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 推播歷史 ─── */}
      {logs.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>
            {"📝"} 推播歷史
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {logs.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "6px 0",
                  borderBottom: `1px solid ${C.brd}`,
                  fontSize: 13,
                }}
              >
                <span style={{ color: C.dim, minWidth: 70 }}>{fmtTime(l.ts)}</span>
                <span style={{ color: l.direction === "long" ? C.g : C.r, fontWeight: 600, minWidth: 40 }}>
                  {l.direction === "long" ? "🟢多" : "🔴空"}
                </span>
                <span style={{ color: C.b, fontWeight: 600, minWidth: 80 }}>{l.symbol}</span>
                <span style={{ color: "#fff" }}>勝率 {l.winRate}%</span>
                <span style={{ color: C.mid }}>${l.price}</span>
                {l.error && <span style={{ color: C.r, fontSize: 11 }}>❌ {l.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
