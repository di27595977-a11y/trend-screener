import ScoreBadge from './ScoreBadge';
import PatternTags from './PatternTags';
import RangeSignalBadge from './RangeSignalBadge';
import Sparkline from './Sparkline';
import TradeSignalBadge from './TradeSignalBadge';
import { generateTradeAdvice } from '../lib/tradeAdvisor';
import { buildFallbackLevels, formatNumber, formatPrice, parsePatternSummary } from './coinDisplayUtils';

function MlScoreBadge({ score, direction }) {
  if (score == null) {
    return <span className="font-mono text-xs text-slate-500">—</span>;
  }
  const arrow = direction === 1 ? '↑' : direction === -1 ? '↓' : '→';
  const tone  = direction === 1 ? 'text-emerald-300' : direction === -1 ? 'text-rose-300' : 'text-slate-300';
  return (
    <span className={`font-mono text-sm ${tone}`}>
      {arrow} {score}
    </span>
  );
}

export default function CoinRow({ coin, livePrice, rangeSignal, onSelect }) {
  const currentPrice = livePrice?.price ?? coin.currentPrice ?? coin.entryPrice;
  const liveChange = livePrice?.change24h ?? coin.priceChangePct;
  const changeTone = liveChange >= 0 ? 'text-emerald-200' : 'text-rose-200';
  const fallbackLevels = buildFallbackLevels(coin.sparkline, currentPrice);
  const advice = generateTradeAdvice({
    currentPrice,
    positionScore: coin.setupSide === 'short' ? 1 - coin.positionScore : coin.positionScore,
    score: coin.trendScore,
    priceChangePercent: liveChange,
    patterns: parsePatternSummary(coin.detectedPatterns),
    supportLevels: fallbackLevels.supportLevels,
    resistanceLevels: fallbackLevels.resistanceLevels,
    pullbackRatio: coin.pullbackRatio,
    rSquared: coin.rSquared,
    volumeRatio: coin.volumeRatio,
    modelBias: coin.setupSide || 'long',
  });

  return (
    <tr
      onClick={() => onSelect?.(coin)}
      className="cursor-pointer border-b border-white/6 transition hover:bg-white/[0.04]"
    >
      <td className="px-4 py-4">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold text-white">{coin.symbol}</span>
          <span className="text-xs text-slate-400">{coin.timeframe.toUpperCase()}</span>
        </div>
      </td>
      <td className="px-4 py-4">
        <ScoreBadge score={coin.trendScore} />
      </td>
      <td className="px-4 py-4 font-mono text-sm text-slate-200">{formatNumber(coin.rSquared, 2)}</td>
      <td className="px-4 py-4 font-mono text-sm text-slate-200">{formatNumber(coin.slopePctPerBar, 3)}%</td>
      <td className="px-4 py-4 font-mono text-sm text-slate-200">{formatNumber(coin.pullbackRatio * 100, 1)}%</td>
      <td className="px-4 py-4 font-mono text-sm text-slate-200">{formatNumber(coin.volumeRatio, 2)}x</td>
      <td className={`px-4 py-4 font-mono text-sm ${changeTone}`}>{formatNumber(liveChange, 2)}%</td>
      <td className="px-4 py-4 font-mono text-sm text-white">{formatPrice(currentPrice)}</td>
      <td className="min-w-[240px] px-4 py-4">
        <PatternTags patterns={coin.detectedPatterns} />
      </td>
      <td className="px-4 py-4">
        <TradeSignalBadge direction={advice.direction} confidence={advice.confidence} />
      </td>
      <td className="px-4 py-4">
        <MlScoreBadge score={coin.mlScore} direction={coin.mlDirection} />
      </td>
      <td className="px-4 py-4">
        <RangeSignalBadge signal={rangeSignal} />
      </td>
      <td className="px-4 py-4">
        <Sparkline values={coin.sparkline} />
      </td>
    </tr>
  );
}
