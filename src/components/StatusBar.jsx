function formatTime(value) {
  if (!value) {
    return '--:--';
  }

  return new Date(value).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStorageLabel(value) {
  if (value === 'supabase') {
    return 'Supabase';
  }

  if (value === 'memory') {
    return '\u8a18\u61b6\u9ad4';
  }

  return value || '--';
}

function ProgressPill({ label, value, tone = 'slate' }) {
  const toneClasses = {
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
    rose: 'border-rose-400/25 bg-rose-400/10 text-rose-100',
    slate: 'border-white/10 bg-white/5 text-slate-200',
  };

  return (
    <div className={`rounded-2xl border px-3 py-3 sm:px-4 ${toneClasses[tone]}`}>
      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-300/80">{label}</p>
      <p className="mt-2 font-mono text-sm">{value}</p>
    </div>
  );
}

export default function StatusBar({ status, timeframe, wsConnected, onRefresh, refreshing }) {
  const scanner = status?.scanner || {};
  const backtest = status?.backtest || {};
  const progress = scanner.progress || { completed: 0, total: 0, percent: 0 };
  const storageLabel = formatStorageLabel(status?.persistence);
  const scanState = scanner.isScanning
    ? `\u6383\u63cf\u4e2d ${scanner.activeTimeframe || timeframe}`
    : `\u76e3\u770b\u4e2d ${timeframe}`;
  const progressValue = progress.total
    ? `${progress.completed}/${progress.total} (${progress.percent}%)`
    : '\u5f85\u547d\u4e2d';

  return (
    <section className="panel data-grid mb-6 rounded-[28px] px-5 py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">
            {'\u6383\u63cf\u72c0\u614b'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                wsConnected
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                  : 'border-rose-400/30 bg-rose-400/10 text-rose-100'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-300' : 'bg-rose-300'}`} />
              {wsConnected ? '\u5df2\u9023\u7dda' : '\u91cd\u9023\u4e2d'}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">{scanState}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
              {`\u8cc7\u6599\u5132\u5b58\uff1a${storageLabel}`}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRefresh?.()}
          disabled={refreshing || scanner.isScanning}
          className="inline-flex w-full items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-sm font-medium text-emerald-50 transition hover:border-emerald-300/55 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {refreshing || scanner.isScanning ? '\u6383\u63cf\u4e2d...' : '\u7acb\u5373\u6383\u63cf'}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <ProgressPill label={'\u4e0a\u6b21\u6383\u63cf'} value={formatTime(scanner.lastScanAt)} tone="emerald" />
        <ProgressPill label={'\u4e0b\u6b21\u6383\u63cf'} value={formatTime(scanner.nextScanAt)} />
        <ProgressPill label={'\u9032\u5ea6'} value={progressValue} tone={scanner.isScanning ? 'amber' : 'slate'} />
        <ProgressPill label={'\u4e0a\u6b21\u56de\u6e2c'} value={formatTime(backtest.lastRunAt)} />
        <ProgressPill label={'\u4e0b\u6b21\u56de\u6e2c'} value={formatTime(backtest.nextRunAt)} tone="amber" />
      </div>
    </section>
  );
}
