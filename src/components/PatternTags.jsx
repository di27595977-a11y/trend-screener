const PATTERN_STYLE = {
  support: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  resistance: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
  triangle: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  w_bottom: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50',
  m_top: 'border-rose-300/30 bg-rose-300/10 text-rose-50',
  neutral: 'border-slate-400/25 bg-slate-400/10 text-slate-200',
};

function parsePatternName(rawPattern) {
  if (rawPattern.startsWith('triangle:')) {
    const type = rawPattern.split(':')[1];
    const label =
      {
        ascending: '▲ 上升三角',
        descending: '▽ 下降三角',
        symmetric: '◇ 對稱三角',
      }[type] || '三角收斂';

    return { key: rawPattern, label, tone: 'triangle' };
  }

  if (rawPattern === 'w_bottom') {
    return { key: rawPattern, label: 'W底', tone: 'w_bottom' };
  }

  if (rawPattern === 'm_top') {
    return { key: rawPattern, label: 'M頂', tone: 'm_top' };
  }

  if (rawPattern.startsWith('support:')) {
    const touches = rawPattern.split(':')[1];
    return { key: rawPattern, label: `支撐 x${touches}`, tone: 'support' };
  }

  if (rawPattern.startsWith('resistance:')) {
    const touches = rawPattern.split(':')[1];
    return { key: rawPattern, label: `壓力 x${touches}`, tone: 'resistance' };
  }

  return { key: rawPattern, label: rawPattern, tone: 'neutral' };
}

function fromPatternObject(patterns) {
  const values = [];

  if (patterns?.triangle) {
    values.push(`triangle:${patterns.triangle.type}`);
  }

  if (patterns?.wBottom) {
    values.push('w_bottom');
  }

  if (patterns?.mTop) {
    values.push('m_top');
  }

  patterns?.supportResistance?.slice(0, 3).forEach((level) => {
    values.push(`${level.type}:${level.touches}`);
  });

  return values;
}

export default function PatternTags({ patterns = [], emptyLabel = '純趨勢' }) {
  const rawPatterns = Array.isArray(patterns) ? patterns : fromPatternObject(patterns);
  const parsedPatterns = rawPatterns.map(parsePatternName);

  if (!parsedPatterns.length) {
    return (
      <span className="inline-flex rounded-full border border-slate-400/20 bg-slate-400/10 px-3 py-1 text-xs text-slate-200">
        {emptyLabel}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {parsedPatterns.map((pattern) => (
        <span
          key={pattern.key}
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${PATTERN_STYLE[pattern.tone] || PATTERN_STYLE.neutral}`}
        >
          {pattern.label}
        </span>
      ))}
    </div>
  );
}
