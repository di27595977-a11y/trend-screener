import TradeSignalBadge from './TradeSignalBadge';

const COPY = {
  title: '\u4ea4\u6613\u5efa\u8b70',
  confidence: '\u4fe1\u5fc3\u5ea6',
  entry: '\u5efa\u8b70\u9032\u5834',
  sl: 'SL',
  tp1: 'TP1',
  tp2: 'TP2',
  riskReward: '\u98a8\u96aa\u5831\u916c\u6bd4',
  reasons: '\u539f\u56e0',
  warnings: '\u63d0\u9192',
  noAdvice: '\u76ee\u524d\u7121\u660e\u78ba\u4ea4\u6613\u8a2d\u5b9a\uff0c\u5efa\u8b70\u7b49\u5f85\u984d\u5916\u8a0a\u865f\u78ba\u8a8d\u3002',
};

const CONFIDENCE_LABEL = {
  high: '\u9ad8',
  medium: '\u4e2d',
  low: '\u4f4e',
};

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  if (value >= 1000) {
    return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  return value.toLocaleString('zh-TW', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function formatDistance(target, base) {
  if ([target, base].some((value) => value == null || Number.isNaN(value)) || base === 0) {
    return '--';
  }

  return `${(((target - base) / base) * 100).toFixed(2)}%`;
}

function NumberCard({ label, value, currentPrice }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-base text-white">{formatPrice(value)}</p>
      <p className="mt-1 font-mono text-xs text-slate-400">{formatDistance(value, currentPrice)}</p>
    </div>
  );
}

export default function TradeAdvicePanel({ advice, currentPrice }) {
  if (!advice) {
    return null;
  }

  return (
    <section className="panel rounded-[28px] px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.title}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <TradeSignalBadge direction={advice.direction} confidence={advice.confidence} />
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
              {`${COPY.confidence} ${CONFIDENCE_LABEL[advice.confidence] || CONFIDENCE_LABEL.low}`}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{COPY.riskReward}</p>
          <p className="mt-1 font-mono text-lg text-white">{advice.riskReward != null ? `1 : ${advice.riskReward.toFixed(1)}` : '--'}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NumberCard label={COPY.entry} value={advice.entry} currentPrice={currentPrice} />
        <NumberCard label={COPY.sl} value={advice.sl} currentPrice={currentPrice} />
        <NumberCard label={COPY.tp1} value={advice.tp1} currentPrice={currentPrice} />
        <NumberCard label={COPY.tp2} value={advice.tp2} currentPrice={currentPrice} />
      </div>

      {advice.reasons?.length ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-white">{COPY.reasons}</p>
          <div className="mt-3 space-y-2">
            {advice.reasons.map((reason) => (
              <div key={reason} className="flex gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/8 px-4 py-3 text-sm text-emerald-50">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-300" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-300">{COPY.noAdvice}</p>
      )}

      {advice.warnings?.length ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-white">{COPY.warnings}</p>
          <div className="mt-3 space-y-2">
            {advice.warnings.map((warning) => (
              <div key={warning} className="rounded-2xl border border-amber-400/20 bg-amber-400/8 px-4 py-3 text-sm text-amber-50">
                {warning}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
