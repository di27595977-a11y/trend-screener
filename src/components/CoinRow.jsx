import ScoreBadge from './ScoreBadge';
import PatternTags from './PatternTags';
import Sparkline from './Sparkline';

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return Number(value).toFixed(digits);
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  if (value >= 1000) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export default function CoinRow({ coin, livePrice, onSelect }) {
  const currentPrice = livePrice?.price ?? coin.currentPrice ?? coin.entryPrice;
  const liveChange = livePrice?.change24h ?? coin.priceChangePct;
  const changeTone = liveChange >= 0 ? 'text-emerald-200' : 'text-rose-200';

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
        <Sparkline values={coin.sparkline} />
      </td>
    </tr>
  );
}
