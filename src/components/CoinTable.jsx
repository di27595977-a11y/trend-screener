import CoinRow from './CoinRow';

const HEADERS = [
  '\u5e63\u7a2e',
  '\u5206\u6578',
  'R\u00b2',
  '\u659c\u7387',
  '\u56de\u8abf',
  '\u91cf\u6bd4',
  '\u6f32\u5e45',
  '\u73fe\u50f9',
  '\u5f62\u614b',
  '\u5efa\u8b70',
  '\u8d70\u52e2',
];

export default function CoinTable({ rows, priceMap, onSelect }) {
  return (
    <section className="panel overflow-hidden rounded-[28px]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-white/8 bg-white/[0.03] text-left text-xs uppercase tracking-[0.24em] text-slate-400">
              {HEADERS.map((header) => (
                <th key={header} className="px-4 py-4 font-medium">
                  {header}
                </th>
              ))}
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
          {
            '\u76ee\u524d\u6c92\u6709\u7b26\u5408\u689d\u4ef6\u7684\u5e63\u7a2e\u3002\u4f60\u53ef\u4ee5\u964d\u4f4e\u5206\u6578\u9580\u6abb\uff0c\u6216\u8005\u91cd\u65b0\u89f8\u767c\u4e00\u6b21\u6383\u63cf\u3002'
          }
        </div>
      )}
    </section>
  );
}
