export default function RangeSignalBadge({ signal }) {
  if (!signal) return <span className="text-xs text-slate-500">—</span>;

  const isLong = signal.signalSide === 'long';
  const label = isLong ? '做多' : '做空';
  const bg = isLong ? 'bg-emerald-400/15 border-emerald-400/30 text-emerald-300' : 'bg-rose-400/15 border-rose-400/30 text-rose-300';
  const confirm4h = signal.has4hConfirm ? ' ✦' : '';

  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${bg}`}>
        {isLong ? '▲' : '▼'} {label}{confirm4h}
      </span>
      <span className="font-mono text-[11px] text-slate-400">
        {signal.score}分 · RSI {signal.rsi}
      </span>
    </div>
  );
}
