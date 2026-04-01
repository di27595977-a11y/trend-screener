import { useEffect, useState } from 'react';
import { getRangeSignals, triggerRangeScan, updateRangeConfig, testRangeTelegram } from '../services/binanceApi';

function SignalRow({ signal, onSelect }) {
  const isLong = signal.signalSide === 'long';
  const sideLabel = isLong ? '▲ 做多' : '▼ 做空';
  const sideTone = isLong ? 'text-emerald-300' : 'text-rose-300';
  const levelType = signal.targetLevel.type === 'resistance' ? '壓力' : '支撐';

  return (
    <button
      type="button"
      onClick={() => onSelect?.(signal)}
      className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${sideTone}`}>{sideLabel}</span>
          <span className="font-mono text-sm font-semibold text-white">{signal.symbol}</span>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-xs text-white">{signal.score}分</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>{levelType} {signal.targetLevel.price.toPrecision(6)} ×{signal.targetLevel.touches}</span>
        <span>距離 {signal.proximity.toFixed(3)}%</span>
        <span>RSI {signal.rsi}</span>
        <span>量比 {signal.volumeRatio}x</span>
        {signal.has4hConfirm && <span className="text-amber-300">✦ 4H確認</span>}
        {signal.bbWidth != null && <span>BB寬 {signal.bbWidth}%</span>}
      </div>
    </button>
  );
}

export default function RangePanel({ onOpenChart }) {
  const [data, setData] = useState({ signals: [], lastScanAt: null, config: {}, telegramConfigured: false });
  const [scanning, setScanning] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState({});
  const [telegramMsg, setTelegramMsg] = useState('');

  const load = async () => {
    try {
      const result = await getRangeSignals();
      setData(result);
      setConfigDraft(result.config || {});
    } catch {
      // silent
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      await triggerRangeScan();
      // Wait a moment then reload
      setTimeout(load, 5000);
    } catch {
      // silent
    } finally {
      setScanning(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      const updated = await updateRangeConfig(configDraft);
      setConfigDraft(updated);
      setData((prev) => ({ ...prev, config: updated }));
    } catch {
      // silent
    }
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

  return (
    <aside className="panel rounded-[28px] px-5 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-300/75">區間偵測</p>
          <h2 className="mt-1 text-lg font-semibold text-white">S/R 震盪訊號</h2>
        </div>
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-400/20 disabled:opacity-50"
        >
          {scanning ? '掃描中...' : '立即掃描'}
        </button>
      </div>

      {data.lastScanAt && (
        <p className="mb-3 text-xs text-slate-500">
          上次掃描: {new Date(data.lastScanAt).toLocaleTimeString('zh-TW')}
          {' · '}
          {signals.length} 個訊號
          {data.telegramConfigured ? ' · TG ✓' : ''}
        </p>
      )}

      <div className="mb-4 space-y-2">
        {signals.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">目前沒有觸及壓力/支撐的幣種</p>
        ) : (
          signals.map((sig) => (
            <SignalRow
              key={sig.symbol}
              signal={sig}
              onSelect={() => onOpenChart?.(sig.symbol)}
            />
          ))
        )}
      </div>

      {/* Config Toggle */}
      <button
        type="button"
        onClick={() => setShowConfig(!showConfig)}
        className="w-full rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left text-xs text-slate-400 transition hover:text-slate-200"
      >
        {showConfig ? '▾ 隱藏設定' : '▸ 偵測設定'}
      </button>

      {showConfig && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-slate-300">
              <span>觸發距離 (%)</span>
              <span className="font-mono text-white">{configDraft.proximityPct ?? 0.3}%</span>
            </label>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={configDraft.proximityPct ?? 0.3}
              onChange={(e) => setConfigDraft((c) => ({ ...c, proximityPct: Number(e.target.value) }))}
              className="w-full accent-amber-400"
            />
          </div>

          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-slate-300">
              <span>最少觸及次數</span>
              <span className="font-mono text-white">{configDraft.minTouches ?? 2}</span>
            </label>
            <input
              type="range"
              min="2"
              max="5"
              step="1"
              value={configDraft.minTouches ?? 2}
              onChange={(e) => setConfigDraft((c) => ({ ...c, minTouches: Number(e.target.value) }))}
              className="w-full accent-amber-400"
            />
          </div>

          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-slate-300">
              <span>區間寬度 (%)</span>
              <span className="font-mono text-white">{configDraft.minRangeWidthPct ?? 1}~{configDraft.maxRangeWidthPct ?? 8}%</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.5"
                max="5"
                step="0.5"
                value={configDraft.minRangeWidthPct ?? 1}
                onChange={(e) => setConfigDraft((c) => ({ ...c, minRangeWidthPct: Number(e.target.value) }))}
                className="w-1/2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
              />
              <input
                type="number"
                min="3"
                max="15"
                step="0.5"
                value={configDraft.maxRangeWidthPct ?? 8}
                onChange={(e) => setConfigDraft((c) => ({ ...c, maxRangeWidthPct: Number(e.target.value) }))}
                className="w-1/2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-slate-300">
              <span>推播冷卻 (分鐘)</span>
              <span className="font-mono text-white">{configDraft.cooldownMinutes ?? 60}</span>
            </label>
            <input
              type="range"
              min="15"
              max="240"
              step="15"
              value={configDraft.cooldownMinutes ?? 60}
              onChange={(e) => setConfigDraft((c) => ({ ...c, cooldownMinutes: Number(e.target.value) }))}
              className="w-full accent-amber-400"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveConfig}
              className="flex-1 rounded-xl bg-amber-400/15 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-400/25"
            >
              儲存設定
            </button>
            <button
              type="button"
              onClick={handleTestTelegram}
              className="flex-1 rounded-xl bg-sky-400/15 px-3 py-2 text-xs font-medium text-sky-200 transition hover:bg-sky-400/25"
            >
              測試 TG
            </button>
          </div>

          {telegramMsg && <p className="text-xs text-slate-400">{telegramMsg}</p>}
        </div>
      )}
    </aside>
  );
}
