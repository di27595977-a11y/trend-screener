import { useState } from 'react';
import { getWinRate } from '../services/binanceApi';

const HOLD_OPTIONS = [
  { label: '1H',  hours: 1  },
  { label: '2H',  hours: 2  },
  { label: '4H',  hours: 4  },
  { label: '8H',  hours: 8  },
  { label: '12H', hours: 12 },
  { label: '1D',  hours: 24 },
  { label: '2D',  hours: 48 },
  { label: '3D',  hours: 72 },
];

function pct(v, decimals = 1) {
  if (v == null) return '--';
  return `${(v * 100).toFixed(decimals)}%`;
}

function formatPrice(v) {
  if (!v) return '--';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1)    return v.toFixed(4);
  return v.toFixed(6);
}

function WinRateGauge({ rate, label: sideLabel, color }) {
  const deg = rate != null ? rate * 180 : 0;
  const tone = color || (rate >= 0.55 ? '#34d399' : rate >= 0.45 ? '#fbbf24' : '#f87171');
  const label = rate >= 0.55 ? '偏多' : rate >= 0.45 ? '中性' : '偏空';
  return (
    <div className="flex flex-col items-center gap-1">
      {sideLabel && <p className="text-xs font-medium text-slate-400">{sideLabel}</p>}
      <div className="relative h-24 w-48 overflow-hidden">
        <div className="absolute bottom-0 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full border-[14px] border-white/8" />
        <div
          className="absolute bottom-0 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full border-[14px] transition-all duration-700"
          style={{
            borderColor: 'transparent',
            borderTopColor: tone,
            borderRightColor: deg >= 90 ? tone : 'transparent',
            transform: `rotate(${deg - 90}deg)`,
            transformOrigin: '50% 50%',
          }}
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 text-center">
          <p className="font-mono text-2xl font-bold" style={{ color: tone }}>
            {rate != null ? `${(rate * 100).toFixed(1)}%` : '--'}
          </p>
          <p className="text-[10px] text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone = 'slate' }) {
  const tones = {
    emerald: 'border-emerald-400/25 bg-emerald-400/8  text-emerald-200',
    rose:    'border-rose-400/25    bg-rose-400/8     text-rose-200',
    amber:   'border-amber-400/25   bg-amber-400/8    text-amber-200',
    violet:  'border-violet-400/25  bg-violet-400/8   text-violet-200',
    slate:   'border-white/10       bg-white/4        text-slate-200',
  };
  return (
    <div className={`rounded-2xl border px-3 py-3 ${tones[tone]}`}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className={`mt-1.5 font-mono text-base font-semibold ${tones[tone].split(' ')[2]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function SidePanel({ side, data, sampleCount }) {
  const isLong = side === 'long';
  const icon = isLong ? '📈' : '📉';
  const title = isLong ? '做多（Long）' : '做空（Short）';
  const borderColor = isLong ? 'border-emerald-400/20' : 'border-rose-400/20';
  const bgColor = isLong ? 'bg-emerald-400/5' : 'bg-rose-400/5';
  const gaugeColor = isLong ? '#34d399' : '#f87171';

  const ev = data?.expectedValue;
  const evTone = ev == null ? 'slate' : ev > 0 ? 'emerald' : 'rose';

  return (
    <div className={`rounded-2xl border ${borderColor} ${bgColor} px-4 py-4`}>
      <p className="mb-3 text-sm font-medium text-white">{icon} {title}</p>
      <WinRateGauge rate={data?.winRate} color={gaugeColor} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatCard
          label="勝率"
          value={pct(data?.winRate)}
          sub={`${sampleCount} 樣本`}
          tone={data?.winRate >= 0.55 ? 'emerald' : data?.winRate >= 0.45 ? 'amber' : 'rose'}
        />
        <StatCard
          label="期望值"
          value={pct(ev)}
          sub={ev > 0 ? '正期望' : '負期望'}
          tone={evTone}
        />
        <StatCard
          label="平均獲利"
          value={`+${pct(data?.avgGain)}`}
          sub={`最高 +${pct(data?.maxGain)}`}
          tone="emerald"
        />
        <StatCard
          label="平均虧損"
          value={`-${pct(data?.avgLoss)}`}
          sub={`最大 -${pct(data?.maxLoss)}`}
          tone="rose"
        />
      </div>
      {/* Profit factor */}
      <div className="mt-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">獲利因子</span>
          <span className="font-mono text-white">
            {data?.avgLoss > 0
              ? ((data.winRate * data.avgGain) / ((1 - data.winRate) * data.avgLoss)).toFixed(2)
              : '∞'}
          </span>
        </div>
      </div>
    </div>
  );
}

function MlSignal({ score, direction, prob }) {
  if (score == null) return null;
  const arrow = direction === 1 ? '↑' : direction === -1 ? '↓' : '→';
  const tone  = direction === 1 ? 'text-emerald-300' : direction === -1 ? 'text-rose-300' : 'text-slate-300';
  const label = direction === 1 ? '看多' : direction === -1 ? '看空' : '中性';
  return (
    <div className="mt-5 rounded-2xl border border-violet-400/25 bg-violet-400/8 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.24em] text-violet-300/80">ML 即時預測</p>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className={`font-mono text-3xl font-bold ${tone}`}>{arrow} {score}</span>
          <span className={`text-sm ${tone}`}>{label}</span>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-slate-300">信心度 {prob != null ? pct(prob) : '--'}</p>
          <p className="text-xs text-slate-500">ML Score 0-100</p>
        </div>
      </div>
    </div>
  );
}

export default function WinRateCalculator() {
  const [symbol, setSymbol] = useState('');
  const [hours,  setHours]  = useState(4);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,  setError]  = useState(null);

  async function handleCalculate() {
    let sym = symbol.trim().toUpperCase();
    if (!sym) return;
    if (!sym.endsWith('USDT')) sym = sym + 'USDT';
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await getWinRate(sym, hours);
      setResult(data);
    } catch (e) {
      setError(e.message || '計算失敗，請確認幣種名稱是否正確');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleCalculate();
  }

  // Support both new (long/short) and old (flat) response formats
  const longData  = result?.long  || result;
  const shortData = result?.short || null;

  return (
    <div className="mx-auto max-w-2xl">
      <section className="panel rounded-[28px] px-5 py-6">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">勝率計算機</p>
        <h2 className="mt-2 text-xl font-semibold text-white">持倉勝率分析</h2>
        <p className="mt-1 text-sm text-slate-400">
          根據近 90 天歷史數據，分別計算做多與做空在指定持有時間內的勝率與期望值。
        </p>

        {/* Input Row */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="輸入幣種，例如 BTC 或 BTCUSDT"
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-400/50 focus:bg-white/8"
          />
          <button
            type="button"
            onClick={handleCalculate}
            disabled={loading || !symbol.trim()}
            className="inline-flex items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-400/12 px-6 py-3 text-sm font-medium text-emerald-50 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '計算中...' : '計算'}
          </button>
        </div>

        {/* Holding period selector */}
        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-400">持有時間</p>
          <div className="flex flex-wrap gap-2">
            {HOLD_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                onClick={() => setHours(opt.hours)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  hours === opt.hours
                    ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-100'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>
        )}
      </section>

      {/* Results */}
      {result && (
        <section className="panel mt-4 rounded-[28px] px-5 py-6">
          {/* Symbol + price header */}
          <div className="mb-5 flex items-baseline justify-between">
            <div>
              <span className="font-mono text-xl font-bold text-white">{result.symbol}</span>
              <span className="ml-2 text-sm text-slate-400">持有 {result.hours}H</span>
            </div>
            <span className="font-mono text-lg text-slate-200">${formatPrice(result.currentPrice)}</span>
          </div>

          {/* Long vs Short side-by-side */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SidePanel side="long" data={longData} sampleCount={longData?.sampleCount} />
            {shortData && (
              <SidePanel side="short" data={shortData} sampleCount={shortData?.sampleCount} />
            )}
          </div>

          {/* Quick comparison bar */}
          {shortData && (
            <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">做多 vs 做空 快速比較</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-300">做多 {pct(longData?.winRate)}</span>
                  <div className="mx-3 flex-1">
                    <div className="relative h-2 rounded-full bg-white/8 overflow-hidden">
                      <div
                        className="absolute left-0 top-0 h-full rounded-full bg-emerald-400/60 transition-all duration-500"
                        style={{ width: `${(longData?.winRate || 0) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-rose-300">{pct(shortData?.winRate)} 做空</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-300">EV {pct(longData?.expectedValue)}</span>
                  <span className="text-xs text-slate-500">期望值</span>
                  <span className="text-rose-300">EV {pct(shortData?.expectedValue)}</span>
                </div>
                {longData?.expectedValue != null && shortData?.expectedValue != null && (
                  <p className="text-center text-xs font-medium" style={{
                    color: longData.expectedValue > shortData.expectedValue ? '#34d399' :
                           shortData.expectedValue > longData.expectedValue ? '#f87171' : '#94a3b8'
                  }}>
                    {longData.expectedValue > shortData.expectedValue
                      ? '⬆ 做多期望值較高'
                      : shortData.expectedValue > longData.expectedValue
                      ? '⬇ 做空期望值較高'
                      : '⚖ 多空期望值相當'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Funding Rate Analysis */}
          {result.funding && (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.24em] text-amber-300/80">資金費率條件勝率</p>
                {result.currentFunding != null && (
                  <span className={`font-mono text-xs ${result.currentFunding > 0 ? 'text-rose-300' : result.currentFunding < 0 ? 'text-emerald-300' : 'text-slate-400'}`}>
                    當前費率 {(result.currentFunding * 100).toFixed(4)}%
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: '費率 > 0（多方付空）', key: 'positive',    hint: '市場偏多頭情緒' },
                  { label: '費率 < 0（空方付多）', key: 'negative',    hint: '市場偏空頭情緒' },
                  { label: '費率 > +0.05%（極端多）', key: 'extremeHigh', hint: '過熱警訊' },
                  { label: '費率 < -0.01%（負費率）', key: 'extremeLow',  hint: '超賣機會' },
                ].map(({ label, key, hint }) => {
                  const d  = result.funding[key];
                  const longWr  = d?.long;
                  const shortWr = d?.short;
                  const n  = d?.sampleCount ?? 0;
                  return (
                    <div key={key} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                      <p className="text-[10px] text-slate-400">{label}</p>
                      <div className="mt-1 flex items-center gap-3">
                        <div>
                          <p className="text-[9px] text-emerald-400/70">做多</p>
                          <p className={`font-mono text-sm font-semibold ${longWr == null ? 'text-slate-500' : longWr >= 0.55 ? 'text-emerald-300' : longWr >= 0.45 ? 'text-amber-300' : 'text-rose-300'}`}>
                            {longWr != null ? `${(longWr * 100).toFixed(1)}%` : '--'}
                          </p>
                        </div>
                        <div className="h-6 w-px bg-white/10" />
                        <div>
                          <p className="text-[9px] text-rose-400/70">做空</p>
                          <p className={`font-mono text-sm font-semibold ${shortWr == null ? 'text-slate-500' : shortWr >= 0.55 ? 'text-emerald-300' : shortWr >= 0.45 ? 'text-amber-300' : 'text-rose-300'}`}>
                            {shortWr != null ? `${(shortWr * 100).toFixed(1)}%` : '--'}
                          </p>
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {n >= 10 ? `${n} 樣本・${hint}` : n > 0 ? `${n} 樣本（不足）` : '無資料'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ML Signal */}
          <MlSignal
            score={result.mlScore}
            direction={result.mlDirection}
            prob={result.mlProb}
          />

          <p className="mt-4 text-xs text-slate-500">
            * 勝率基於近 90 天 1H 歷史 K 線統計，不包含手續費與滑點。歷史表現不代表未來結果。
          </p>
        </section>
      )}
    </div>
  );
}
