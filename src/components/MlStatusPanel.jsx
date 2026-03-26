import { useEffect, useState } from 'react';
import { getMlStatus, triggerMlTrain } from '../services/binanceApi';

function StatChip({ label, value, tone = 'slate' }) {
  const tones = {
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    amber:   'border-amber-400/25  bg-amber-400/10  text-amber-100',
    rose:    'border-rose-400/25   bg-rose-400/10   text-rose-100',
    slate:   'border-white/10      bg-white/5       text-slate-200',
  };
  return (
    <div className={`rounded-2xl border px-3 py-3 ${tones[tone]}`}>
      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-300/80">{label}</p>
      <p className="mt-2 font-mono text-sm">{value}</p>
    </div>
  );
}

function LabelBar({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 text-xs text-slate-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right font-mono text-xs text-slate-300">{count.toLocaleString()}</span>
      <span className="w-10 text-right font-mono text-xs text-slate-500">{pct}%</span>
    </div>
  );
}

export default function MlStatusPanel() {
  const [status, setStatus]   = useState(null);
  const [training, setTraining] = useState(false);
  const [error, setError]     = useState(null);

  async function load() {
    try {
      const data = await getMlStatus();
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  async function handleTrain() {
    setTraining(true);
    try {
      await triggerMlTrain();
      setTimeout(load, 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setTimeout(() => setTraining(false), 3000);
    }
  }

  if (!status) {
    return (
      <section className="panel rounded-[28px] px-5 py-5 mb-6">
        <p className="text-xs text-slate-400">載入 ML 狀態...</p>
      </section>
    );
  }

  const metrics  = status.metrics;
  const dist     = metrics?.labelDistribution;
  const total    = dist ? dist.down + dist.flat + dist.up : 0;
  const accuracy = metrics?.valAccuracy != null ? `${(metrics.valAccuracy * 100).toFixed(1)}%` : '--';
  const trainedAt = metrics?.trainedAt
    ? new Date(metrics.trainedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '--';

  const readyTone  = status.modelReady ? 'emerald' : 'amber';
  const readyLabel = status.modelReady ? '已就緒' : '未訓練';

  return (
    <section className="panel rounded-[28px] px-5 py-5 mb-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-violet-300/75">ML 模型</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
              status.modelReady
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                : 'border-amber-400/30 bg-amber-400/10 text-amber-100'
            }`}>
              <span className={`h-2 w-2 rounded-full ${status.modelReady ? 'bg-emerald-300' : 'bg-amber-300'}`} />
              {readyLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
              {status.featureCount} 特徵
            </span>
            {status.enabled && (
              <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-sm text-violet-200">
                推理已開啟
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleTrain}
          disabled={training}
          className="inline-flex w-full items-center justify-center rounded-full border border-violet-400/35 bg-violet-400/12 px-4 py-2 text-sm font-medium text-violet-50 transition hover:border-violet-300/55 hover:bg-violet-400/18 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {training ? '訓練中...' : '重新訓練'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p>
      )}

      {/* Metrics grid */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatChip label="驗證準確率" value={accuracy} tone={status.modelReady ? 'emerald' : 'slate'} />
        <StatChip label="訓練時間" value={trainedAt} tone="slate" />
        <StatChip label="訓練資料" value={metrics?.totalRows != null ? `${metrics.totalRows.toLocaleString()} 筆` : '--'} tone="slate" />
        <StatChip label="訓練輪數" value={metrics?.epochs != null ? `${metrics.epochs} epochs` : '--'} tone="slate" />
      </div>

      {/* Label distribution */}
      {dist && total > 0 && (
        <div className="mt-5">
          <p className="mb-3 text-[11px] uppercase tracking-[0.24em] text-slate-400">標籤分佈</p>
          <div className="flex flex-col gap-2">
            <LabelBar label="做多" count={dist.up}   total={total} color="bg-emerald-400" />
            <LabelBar label="中性" count={dist.flat} total={total} color="bg-slate-400"   />
            <LabelBar label="做空" count={dist.down} total={total} color="bg-rose-400"    />
          </div>
        </div>
      )}

      {!status.modelReady && (
        <p className="mt-4 text-xs text-slate-400">
          模型尚未訓練。完成資料收集後點「重新訓練」或執行 <code className="rounded bg-white/8 px-1">npm run ml:train</code>。
        </p>
      )}
    </section>
  );
}
