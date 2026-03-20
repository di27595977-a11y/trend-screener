import { useEffect, useState } from 'react';
import { getBacktestReport } from '../services/binanceApi';

const COPY = {
  eyebrow: '\u56de\u6e2c\u5831\u544a',
  title: '\u7528\u6b77\u53f2\u6383\u63cf\u7d50\u679c\u6aa2\u67e5\u53c3\u6578\u662f\u5426\u4ecd\u7136\u6709\u7528',
  loading: '\u6b63\u5728\u8f09\u5165\u56de\u6e2c\u7d71\u8a08...',
  samples: '\u6a23\u672c\u6578',
  avg24h: '24H \u5e73\u5747\u5831\u916c',
  avg72h: '72H \u5e73\u5747\u5831\u916c',
  winRate24h: '24H \u52dd\u7387',
  scoreBuckets: '\u5206\u6578\u5340\u9593\u8868\u73fe',
  patternBuckets: '\u5f62\u614b\u52dd\u7387',
  recent: '\u6700\u8fd1\u6a23\u672c\u8868\u73fe',
  bucket: '\u5340\u9593',
  pattern: '\u5f62\u614b',
  entryPrice: '\u9032\u5834\u50f9',
  maxProfit: '\u6700\u5927\u6f32\u5e45',
  maxDrawdown: '\u6700\u5927\u56de\u64a4',
  symbol: '\u5e63\u7a2e',
  score: '\u5206\u6578',
  empty: '\u76ee\u524d\u6c92\u6709\u8db3\u5920\u7684\u56de\u6e2c\u8cc7\u6599\u3002',
};

function formatPercent(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return `${value.toFixed(digits)}%`;
}

function formatPatternName(pattern) {
  if (pattern === 'trend_only') {
    return '\u7d14\u8da8\u52e2';
  }

  if (pattern === 'w_bottom') {
    return 'W \u5e95';
  }

  if (pattern === 'm_top') {
    return 'M \u9802';
  }

  if (pattern.startsWith('triangle:')) {
    return (
      {
        'triangle:ascending': '\u4e0a\u5347\u4e09\u89d2',
        'triangle:descending': '\u4e0b\u964d\u4e09\u89d2',
        'triangle:symmetric': '\u5c0d\u7a31\u4e09\u89d2',
      }[pattern] || '\u4e09\u89d2\u6536\u6582'
    );
  }

  if (pattern.startsWith('harmonic:')) {
    const [, name, direction] = pattern.split(':');
    const baseLabel =
      {
        gartley: 'Gartley',
        bat: 'Bat',
        butterfly: 'Butterfly',
        crab: 'Crab',
      }[name] || name;
    const directionLabel = direction === 'bullish' ? '\u725b\u8ae7\u6ce2' : '\u718a\u8ae7\u6ce2';
    return `${baseLabel} ${directionLabel}`;
  }

  if (pattern.startsWith('support:')) {
    return `\u652f\u6490 \u00d7${pattern.split(':')[1]}`;
  }

  if (pattern.startsWith('resistance:')) {
    return `\u58d3\u529b \u00d7${pattern.split(':')[1]}`;
  }

  return pattern;
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return value >= 1
    ? value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : value.toLocaleString('zh-TW', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function EmptyStateRow({ columns }) {
  return (
    <tr className="border-t border-white/8">
      <td colSpan={columns} className="py-6 text-center text-slate-400">
        {COPY.empty}
      </td>
    </tr>
  );
}

export default function BacktestReport() {
  const [timeframe, setTimeframe] = useState('1h');
  const [days, setDays] = useState(14);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const nextReport = await getBacktestReport({ timeframe, days });

        if (!cancelled) {
          setReport(nextReport);
          setError('');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [days, timeframe]);

  const scoreBuckets = report?.scoreBuckets || [];
  const patternBuckets = report?.patternBuckets || [];
  const recentRows = report?.recent || [];

  return (
    <div className="space-y-6">
      <section className="panel rounded-[28px] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">{COPY.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{COPY.title}</h2>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
            >
              <option value="1h">1H</option>
              <option value="4h">4H</option>
            </select>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
            >
              <option value="7">{'\u8fd1 7 \u5929'}</option>
              <option value="14">{'\u8fd1 14 \u5929'}</option>
              <option value="30">{'\u8fd1 30 \u5929'}</option>
            </select>
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>}

      {loading ? (
        <div className="panel flex min-h-[240px] items-center justify-center rounded-[28px] text-slate-300">{COPY.loading}</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.samples}</p>
              <p className="mt-3 font-mono text-3xl text-white">{report?.totals?.samples ?? 0}</p>
            </div>
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.avg24h}</p>
              <p className="mt-3 font-mono text-3xl text-white">{formatPercent(report?.totals?.avg24hReturn)}</p>
            </div>
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.avg72h}</p>
              <p className="mt-3 font-mono text-3xl text-white">{formatPercent(report?.totals?.avg72hReturn)}</p>
            </div>
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.winRate24h}</p>
              <p className="mt-3 font-mono text-3xl text-white">{formatPercent(report?.totals?.winRate24h)}</p>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="panel rounded-[28px] px-5 py-5">
              <h3 className="text-lg font-semibold text-white">{COPY.scoreBuckets}</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="text-xs uppercase tracking-[0.24em] text-slate-400">
                    <tr>
                      <th className="pb-3 pr-4">{COPY.bucket}</th>
                      <th className="pb-3 pr-4">{COPY.samples}</th>
                      <th className="pb-3 pr-4">24H</th>
                      <th className="pb-3 pr-4">72H</th>
                      <th className="pb-3 pr-0">{'\u52dd\u7387'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreBuckets.length ? (
                      scoreBuckets.map((bucket) => (
                        <tr key={bucket.bucket} className="border-t border-white/8">
                          <td className="py-3 pr-4 font-mono">{bucket.bucket}</td>
                          <td className="py-3 pr-4">{bucket.samples}</td>
                          <td className="py-3 pr-4">{formatPercent(bucket.avg24hReturn)}</td>
                          <td className="py-3 pr-4">{formatPercent(bucket.avg72hReturn)}</td>
                          <td className="py-3 pr-0">{formatPercent(bucket.winRate24h)}</td>
                        </tr>
                      ))
                    ) : (
                      <EmptyStateRow columns={5} />
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel rounded-[28px] px-5 py-5">
              <h3 className="text-lg font-semibold text-white">{COPY.patternBuckets}</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="text-xs uppercase tracking-[0.24em] text-slate-400">
                    <tr>
                      <th className="pb-3 pr-4">{COPY.pattern}</th>
                      <th className="pb-3 pr-4">{COPY.samples}</th>
                      <th className="pb-3 pr-4">24H</th>
                      <th className="pb-3 pr-0">{'\u52dd\u7387'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patternBuckets.length ? (
                      patternBuckets.map((bucket) => (
                        <tr key={bucket.pattern} className="border-t border-white/8">
                          <td className="py-3 pr-4 font-mono">{formatPatternName(bucket.pattern)}</td>
                          <td className="py-3 pr-4">{bucket.samples}</td>
                          <td className="py-3 pr-4">{formatPercent(bucket.avg24hReturn)}</td>
                          <td className="py-3 pr-0">{formatPercent(bucket.winRate24h)}</td>
                        </tr>
                      ))
                    ) : (
                      <EmptyStateRow columns={4} />
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="panel rounded-[28px] px-5 py-5">
            <h3 className="text-lg font-semibold text-white">{COPY.recent}</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase tracking-[0.24em] text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4">{COPY.symbol}</th>
                    <th className="pb-3 pr-4">{COPY.score}</th>
                    <th className="pb-3 pr-4">{COPY.entryPrice}</th>
                    <th className="pb-3 pr-4">24H</th>
                    <th className="pb-3 pr-4">72H</th>
                    <th className="pb-3 pr-4">{COPY.maxProfit}</th>
                    <th className="pb-3 pr-0">{COPY.maxDrawdown}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.length ? (
                    recentRows.map((item) => (
                      <tr key={`${item.symbol}-${item.createdAt}`} className="border-t border-white/8">
                        <td className="py-3 pr-4 font-mono">{item.symbol}</td>
                        <td className="py-3 pr-4">{item.trendScore}</td>
                        <td className="py-3 pr-4 font-mono">{formatPrice(item.entryPrice)}</td>
                        <td className="py-3 pr-4">{formatPercent(item.return24h)}</td>
                        <td className="py-3 pr-4">{formatPercent(item.return72h)}</td>
                        <td className="py-3 pr-4">{formatPercent(item.maxProfitPct)}</td>
                        <td className="py-3 pr-0">{formatPercent(item.maxDrawdownPct)}</td>
                      </tr>
                    ))
                  ) : (
                    <EmptyStateRow columns={7} />
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
