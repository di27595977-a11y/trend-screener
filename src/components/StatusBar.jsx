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

function ProgressPill({ label, value, tone = 'slate' }) {
  const toneClasses = {
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
    rose: 'border-rose-400/25 bg-rose-400/10 text-rose-100',
    slate: 'border-white/10 bg-white/5 text-slate-200',
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses[tone]}`}>
      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-300/80">{label}</p>
      <p className="mt-2 font-mono text-sm">{value}</p>
    </div>
  );
}

export default function StatusBar({ status, timeframe, wsConnected, onRefresh, refreshing }) {
  const scanner = status?.scanner || {};
  const backtest = status?.backtest || {};
  const progress = scanner.progress || { completed: 0, total: 0, percent: 0 };

  return (
    <section className="panel data-grid mb-6 rounded-[28px] px-5 py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">Scanner State</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                wsConnected
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                  : 'border-rose-400/30 bg-rose-400/10 text-rose-100'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-300' : 'bg-rose-300'}`} />
              {wsConnected ? 'WS connected' : 'WS reconnecting'}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
              {scanner.isScanning ? `Scanning ${scanner.activeTimeframe || timeframe}` : `Watching ${timeframe}`}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
              Storage: {status?.persistence || 'memory'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRefresh?.()}
          disabled={refreshing || scanner.isScanning}
          className="inline-flex items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-sm font-medium text-emerald-50 transition hover:border-emerald-300/55 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing || scanner.isScanning ? 'Scanning...' : 'Scan now'}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <ProgressPill label="Last scan" value={formatTime(scanner.lastScanAt)} tone="emerald" />
        <ProgressPill label="Next scan" value={formatTime(scanner.nextScanAt)} />
        <ProgressPill
          label="Progress"
          value={progress.total ? `${progress.completed}/${progress.total} (${progress.percent}%)` : 'Idle'}
          tone={scanner.isScanning ? 'amber' : 'slate'}
        />
        <ProgressPill label="Backtest run" value={formatTime(backtest.lastRunAt)} />
        <ProgressPill label="Backtest next" value={formatTime(backtest.nextRunAt)} tone="amber" />
      </div>
    </section>
  );
}
