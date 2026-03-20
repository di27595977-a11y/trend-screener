const PATTERN_KEYS = [
  { key: 'triangle', label: '\u4e09\u89d2\u6536\u6582' },
  { key: 'harmonic', label: '\u8ae7\u6ce2\u5f62\u614b' },
  { key: 'wBottom', label: 'W \u5e95' },
  { key: 'mTop', label: 'M \u9802' },
];

const COPY = {
  eyebrow: '\u7be9\u9078\u689d\u4ef6',
  title: '\u5148\u628a\u5e63\u6d77\u5feb\u901f\u7e2e\u5c0f',
  description:
    '\u5148\u7528\u5206\u6578\u3001\u6642\u9593\u6846\u67b6\u548c\u5f62\u614b\u504f\u597d\u7be9\u6389\u96dc\u8a0a\uff0c\u518d\u628a\u7126\u9ede\u653e\u5728\u6700\u503c\u5f97\u6253\u958b\u5716\u770b\u7684 5 \u5230 10 \u500b\u5019\u9078\u3002',
  timeframe: '\u6642\u9593\u6846\u67b6',
  minScore: '\u6700\u4f4e\u5206\u6578',
  search: '\u641c\u5c0b\u5e63\u7a2e',
  searchPlaceholder: '\u8f38\u5165 BTC\u3001ARC\u3001DOGE...',
  patternPreference: '\u504f\u597d\u5f62\u614b',
};

export default function FilterPanel({ filters, onChange }) {
  return (
    <aside className="panel rounded-[28px] px-5 py-5">
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">{COPY.eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-white">{COPY.title}</h2>
        <p className="mt-2 text-sm text-slate-300">{COPY.description}</p>
      </div>

      <div className="space-y-6">
        <section>
          <p className="mb-3 text-sm font-medium text-slate-100">{COPY.timeframe}</p>
          <div className="grid grid-cols-2 gap-2">
            {['1h', '4h'].map((timeframe) => (
              <button
                key={timeframe}
                type="button"
                onClick={() => onChange({ timeframe })}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  filters.timeframe === timeframe
                    ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-50'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white'
                }`}
              >
                {timeframe.toUpperCase()}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-100">{COPY.minScore}</p>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-sm text-white">
              {filters.minScore}
            </span>
          </div>
          <input
            type="range"
            min="40"
            max="95"
            step="1"
            value={filters.minScore}
            onChange={(event) => onChange({ minScore: Number(event.target.value) })}
            className="w-full accent-emerald-400"
          />
        </section>

        <section>
          <p className="mb-3 text-sm font-medium text-slate-100">{COPY.search}</p>
          <input
            type="text"
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value.toUpperCase() })}
            placeholder={COPY.searchPlaceholder}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-emerald-400/45"
          />
        </section>

        <section>
          <p className="mb-3 text-sm font-medium text-slate-100">{COPY.patternPreference}</p>
          <div className="space-y-2">
            {PATTERN_KEYS.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 transition hover:border-white/20"
              >
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={filters.patterns[item.key]}
                  onChange={(event) =>
                    onChange({
                      patterns: {
                        ...filters.patterns,
                        [item.key]: event.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4 accent-emerald-400"
                />
              </label>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
