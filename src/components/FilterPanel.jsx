const PATTERN_KEYS = [
  { key: 'triangle', label: 'Triangle' },
  { key: 'wBottom', label: 'W Bottom' },
  { key: 'mTop', label: 'M Top' },
];

export default function FilterPanel({ filters, onChange }) {
  return (
    <aside className="panel rounded-[28px] px-5 py-5">
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">Filters</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Trim the universe fast</h2>
        <p className="mt-2 text-sm text-slate-300">
          Score and pattern filters stay lightweight so the table remains focused on the best 5-10 charts to inspect.
        </p>
      </div>

      <div className="space-y-6">
        <section>
          <p className="mb-3 text-sm font-medium text-slate-100">Timeframe</p>
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
            <p className="text-sm font-medium text-slate-100">Minimum score</p>
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
          <p className="mb-3 text-sm font-medium text-slate-100">Search symbol</p>
          <input
            type="text"
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value.toUpperCase() })}
            placeholder="BTC, ARC, DOGE..."
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-emerald-400/45"
          />
        </section>

        <section>
          <p className="mb-3 text-sm font-medium text-slate-100">Pattern preference</p>
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
