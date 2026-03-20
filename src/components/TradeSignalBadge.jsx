const TONES = {
  long: 'border-transparent bg-[#16a34a] text-white',
  short: 'border-transparent bg-[#dc2626] text-white',
  watch: 'border-transparent bg-[#374151] text-white',
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
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
        TONES[direction] || TONES.watch
      } ${confidence === 'high' ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.4)]' : ''}`}
      title={`\u4fe1\u5fc3\u5ea6\uff1a${CONFIDENCE[confidence] || CONFIDENCE.low}`}
    >
      {LABELS[direction] || LABELS.watch}
    </span>
  );
}
