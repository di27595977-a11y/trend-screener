const PATTERN_STYLE = {
  support: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  resistance: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
  triangle: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  harmonic: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
  w_bottom: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50',
  m_top: 'border-rose-300/30 bg-rose-300/10 text-rose-50',
  neutral: 'border-slate-400/25 bg-slate-400/10 text-slate-200',
};

function parsePatternName(rawPattern) {
  if (rawPattern.startsWith('triangle:')) {
    const type = rawPattern.split(':')[1];
    const label =
      {
        ascending: '\u25b2 \u4e0a\u5347\u4e09\u89d2',
        descending: '\u25bd \u4e0b\u964d\u4e09\u89d2',
        symmetric: '\u25c7 \u5c0d\u7a31\u4e09\u89d2',
      }[type] || '\u4e09\u89d2\u6536\u6582';

    return { key: rawPattern, label, tone: 'triangle' };
  }

  if (rawPattern.startsWith('harmonic:')) {
    const [, name, direction] = rawPattern.split(':');
    const baseLabel =
      {
        gartley: 'Gartley',
        bat: 'Bat',
        butterfly: 'Butterfly',
        crab: 'Crab',
      }[name] || name;
    const directionLabel = direction === 'bullish' ? '\u725b\u8ae7\u6ce2' : '\u718a\u8ae7\u6ce2';

    return { key: rawPattern, label: `${baseLabel} ${directionLabel}`, tone: 'harmonic' };
  }

  if (rawPattern === 'w_bottom') {
    return { key: rawPattern, label: 'W \u5e95', tone: 'w_bottom' };
  }

  if (rawPattern === 'm_top') {
    return { key: rawPattern, label: 'M \u9802', tone: 'm_top' };
  }

  if (rawPattern.startsWith('support:')) {
    const touches = rawPattern.split(':')[1];
    return { key: rawPattern, label: `\u652f\u6490 \u00d7${touches}`, tone: 'support' };
  }

  if (rawPattern.startsWith('resistance:')) {
    const touches = rawPattern.split(':')[1];
    return { key: rawPattern, label: `\u58d3\u529b \u00d7${touches}`, tone: 'resistance' };
  }

  if (rawPattern === 'trend_only') {
    return { key: rawPattern, label: '\u7d14\u8da8\u52e2', tone: 'neutral' };
  }

  return { key: rawPattern, label: rawPattern, tone: 'neutral' };
}

function fromPatternObject(patterns) {
  const values = [];

  if (patterns?.triangle) {
    values.push(`triangle:${patterns.triangle.type}`);
  }

  const harmonics =
    patterns?.harmonics?.length
      ? patterns.harmonics
      : patterns?.harmonic
        ? [patterns.harmonic]
        : [];

  harmonics.slice(0, 2).forEach((pattern) => {
    values.push(`harmonic:${pattern.key}:${pattern.direction}`);
  });

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

export default function PatternTags({ patterns = [], emptyLabel = '\u7d14\u8da8\u52e2' }) {
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
