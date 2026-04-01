import { useEffect, useState } from 'react';
import { getRangeSignals } from '../services/binanceApi';
import { DEFAULT_SCORE_THRESHOLD } from '../services/signalScore';

const MAX_SCORE = 5;

function ScoreBar({ score, direction }) {
  const pct = Math.min(score / MAX_SCORE, 1) * 100;
  const color = direction === 'long' ? 'bg-emerald-400' : 'bg-rose-400';
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function RankRow({ item, onSelect }) {
  const isLong = item.direction === 'long';
  const tone = isLong ? 'text-emerald-300' : 'text-rose-300';
  const arrow = isLong ? '\u25b2' : '\u25bc';
  const dir = isLong ? '\u505a\u591a' : '\u505a\u7a7a';

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item.symbol)}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06]"
    >
      <span className="w-20 truncate font-mono text-xs font-semibold text-white">{item.symbol.replace('USDT', '')}</span>
      <span className={`text-xs font-medium ${tone}`}>{dir} {arrow}</span>
      <span className="font-mono text-xs text-white">{item.totalScore.toFixed(1)}</span>
      <ScoreBar score={item.totalScore} direction={item.direction} />
    </button>
  );
}

export default function SignalRankPanel({ signals = [], onOpenChart }) {
  const [threshold, setThreshold] = useState(() => {
    const saved = localStorage.getItem('signalScoreThreshold');
    return saved ? Number(saved) : DEFAULT_SCORE_THRESHOLD;
  });

  useEffect(() => {
    localStorage.setItem('signalScoreThreshold', String(threshold));
  }, [threshold]);

  const filtered = signals
    .filter((s) => s.totalScore >= threshold && s.direction !== 'neutral')
    .sort((a, b) => b.totalScore - a.totalScore);

  return (
    <aside className="panel rounded-[28px] px-5 py-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-sky-300/75">形態評分</p>
          <h2 className="mt-1 text-base font-semibold text-white">訊號排行</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">門檻</span>
          <input
            type="number"
            min="1"
            max="5"
            step="0.5"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-14 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center font-mono text-xs text-white"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">目前沒有達門檻的訊號</p>
      ) : (
        <div className="max-h-[360px] space-y-0.5 overflow-y-auto">
          {filtered.map((item) => (
            <RankRow key={item.symbol} item={item} onSelect={onOpenChart} />
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500">{filtered.length} / {signals.length} 達門檻</p>
    </aside>
  );
}
