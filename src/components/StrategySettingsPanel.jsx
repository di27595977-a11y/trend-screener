import { DEFAULT_RUNTIME_SETTINGS } from '../config/runtimeSettings';

const FIELD_GROUPS = [
  {
    title: '\u8da8\u52e2\u9580\u6abb',
    fields: [
      { section: 'thresholds', key: 'minRSquared', label: '\u6700\u5c0f R\u00b2', step: '0.01', min: '0', max: '1' },
      { section: 'thresholds', key: 'maxPullbackRatio', label: '\u6700\u5927\u56de\u8abf\u6bd4', step: '0.01', min: '0', max: '1' },
      { section: 'thresholds', key: 'minVolumeRatio', label: '\u6700\u5c0f\u91cf\u6bd4', step: '0.05', min: '0', max: '10' },
      { section: 'thresholds', key: 'minPriceChange', label: '\u6700\u5c0f\u6f32\u5e45 %', step: '0.5', min: '0', max: '200' },
      { section: 'thresholds', key: 'maxPriceChange', label: '\u6700\u5927\u6f32\u5e45 %', step: '1', min: '1', max: '500' },
    ],
  },
  {
    title: '\u4f4d\u7f6e\u8207\u6383\u63cf',
    fields: [
      { section: 'scoring', key: 'preferredPositionMin', label: '\u504f\u597d\u4f4d\u7f6e\u4e0b\u9650', step: '0.01', min: '0', max: '1' },
      { section: 'scoring', key: 'preferredPositionMax', label: '\u504f\u597d\u4f4d\u7f6e\u4e0a\u9650', step: '0.01', min: '0', max: '1' },
      { section: 'scan', key: 'minScoreDefault', label: '\u9810\u8a2d\u6700\u4f4e\u5206', step: '1', min: '0', max: '100' },
      { section: 'scan', key: 'patternDetectionLimit', label: '\u8dd1\u5f62\u614b\u7684\u524d N \u540d', step: '1', min: '5', max: '200' },
      { section: 'backtest', key: 'lookupCandleLimit', label: '\u56de\u6e2c\u6293 K \u7dda\u6578', step: '1', min: '72', max: '300' },
    ],
  },
];

const COPY = {
  eyebrow: '\u7b56\u7565\u8a2d\u5b9a',
  title: '\u628a\u6838\u5fc3\u53c3\u6578\u8b8a\u6210\u53ef\u8abf\u6574\uff0c\u800c\u4e0d\u662f\u53ea\u80fd\u6539\u7a0b\u5f0f\u78bc',
  description:
    '\u5132\u5b58\u5f8c\u6703\u5beb\u9032 Supabase \u7684 app_state\uff0c\u4e4b\u5f8c\u624b\u52d5\u91cd\u6383\u8207\u6392\u7a0b\u6383\u63cf\u90fd\u6703\u5403\u540c\u4e00\u5957\u8a2d\u5b9a\u3002',
  reset: '\u9084\u539f\u76ee\u524d\u9810\u8a2d',
  save: '\u5132\u5b58\u4e26\u91cd\u6383',
  saving: '\u5132\u5b58\u4e2d...',
  saved: '\u5df2\u5957\u7528\u6700\u65b0\u7b56\u7565\u53c3\u6578',
};

function formatNumberValue(value) {
  if (value == null || Number.isNaN(value)) {
    return '';
  }

  return String(value);
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_RUNTIME_SETTINGS));
}

export default function StrategySettingsPanel({ settings, saving, savedAt, onFieldChange, onReset, onSave }) {
  return (
    <aside className="panel rounded-[28px] px-5 py-5">
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-sky-300/80">{COPY.eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-white">{COPY.title}</h2>
        <p className="mt-2 text-sm text-slate-300">{COPY.description}</p>
      </div>

      <div className="space-y-6">
        {FIELD_GROUPS.map((group) => (
          <section key={group.title}>
            <p className="mb-3 text-sm font-medium text-slate-100">{group.title}</p>
            <div className="space-y-3">
              {group.fields.map((field) => (
                <label key={`${field.section}.${field.key}`} className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <span className="text-sm text-slate-200">{field.label}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={formatNumberValue(settings?.[field.section]?.[field.key])}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(event) => onFieldChange(field.section, field.key, Number(event.target.value))}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onReset(cloneDefaults())}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:text-white"
        >
          {COPY.reset}
        </button>
        <button
          type="button"
          onClick={() => onSave()}
          disabled={saving}
          className="rounded-full border border-sky-400/35 bg-sky-400/12 px-4 py-2 text-sm font-medium text-sky-50 transition hover:border-sky-300/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? COPY.saving : COPY.save}
        </button>
      </div>

      {savedAt && (
        <p className="mt-3 text-sm text-sky-100">
          {`${COPY.saved} / ${new Date(savedAt).toLocaleString('zh-TW', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}`}
        </p>
      )}
    </aside>
  );
}
