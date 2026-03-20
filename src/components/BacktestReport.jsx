import { useEffect, useState } from 'react';
import { getBacktestReport } from '../services/binanceApi';

function formatPercent(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return `${value.toFixed(digits)}%`;
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

  return (
    <div className="space-y-6">
      <section className="panel rounded-[28px] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">Backtest Report</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">See whether the screener is still earning attention</h2>
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
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>}

      {loading ? (
        <div className="panel flex min-h-[240px] items-center justify-center rounded-[28px] text-slate-300">Loading report...</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Samples</p>
              <p className="mt-3 font-mono text-3xl text-white">{report?.totals?.samples ?? 0}</p>
            </div>
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">24H avg</p>
              <p className="mt-3 font-mono text-3xl text-white">{formatPercent(report?.totals?.avg24hReturn)}</p>
            </div>
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">72H avg</p>
              <p className="mt-3 font-mono text-3xl text-white">{formatPercent(report?.totals?.avg72hReturn)}</p>
            </div>
            <div className="panel-soft rounded-[24px] px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">24H win rate</p>
              <p className="mt-3 font-mono text-3xl text-white">{formatPercent(report?.totals?.winRate24h)}</p>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="panel rounded-[28px] px-5 py-5">
              <h3 className="text-lg font-semibold text-white">Score bucket performance</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="text-xs uppercase tracking-[0.24em] text-slate-400">
                    <tr>
                      <th className="pb-3 pr-4">Bucket</th>
                      <th className="pb-3 pr-4">Samples</th>
                      <th className="pb-3 pr-4">24H</th>
                      <th className="pb-3 pr-4">72H</th>
                      <th className="pb-3 pr-0">Win</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report?.scoreBuckets?.map((bucket) => (
                      <tr key={bucket.bucket} className="border-t border-white/8">
                        <td className="py-3 pr-4 font-mono">{bucket.bucket}</td>
                        <td className="py-3 pr-4">{bucket.samples}</td>
                        <td className="py-3 pr-4">{formatPercent(bucket.avg24hReturn)}</td>
                        <td className="py-3 pr-4">{formatPercent(bucket.avg72hReturn)}</td>
                        <td className="py-3 pr-0">{formatPercent(bucket.winRate24h)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel rounded-[28px] px-5 py-5">
              <h3 className="text-lg font-semibold text-white">Pattern win rate</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="text-xs uppercase tracking-[0.24em] text-slate-400">
                    <tr>
                      <th className="pb-3 pr-4">Pattern</th>
                      <th className="pb-3 pr-4">Samples</th>
                      <th className="pb-3 pr-4">24H</th>
                      <th className="pb-3 pr-0">Win</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report?.patternBuckets?.map((bucket) => (
                      <tr key={bucket.pattern} className="border-t border-white/8">
                        <td className="py-3 pr-4 font-mono">{bucket.pattern}</td>
                        <td className="py-3 pr-4">{bucket.samples}</td>
                        <td className="py-3 pr-4">{formatPercent(bucket.avg24hReturn)}</td>
                        <td className="py-3 pr-0">{formatPercent(bucket.winRate24h)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="panel rounded-[28px] px-5 py-5">
            <h3 className="text-lg font-semibold text-white">Recent tracked results</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase tracking-[0.24em] text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4">Symbol</th>
                    <th className="pb-3 pr-4">Score</th>
                    <th className="pb-3 pr-4">Entry</th>
                    <th className="pb-3 pr-4">24H</th>
                    <th className="pb-3 pr-4">72H</th>
                    <th className="pb-3 pr-4">Max up</th>
                    <th className="pb-3 pr-0">Max dd</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.recent?.map((item) => (
                    <tr key={`${item.symbol}-${item.createdAt}`} className="border-t border-white/8">
                      <td className="py-3 pr-4 font-mono">{item.symbol}</td>
                      <td className="py-3 pr-4">{item.trendScore}</td>
                      <td className="py-3 pr-4 font-mono">{item.entryPrice?.toFixed?.(4) || '--'}</td>
                      <td className="py-3 pr-4">{formatPercent(item.return24h)}</td>
                      <td className="py-3 pr-4">{formatPercent(item.return72h)}</td>
                      <td className="py-3 pr-4">{formatPercent(item.maxProfitPct)}</td>
                      <td className="py-3 pr-0">{formatPercent(item.maxDrawdownPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
