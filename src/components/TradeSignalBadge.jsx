const TONES = {
  long: 'border-emerald-400/30 bg-emerald-400/12 text-emerald-50',
  short: 'border-rose-400/30 bg-rose-400/12 text-rose-50',
  watch: 'border-slate-400/25 bg-slate-400/10 text-slate-200',
};

const LABELS = {
  long: '\u25b2 \u505a\u591a',
  short: '\u25bc \u505a\u7a7a',
  watch: '\u25ce \u89c0\u671b',
};

const CONFIDENCE = {
  high: '\u9ad8',
  medium: '\u4e2d',
  low: '\u4f4e',
};

export default function TradeSignalBadge({ direction = 'watch', confidence = 'low' }) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${TONES[direction] || TONES.watch}`}
      title={`\u4fe1\u5fc3\u5ea6\uff1a${CONFIDENCE[confidence] || CONFIDENCE.low}`}
    >
      {`${LABELS[direction] || LABELS.watch} / ${CONFIDENCE[confidence] || CONFIDENCE.low}`}
    </span>
  );
}
