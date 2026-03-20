import { getScoreTone } from '../utils/scoring';

const TONE_CLASSES = {
  emerald: 'border-emerald-400/35 bg-emerald-400/12 text-emerald-100',
  amber: 'border-amber-400/35 bg-amber-400/12 text-amber-100',
  rose: 'border-rose-400/35 bg-rose-400/12 text-rose-100',
};

export default function ScoreBadge({ score }) {
  const tone = getScoreTone(score);

  return (
    <span className={`inline-flex min-w-14 items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold ${TONE_CLASSES[tone]}`}>
      {score}
    </span>
  );
}
