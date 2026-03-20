import PatternTags from './PatternTags';
import ScoreBadge from './ScoreBadge';
import Sparkline from './Sparkline';
import TradeSignalBadge from './TradeSignalBadge';
import { generateTradeAdvice } from '../lib/tradeAdvisor';
import { buildFallbackLevels, formatNumber, formatPrice, parsePatternSummary } from './coinDisplayUtils';

function StatItem({ label, value, tone = 'text-slate-200' }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className={`mt-1 font-mono text-sm ${tone}`}>{value}</p>
    </div>
  );
}

export default function CoinCard({ coin, livePrice, onSelect }) {
  const currentPrice = livePrice?.price ?? coin.currentPrice ?? coin.entryPrice;
  const liveChange = livePrice?.change24h ?? coin.priceChangePct;
  const changeTone = liveChange >= 0 ? 'text-emerald-200' : 'text-rose-200';
  const fallbackLevels = buildFallbackLevels(coin.sparkline, currentPrice);
  const advice = generateTradeAdvice({
    currentPrice,
    positionScore: coin.positionScore,
    score: coin.trendScore,
    priceChangePercent: liveChange,
    patterns: parsePatternSummary(coin.detectedPatterns),
    supportLevels: fallbackLevels.supportLevels,
    resistanceLevels: fallbackLevels.resistanceLevels,
    pullbackRatio: coin.pullbackRatio,
    rSquared: coin.rSquared,
    volumeRatio: coin.volumeRatio,
  });

  return (
    <button
      type="button"
      onClick={() => onSelect?.(coin)}
      className="w-full border-b border-white/8 px-4 py-4 text-left transition active:scale-[0.995] active:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-lg font-semibold text-white">{coin.symbol}</h3>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300">
              {coin.timeframe.toUpperCase()}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ScoreBadge score={coin.trendScore} />
            <TradeSignalBadge direction={advice.direction} confidence={advice.confidence} />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-lg text-white">{formatPrice(currentPrice)}</p>
          <p className={`mt-1 font-mono text-sm ${changeTone}`}>{formatNumber(liveChange, 2)}%</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatItem label="R²" value={formatNumber(coin.rSquared, 2)} />
        <StatItem label="量比" value={`${formatNumber(coin.volumeRatio, 2)}x`} />
        <StatItem label="斜率" value={`${formatNumber(coin.slopePctPerBar, 3)}%`} />
        <StatItem label="回調" value={`${formatNumber(coin.pullbackRatio * 100, 1)}%`} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">形態</p>
          <PatternTags patterns={coin.detectedPatterns} />
        </div>
        <div className="shrink-0 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2">
          <Sparkline values={coin.sparkline} width={96} height={32} />
        </div>
      </div>
    </button>
  );
}
