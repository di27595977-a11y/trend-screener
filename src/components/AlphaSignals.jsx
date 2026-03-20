import { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '../services/supabaseClient';

const ALERT_TYPE_LABEL = {
  volume_spike:      '爆量',
  price_move:        '價格移動',
  volatility_burst:  '波動爆發',
  bb_squeeze:        'BB收窄突破',
};

const DIRECTION_COLOR = {
  bull: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
  bear: 'text-rose-300 bg-rose-400/10 border-rose-400/30',
};

const TREND_COLOR = {
  strong_bull: 'text-emerald-400',
  bull:        'text-emerald-300',
  neutral:     'text-slate-400',
  bear:        'text-rose-300',
  strong_bear: 'text-rose-400',
};

function qualityColor(q) {
  if (q >= 80) return 'text-emerald-300';
  if (q >= 65) return 'text-yellow-300';
  return 'text-slate-400';
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatPrice(p) {
  if (!p) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(4);
  return p.toFixed(6);
}

function SignalRow({ s, onSelect }) {
  const dirCls  = DIRECTION_COLOR[s.direction] || 'text-slate-400 bg-white/5 border-white/10';
  const trendCls = TREND_COLOR[s.trend] || 'text-slate-400';
  const typeLabel = ALERT_TYPE_LABEL[s.alert_type] || s.alert_type;

  return (
    <tr
      onClick={() => onSelect(s)}
      className="cursor-pointer border-b border-white/5 transition hover:bg-white/[0.04]"
    >
      <td className="px-4 py-3 font-mono text-sm font-semibold text-white whitespace-nowrap">
        {s.symbol}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${dirCls}`}>
          {s.direction === 'bull' ? '▲ 做多' : '▼ 做空'}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-slate-300">{typeLabel}</td>
      <td className={`px-4 py-3 font-mono text-sm font-semibold ${qualityColor(s.quality)}`}>
        {s.quality}
      </td>
      <td className={`px-4 py-3 text-xs ${trendCls}`}>
        {s.trend || '—'}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-300">
        {formatPrice(s.price)}
      </td>
      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
        {formatTime(s.created_at)}
      </td>
    </tr>
  );
}

function MessageModal({ signal, onClose }) {
  if (!signal) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-white text-lg leading-none"
        >
          ✕
        </button>
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-white">{signal.symbol}</span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${DIRECTION_COLOR[signal.direction] || ''}`}>
            {signal.direction === 'bull' ? '▲ 做多' : '▼ 做空'}
          </span>
          <span className={`font-semibold ${qualityColor(signal.quality)}`}>
            {signal.quality} 分
          </span>
        </div>
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-4 font-mono text-xs text-slate-200 leading-relaxed">
          {signal.message || '（無訊息內容）'}
        </pre>
        <p className="mt-3 text-right text-xs text-slate-500">
          {new Date(signal.created_at).toLocaleString('zh-TW')}
        </p>
      </div>
    </div>
  );
}

const SUPABASE = createSupabaseClient();
const POLL_INTERVAL = 30_000;  // 每 30 秒更新

export default function AlphaSignals() {
  const [signals, setSignals]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [selected, setSelected]   = useState(null);
  const [filter, setFilter]       = useState({ direction: 'all', type: 'all', minQuality: 0 });
  const timerRef = useRef(null);

  async function fetchSignals() {
    try {
      let data;
      if (SUPABASE) {
        const { data: rows, error: err } = await SUPABASE
          .from('alpha_signals')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (err) throw err;
        data = rows || [];
      } else {
        const resp = await fetch('/api/alpha-signals?limit=200');
        data = await resp.json();
      }
      setSignals(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSignals();
    timerRef.current = setInterval(fetchSignals, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, []);

  const filtered = signals.filter((s) => {
    if (filter.direction !== 'all' && s.direction !== filter.direction) return false;
    if (filter.type !== 'all' && s.alert_type !== filter.type) return false;
    if (s.quality < filter.minQuality) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <MessageModal signal={selected} onClose={() => setSelected(null)} />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Alpha Matrix 即時訊號</h2>
          <p className="text-xs text-slate-400 mt-0.5">每 30 秒自動更新 · 共 {filtered.length} 筆</p>
        </div>
        <button
          onClick={fetchSignals}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:border-emerald-300/40 hover:text-white transition"
        >
          ↻ 刷新
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-2xl border border-white/8 bg-slate-900/50 p-4">
        <select
          value={filter.direction}
          onChange={(e) => setFilter((f) => ({ ...f, direction: e.target.value }))}
          className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          <option value="all">全部方向</option>
          <option value="bull">▲ 做多</option>
          <option value="bear">▼ 做空</option>
        </select>
        <select
          value={filter.type}
          onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}
          className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          <option value="all">全部類型</option>
          <option value="volume_spike">爆量</option>
          <option value="price_move">價格移動</option>
          <option value="volatility_burst">波動爆發</option>
          <option value="bb_squeeze">BB收窄突破</option>
        </select>
        <select
          value={filter.minQuality}
          onChange={(e) => setFilter((f) => ({ ...f, minQuality: Number(e.target.value) }))}
          className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          <option value={0}>品質 ≥ 0</option>
          <option value={65}>品質 ≥ 65</option>
          <option value={75}>品質 ≥ 75</option>
          <option value={85}>品質 ≥ 85</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-slate-900/50">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">載入中…</div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-rose-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-500">尚無訊號（等候 Alpha Matrix 推送）</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/8 text-left text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">幣種</th>
                <th className="px-4 py-3 font-medium">方向</th>
                <th className="px-4 py-3 font-medium">類型</th>
                <th className="px-4 py-3 font-medium">品質</th>
                <th className="px-4 py-3 font-medium">趨勢</th>
                <th className="px-4 py-3 font-medium">現價</th>
                <th className="px-4 py-3 font-medium">時間</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <SignalRow key={s.id} s={s} onSelect={setSelected} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
