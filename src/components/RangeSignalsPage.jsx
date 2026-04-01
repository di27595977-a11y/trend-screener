import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRangeSignals, triggerRangeScan, updateRangeConfig, testRangeTelegram } from '../services/binanceApi';

function SignalCard({ signal, onSelect }) {
  const isLong = signal.signalSide === 'long';
  const sideLabel = isLong ? '▲ 做多' : '▼ 做空';
  const sideTone = isLong ? 'text-emerald-300' : 'text-rose-300';
  const sideBorder = isLong ? 'border-emerald-400/20' : 'border-rose-400/20';
  const levelType = signal.targetLevel.type === 'resistance' ? '壓力' : '支撐';

  return (
    <button
      type="button"
      onClick={() => onSelect?.(signal.symbol)}
      className={`w-full rounded-[20px] border ${sideBorder} bg-white/[0.03] px-5 py-4 text-left transition hover:bg-white/[0.06] active:scale-[0.995]`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-lg font-bold ${sideTone}`}>{sideLabel}</span>
          <span className="font-mono text-lg font-semibold text-white">{signal.symbol}</span>
          {signal.has4hConfirm && (
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-300">4H 確認</span>
          )}
        </div>
        <div className="text-right">
          <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-sm font-bold text-white">{signal.score} 分</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">{levelType}位</p>
          <p className="mt-1 font-mono text-sm text-white">{signal.targetLevel.price.toPrecision(6)}</p>
          <p className="text-[11px] text-slate-400">×{signal.targetLevel.touches} 觸及</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">現價</p>
          <p className="mt-1 font-mono text-sm text-white">{signal.currentPrice.toPrecision(6)}</p>
          <p className="text-[11px] text-slate-400">距離 {signal.proximity.toFixed(3)}%</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">RSI (14)</p>
          <p className={`mt-1 font-mono text-sm ${signal.rsi > 65 ? 'text-rose-300' : signal.rsi < 35 ? 'text-emerald-300' : 'text-white'}`}>
            {signal.rsi}
          </p>
          <p className="text-[11px] text-slate-400">
            {signal.rsi > 65 ? '超買' : signal.rsi < 35 ? '超賣' : '中性'}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">量比 / BB寬</p>
          <p className="mt-1 font-mono text-sm text-white">{signal.volumeRatio}x</p>
          <p className="text-[11px] text-slate-400">BB {signal.bbWidth ?? '—'}%</p>
        </div>
      </div>

      {signal.nearestSupport && signal.nearestResistance && (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <span>區間：</span>
          <span className="font-mono text-emerald-300/70">支撐 {signal.nearestSupport.price.toPrecision(6)}</span>
          <span>~</span>
          <span className="font-mono text-rose-300/70">壓力 {signal.nearestResistance.price.toPrecision(6)}</span>
          <span className="text-slate-500">
            (寬 {(((signal.nearestResistance.price - signal.nearestSupport.price) / signal.currentPrice) * 100).toFixed(2)}%)
          </span>
        </div>
      )}
    </button>
  );
}

export default function RangeSignalsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState({ signals: [], lastScanAt: null, config: {}, telegramConfigured: false });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState({});
  const [telegramMsg, setTelegramMsg] = useState('');

  const load = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const result = await getRangeSignals();
      setData(result);
      setConfigDraft(result.config || {});
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), 60_000);
    return () => clearInterval(timer);
  }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      await triggerRangeScan();
      await new Promise((r) => setTimeout(r, 3000));
      await load(false);
    } catch { /* silent */ }
    setScanning(false);
  };

  const handleSaveConfig = async () => {
    try {
      const updated = await updateRangeConfig(configDraft);
      setConfigDraft(updated);
      setData((prev) => ({ ...prev, config: updated }));
    } catch { /* silent */ }
  };

  const handleTestTelegram = async () => {
    setTelegramMsg('發送中...');
    try {
      const result = await testRangeTelegram();
      setTelegramMsg(result.ok ? '✅ 發送成功' : `❌ ${result.error}`);
    } catch (err) {
      setTelegramMsg(`❌ ${err.message}`);
    }
  };

  const { signals } = data;
  const longSignals = signals.filter((s) => s.signalSide === 'long');
  const shortSignals = signals.filter((s) => s.signalSide === 'short');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="panel rounded-[28px] px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-300/75">區間偵測</p>
            <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">S/R 壓力支撐震盪訊號</h2>
            <p className="mt-2 text-sm text-slate-300">
              掃描前 80 大市值幣，當價格觸及 1H K 線壓力/支撐位時產生訊號，4H 作為輔助確認。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowConfig(!showConfig)}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
            >
              設定
            </button>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-400/20 disabled:opacity-50"
            >
              {scanning ? '掃描中...' : '立即掃描'}
            </button>
          </div>
        </div>

        {data.lastScanAt && (
          <p className="mt-3 text-xs text-slate-500">
            上次掃描：{new Date(data.lastScanAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
            {' · '}{signals.length} 個訊號
            {data.telegramConfigured ? ' · Telegram ✓' : ''}
          </p>
        )}
      </div>

      {/* Config Panel */}
      {showConfig && (
        <div className="panel rounded-[28px] px-6 py-5">
          <h3 className="mb-4 text-sm font-semibold text-white">偵測參數</h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-2 flex items-center justify-between text-xs text-slate-300">
                <span>觸發距離</span>
                <span className="font-mono text-white">{configDraft.proximityPct ?? 0.3}%</span>
              </label>
              <input
                type="range" min="0.1" max="1.0" step="0.05"
                value={configDraft.proximityPct ?? 0.3}
                onChange={(e) => setConfigDraft((c) => ({ ...c, proximityPct: Number(e.target.value) }))}
                className="w-full accent-amber-400"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center justify-between text-xs text-slate-300">
                <span>最少觸及次數</span>
                <span className="font-mono text-white">{configDraft.minTouches ?? 2}</span>
              </label>
              <input
                type="range" min="2" max="5" step="1"
                value={configDraft.minTouches ?? 2}
                onChange={(e) => setConfigDraft((c) => ({ ...c, minTouches: Number(e.target.value) }))}
                className="w-full accent-amber-400"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center justify-between text-xs text-slate-300">
                <span>區間寬度範圍</span>
                <span className="font-mono text-white">{configDraft.minRangeWidthPct ?? 1}% ~ {configDraft.maxRangeWidthPct ?? 8}%</span>
              </label>
              <div className="flex gap-2">
                <input type="number" min="0.5" max="5" step="0.5"
                  value={configDraft.minRangeWidthPct ?? 1}
                  onChange={(e) => setConfigDraft((c) => ({ ...c, minRangeWidthPct: Number(e.target.value) }))}
                  className="w-1/2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
                />
                <input type="number" min="3" max="15" step="0.5"
                  value={configDraft.maxRangeWidthPct ?? 8}
                  onChange={(e) => setConfigDraft((c) => ({ ...c, maxRangeWidthPct: Number(e.target.value) }))}
                  className="w-1/2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-2 flex items-center justify-between text-xs text-slate-300">
                <span>推播冷卻</span>
                <span className="font-mono text-white">{configDraft.cooldownMinutes ?? 60} 分鐘</span>
              </label>
              <input
                type="range" min="15" max="240" step="15"
                value={configDraft.cooldownMinutes ?? 60}
                onChange={(e) => setConfigDraft((c) => ({ ...c, cooldownMinutes: Number(e.target.value) }))}
                className="w-full accent-amber-400"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={handleSaveConfig}
              className="rounded-xl bg-amber-400/15 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-400/25">
              儲存設定
            </button>
            <button type="button" onClick={handleTestTelegram}
              className="rounded-xl bg-sky-400/15 px-4 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-400/25">
              測試 Telegram
            </button>
            {telegramMsg && <span className="self-center text-xs text-slate-400">{telegramMsg}</span>}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel-soft rounded-[24px] px-5 py-5">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">訊號總數</p>
          <p className="mt-3 font-mono text-3xl text-white">{signals.length}</p>
          <p className="mt-2 text-sm text-slate-300">前 80 大市值幣種掃描</p>
        </div>
        <div className="panel-soft rounded-[24px] px-5 py-5">
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-400/70">做多訊號</p>
          <p className="mt-3 font-mono text-3xl text-emerald-300">{longSignals.length}</p>
          <p className="mt-2 text-sm text-slate-300">觸及支撐位</p>
        </div>
        <div className="panel-soft rounded-[24px] px-5 py-5">
          <p className="text-xs uppercase tracking-[0.28em] text-rose-400/70">做空訊號</p>
          <p className="mt-3 font-mono text-3xl text-rose-300">{shortSignals.length}</p>
          <p className="mt-2 text-sm text-slate-300">觸及壓力位</p>
        </div>
      </div>

      {/* Signal List */}
      {loading ? (
        <div className="panel flex min-h-[320px] items-center justify-center rounded-[28px] text-slate-300">
          正在掃描前 80 大市值幣種的壓力/支撐位...
        </div>
      ) : signals.length === 0 ? (
        <div className="panel flex min-h-[200px] items-center justify-center rounded-[28px] text-slate-400">
          目前沒有幣種觸及壓力/支撐位，可調整觸發距離或稍後重試。
        </div>
      ) : (
        <div className="space-y-3">
          {signals.map((sig) => (
            <SignalCard
              key={sig.symbol}
              signal={sig}
              onSelect={(symbol) => navigate(`/chart/${symbol}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
