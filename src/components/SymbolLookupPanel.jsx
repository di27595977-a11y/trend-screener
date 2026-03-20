import { useState } from 'react';
import PatternTags from './PatternTags';
import ScoreBadge from './ScoreBadge';
import Sparkline from './Sparkline';
import TradeAdvicePanel from './TradeAdvicePanel';
import { formatNumber, formatPrice } from './coinDisplayUtils';
import { analyzeSymbol, normalizeSymbolInput } from '../lib/symbolAnalysis';
import { buildBinanceChartUrl, buildTradingViewUrl } from '../services/binanceApi';

const COPY = {
  eyebrow: '自訂幣種分析',
  title: '沒上榜也能即時看目前狀態',
  description: '輸入 BTC、ETH 或完整合約代號，系統會即時分析 1H / 4H 是否接近上榜，並給出目前的形態與交易建議。',
  inputLabel: '查詢 Binance USDT-M 合約',
  inputPlaceholder: '輸入 BTC、ETHUSDT、DOGE...',
  inputHint: '系統會自動補成 USDT 合約，例如 BTC -> BTCUSDT',
  analyze: '立即分析',
  analyzing: '分析中...',
  currentPrice: '現價',
  openChart: '打開詳細圖',
  openBinance: '在 Binance 開啟',
  openTradingView: '在 TradingView 開啟',
  currentBoard: '目前榜單狀態',
  pendingBoard: '輸入幣種後即可分析',
  notRanked: '目前不在最新榜單',
  patterns: '72 根 1H 偵測形態',
  thresholds: '條件檢查',
  metrics: '核心數據',
  latestHit: '最近一次上榜',
  noLatestHit: '最近掃描未上榜',
};

const STATUS_STYLE = {
  passed: 'border-emerald-400/25 bg-emerald-400/12 text-emerald-50',
  near: 'border-amber-400/25 bg-amber-400/12 text-amber-50',
  failed: 'border-rose-400/25 bg-rose-400/12 text-rose-50',
};

const STATUS_LABEL = {
  passed: '符合條件',
  near: '接近上榜',
  failed: '未達條件',
};

function statusPill(status) {
  return STATUS_STYLE[status] || STATUS_STYLE.failed;
}

function boardText(matches) {
  if (matches == null) {
    return COPY.pendingBoard;
  }

  if (!matches?.length) {
    return COPY.notRanked;
  }

  return `目前在 ${matches.map((item) => item.toUpperCase()).join(' / ')} 榜上`;
}

function formatTime(value) {
  if (!value) {
    return '--';
  }

  return new Date(value).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MetricPill({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-sm text-white">{value}</p>
    </div>
  );
}

function CheckRow({ check }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3 text-sm text-slate-200">
      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${check.pass ? 'bg-emerald-300' : 'bg-rose-300'}`} />
      <span>{check.label}</span>
    </div>
  );
}

function TimeframeAnalysisCard({ analysis }) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 font-mono text-sm text-white">
            {analysis.timeframe.toUpperCase()}
          </span>
          <span className={`rounded-full border px-3 py-1 text-sm ${statusPill(analysis.status)}`}>{STATUS_LABEL[analysis.status]}</span>
          {analysis.matchedLatestScan ? (
            <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-sm text-sky-100">最新掃描已上榜</span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <ScoreBadge score={analysis.score} />
          <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2">
            <Sparkline values={analysis.sparkline} width={88} height={28} />
          </div>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-300">{analysis.summary}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-3">
        <MetricPill label={COPY.currentPrice} value={formatPrice(analysis.metrics.latestClose)} />
        <MetricPill label="R²" value={formatNumber(analysis.metrics.rSquared, 2)} />
        <MetricPill label="量比" value={`${formatNumber(analysis.metrics.volumeRatio, 2)}x`} />
        <MetricPill label="回調" value={`${formatNumber(analysis.metrics.pullbackRatio * 100, 1)}%`} />
        <MetricPill label="漲幅" value={`${formatNumber(analysis.metrics.priceChangePercent, 1)}%`} />
        <MetricPill label="位置" value={`${Math.round(analysis.metrics.positionScore * 100)}%`} />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-white">{COPY.thresholds}</p>
          <span className="text-xs text-slate-400">
            {analysis.latestCandidate?.createdAt ? `${COPY.latestHit} ${formatTime(analysis.latestCandidate.createdAt)}` : COPY.noLatestHit}
          </span>
        </div>
        <div className="space-y-2">
          {analysis.checks.map((check) => (
            <CheckRow key={`${analysis.timeframe}-${check.key}`} check={check} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function SymbolLookupPanel({ settings, status, onOpenChart }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const normalizedPreview = normalizeSymbolInput(query);

  async function handleAnalyze(event) {
    event.preventDefault();

    setLoading(true);
    setError('');

    try {
      const analysis = await analyzeSymbol(query, { settings, scannerStatus: status });
      setResult(analysis);
    } catch (analysisError) {
      setResult(null);
      setError(analysisError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel mb-6 rounded-[28px] px-5 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-sky-300/80">{COPY.eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">{COPY.title}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">{COPY.description}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          <p>{COPY.currentBoard}</p>
          <p className="mt-1 font-medium text-white">{boardText(result?.currentScanMatches)}</p>
        </div>
      </div>

      <form onSubmit={handleAnalyze} className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <label htmlFor="symbol-search" className="mb-2 block text-sm font-medium text-slate-100">
            {COPY.inputLabel}
          </label>
          <input
            id="symbol-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={COPY.inputPlaceholder}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-sky-400/45 sm:text-sm"
          />
          <p className="mt-2 text-xs text-slate-400">
            {normalizedPreview ? `${COPY.inputHint} / 將查詢：${normalizedPreview}` : COPY.inputHint}
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="self-end rounded-full border border-sky-400/35 bg-sky-400/12 px-5 py-3 text-sm font-medium text-sky-50 transition hover:border-sky-300/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? COPY.analyzing : COPY.analyze}
        </button>
      </form>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-5">
          <section className="rounded-[26px] border border-white/10 bg-slate-950/45 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-mono text-2xl font-semibold text-white">{result.symbol}</h3>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
                    {`${COPY.currentPrice} ${formatPrice(result.currentPrice)}`}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.currentScanMatches?.map((timeframe) => (
                    <span
                      key={timeframe}
                      className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-100"
                    >
                      {`最新 ${timeframe.toUpperCase()} 已上榜`}
                    </span>
                  ))}
                  {!result.currentScanMatches?.length ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">{COPY.notRanked}</span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:flex sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => onOpenChart?.(result.symbol)}
                  className="rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-sm font-medium text-emerald-50 transition hover:border-emerald-300/50"
                >
                  {COPY.openChart}
                </button>
                <a
                  href={buildBinanceChartUrl(result.symbol)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-center text-sm font-medium text-slate-100 transition hover:border-white/20"
                >
                  {COPY.openBinance}
                </a>
                <a
                  href={buildTradingViewUrl(result.symbol)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-center text-sm font-medium text-slate-100 transition hover:border-white/20"
                >
                  {COPY.openTradingView}
                </a>
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            {result.timeframes.map((analysis) => (
              <TimeframeAnalysisCard key={analysis.timeframe} analysis={analysis} />
            ))}
          </div>

          <section className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.patterns}</p>
            <div className="mt-3">
              <PatternTags patterns={result.detail.patterns} />
            </div>
          </section>

          <TradeAdvicePanel advice={result.detail.tradeAdvice} currentPrice={result.currentPrice} />
        </div>
      ) : null}
    </section>
  );
}
