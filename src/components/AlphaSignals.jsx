import { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '../services/supabaseClient';

const ALERT_TYPE_LABEL = {
  volume_spike: '量能異常',
  price_move: '價格異動',
  volatility_burst: '波動爆發',
  bb_squeeze: 'BB 擠壓',
  signal_new: '新訊號',
  signal_approved: '已核准',
  signal_executed: '已執行',
  signal_rejected: '已拒絕',
  signal_expired: '已失效',
  trade_closed: '已平倉',
};

const DIRECTION_COLOR = {
  bull: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
  bear: 'text-rose-300 bg-rose-400/10 border-rose-400/30',
};

const TREND_COLOR = {
  strong_bull: 'text-emerald-400',
  bull: 'text-emerald-300',
  neutral: 'text-slate-400',
  bear: 'text-rose-300',
  strong_bear: 'text-rose-400',
  new: 'text-sky-300',
  approved: 'text-emerald-300',
  executed: 'text-emerald-400',
  rejected: 'text-rose-300',
  expired: 'text-amber-300',
  closed: 'text-slate-300',
};

const TYPE_OPTIONS = [
  ['all', '全部類型'],
  ['volume_spike', '量能異常'],
  ['price_move', '價格異動'],
  ['volatility_burst', '波動爆發'],
  ['bb_squeeze', 'BB 擠壓'],
  ['signal_new', '新訊號'],
  ['signal_approved', '已核准'],
  ['signal_executed', '已執行'],
  ['signal_rejected', '已拒絕'],
  ['signal_expired', '已失效'],
  ['trade_closed', '已平倉'],
];

function qualityColor(quality) {
  if (quality >= 80) return 'text-emerald-300';
  if (quality >= 65) return 'text-yellow-300';
  return 'text-slate-400';
}

function formatTime(iso) {
  if (!iso) return '--';
  const date = new Date(iso);
  return date.toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatPrice(price) {
  if (price == null || Number.isNaN(Number(price))) return '--';
  const value = Number(price);
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function directionLabel(direction) {
  return direction === 'bear' ? '空方' : '多方';
}

function SignalRow({ signal, onSelect }) {
  const directionClass = DIRECTION_COLOR[signal.direction] || 'text-slate-400 bg-white/5 border-white/10';
  const trendClass = TREND_COLOR[signal.trend] || 'text-slate-400';
  const typeLabel = ALERT_TYPE_LABEL[signal.alert_type] || signal.alert_type;

  return (
    <tr
      onClick={() => onSelect(signal)}
      className="cursor-pointer border-b border-white/5 transition hover:bg-white/[0.04]"
    >
      <td className="px-4 py-3 font-mono text-sm font-semibold text-white whitespace-nowrap">
        {signal.symbol}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${directionClass}`}>
          {directionLabel(signal.direction)}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-slate-300">{typeLabel}</td>
      <td className={`px-4 py-3 font-mono text-sm font-semibold ${qualityColor(signal.quality)}`}>
        {signal.quality ?? '--'}
      </td>
      <td className={`px-4 py-3 text-xs ${trendClass}`}>{signal.trend || '—'}</td>
      <td className="px-4 py-3 font-mono text-xs text-slate-300">{formatPrice(signal.price)}</td>
      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatTime(signal.created_at)}</td>
    </tr>
  );
}

function MessageModal({ signal, onClose }) {
  if (!signal) return null;

  const directionClass = DIRECTION_COLOR[signal.direction] || 'text-slate-400 bg-white/5 border-white/10';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-lg leading-none text-slate-400 hover:text-white"
        >
          ×
        </button>
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-white">{signal.symbol}</span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${directionClass}`}>
            {directionLabel(signal.direction)}
          </span>
          <span className={`font-semibold ${qualityColor(signal.quality)}`}>{signal.quality ?? '--'} 分</span>
        </div>
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-4 font-mono text-xs leading-relaxed text-slate-200">
          {signal.message || '目前沒有更多說明。'}
        </pre>
        <p className="mt-3 text-right text-xs text-slate-500">
          {signal.created_at ? new Date(signal.created_at).toLocaleString('zh-TW') : '--'}
        </p>
      </div>
    </div>
  );
}

const SUPABASE = createSupabaseClient();
const POLL_INTERVAL = 30_000;

export default function AlphaSignals() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState({
    direction: 'all',
    type: 'all',
    minQuality: 0,
  });
  const timerRef = useRef(null);

  async function fetchSignals() {
    try {
      let data;
      try {
        const response = await fetch('/api/alpha-signals?limit=200');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        data = await response.json();
      } catch (apiError) {
        if (!SUPABASE) {
          throw apiError;
        }
        const { data: rows, error: supabaseError } = await SUPABASE
          .from('alpha_signals')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (supabaseError) throw supabaseError;
        data = rows || [];
      }
      setSignals(data);
      setError(null);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSignals();
    timerRef.current = setInterval(fetchSignals, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, []);

  const filtered = signals.filter((signal) => {
    if (filter.direction !== 'all' && signal.direction !== filter.direction) return false;
    if (filter.type !== 'all' && signal.alert_type !== filter.type) return false;
    if (Number(signal.quality ?? 0) < filter.minQuality) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <MessageModal signal={selected} onClose={() => setSelected(null)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Alpha 交易核心訊號面板</h2>
          <p className="mt-0.5 text-xs text-slate-400">每 30 秒更新，目前顯示 {filtered.length} 筆</p>
        </div>
        <button
          onClick={fetchSignals}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:border-emerald-300/40 hover:text-white"
        >
          重新整理
        </button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-2xl border border-white/8 bg-slate-900/50 p-4">
        <select
          value={filter.direction}
          onChange={(event) => setFilter((current) => ({ ...current, direction: event.target.value }))}
          className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          <option value="all">全部方向</option>
          <option value="bull">多方</option>
          <option value="bear">空方</option>
        </select>
        <select
          value={filter.type}
          onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value }))}
          className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          {TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filter.minQuality}
          onChange={(event) => setFilter((current) => ({ ...current, minQuality: Number(event.target.value) }))}
          className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          <option value={0}>最低分數 0</option>
          <option value={65}>最低分數 65</option>
          <option value={75}>最低分數 75</option>
          <option value={85}>最低分數 85</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/8 bg-slate-900/50">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">讀取中…</div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-rose-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-500">目前沒有符合條件的 Alpha 訊號。</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/8 text-left text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">幣種</th>
                <th className="px-4 py-3 font-medium">方向</th>
                <th className="px-4 py-3 font-medium">類型</th>
                <th className="px-4 py-3 font-medium">分數</th>
                <th className="px-4 py-3 font-medium">狀態</th>
                <th className="px-4 py-3 font-medium">價格</th>
                <th className="px-4 py-3 font-medium">時間</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((signal) => (
                <SignalRow key={signal.id} signal={signal} onSelect={setSelected} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
