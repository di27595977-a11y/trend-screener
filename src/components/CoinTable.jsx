import CoinRow from './CoinRow';

export default function CoinTable({ rows, priceMap, onSelect }) {
  return (
    <section className="panel overflow-hidden rounded-[28px]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-white/8 bg-white/[0.03] text-left text-xs uppercase tracking-[0.24em] text-slate-400">
              <th className="px-4 py-4 font-medium">Symbol</th>
              <th className="px-4 py-4 font-medium">Score</th>
              <th className="px-4 py-4 font-medium">R2</th>
              <th className="px-4 py-4 font-medium">Slope</th>
              <th className="px-4 py-4 font-medium">Pullback</th>
              <th className="px-4 py-4 font-medium">Vol</th>
              <th className="px-4 py-4 font-medium">Change</th>
              <th className="px-4 py-4 font-medium">Live</th>
              <th className="px-4 py-4 font-medium">Patterns</th>
              <th className="px-4 py-4 font-medium">Spark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((coin) => (
              <CoinRow key={`${coin.symbol}-${coin.timeframe}`} coin={coin} livePrice={priceMap[coin.symbol]} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
      </div>

      {!rows.length && (
        <div className="px-6 py-12 text-center text-sm text-slate-300">
          No symbols match the current filter yet. Lower the score floor or trigger a fresh scan.
        </div>
      )}
    </section>
  );
}
