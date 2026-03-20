function buildPath(values, width, height, padding) {
  if (!values.length) {
    return '';
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return values
    .map((value, index) => {
      const x = padding + (index / Math.max(values.length - 1, 1)) * innerWidth;
      const y = padding + innerHeight - ((value - min) / range) * innerHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

export default function Sparkline({ values = [], width = 132, height = 44 }) {
  const path = buildPath(values, width, height, 3);
  const isPositive = (values.at(-1) ?? 0) >= (values[0] ?? 0);
  const stroke = isPositive ? '#34d399' : '#fb7185';

  return (
    <svg aria-hidden="true" className="overflow-visible" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
