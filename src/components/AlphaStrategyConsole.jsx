import { startTransition, useEffect, useState } from 'react';
import {
  applyAlphaStrategies,
  getAlphaStrategies,
  getTradableSymbols,
  runAlphaStrategyBacktest,
  saveAlphaStrategy,
} from '../services/binanceApi';

/* ── 常數 ──────────────────────────────────────────── */

const BACKTEST_SYMBOL_MODES = [
  ['top_n', '成交量前 N 名'],
  ['manual', '手動指定'],
  ['strategy_allowed', '策略允許清單'],
];

const TIMEFRAMES = ['15m', '1h', '4h'];

const PARAM_TYPES = [
  ['number', '數字'],
  ['string', '文字'],
  ['boolean', '布林'],
  ['array', '陣列'],
  ['object', '物件'],
];

/* ── 工具函數 ──────────────────────────────────────── */

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function inferType(v) {
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v && typeof v === 'object') return 'object';
  return 'string';
}

function fmtVal(v, t) {
  if (t === 'array' || t === 'object') return JSON.stringify(v ?? (t === 'array' ? [] : {}), null, 2);
  return v == null ? '' : String(v);
}

function parseVal(raw, t) {
  const s = String(raw ?? '').trim();
  if (t === 'number') { const n = Number(s); if (!Number.isFinite(n)) throw new Error(`數字格式錯誤: ${raw}`); return n; }
  if (t === 'boolean') { if (s === 'true') return true; if (s === 'false') return false; throw new Error('請填 true 或 false'); }
  if (t === 'array') { const a = JSON.parse(s || '[]'); if (!Array.isArray(a)) throw new Error('陣列格式錯誤'); return a; }
  if (t === 'object') { const o = JSON.parse(s || '{}'); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('物件格式錯誤'); return o; }
  return raw ?? '';
}

function splitList(text) {
  return [...new Set(String(text ?? '').split(/\r?\n|,/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

function toRows(params = {}) {
  return Object.entries(params).map(([key, value]) => {
    const type = inferType(value);
    return { id: uid(), key, type, val: fmtVal(value, type) };
  });
}

function specToDraft(entry) {
  const s = entry?.spec || {};
  const bt = s.backtest || {};
  return {
    fileName: entry?.file_name || '',
    strategyId: s.strategy_id || '',
    thesis: s.thesis || '',
    marketType: s.market_type || '',
    setupName: s.setup_name || '',
    triggerName: s.trigger_name || '',
    invalidation: s.invalidation || '',
    exitPlan: s.exit_plan || '',
    status: s.status || 'candidate',
    enabled: s.enabled !== false,
    tf: { trend: s.timeframes?.trend || '4h', setup: s.timeframes?.setup || '1h', trigger: s.timeframes?.trigger || '15m' },
    allowedText: (s.allowed_symbols || []).join('\n'),
    blockedText: (s.blocked_symbols || []).join('\n'),
    risk: String(s.risk_per_trade ?? 0.005),
    leverage: String(s.leverage ?? 5),
    minScore: String(s.min_score ?? 55),
    bt: {
      tf: bt.timeframe || s.timeframes?.trigger || '15m',
      days: String(bt.lookback_days || 60),
      mode: bt.symbol_mode || (s.allowed_symbols?.length ? 'strategy_allowed' : 'top_n'),
      topN: String(bt.top_n || 20),
      symbols: Array.isArray(bt.symbols) ? bt.symbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : [],
    },
    notes: (s.notes || []).join('\n'),
    tags: JSON.stringify(s.tags || {}, null, 2),
    paramRows: toRows(s.params),
  };
}

function draftToSpec(d) {
  const params = {};
  d.paramRows.forEach((r) => { const k = r.key.trim(); if (k) params[k] = parseVal(r.val, r.type); });
  const risk = Number(d.risk); if (!Number.isFinite(risk) || risk <= 0) throw new Error('每筆風險必須大於 0');
  const lev = Number(d.leverage); if (!Number.isFinite(lev) || lev <= 0) throw new Error('槓桿必須大於 0');
  const ms = Number(d.minScore); if (!Number.isFinite(ms) || ms < 0 || ms > 100) throw new Error('最低分數 0~100');
  const days = Number(d.bt.days); if (!Number.isFinite(days) || days <= 0) throw new Error('回測天數必須大於 0');
  const topN = Number(d.bt.topN);
  if (d.bt.mode === 'top_n' && (!Number.isFinite(topN) || topN <= 0)) throw new Error('前 N 名必須大於 0');
  if (d.bt.mode === 'manual' && !d.bt.symbols.length) throw new Error('手動模式至少要選 1 個幣');
  return {
    strategy_id: d.strategyId.trim(), thesis: d.thesis.trim(), market_type: d.marketType.trim(),
    setup_name: d.setupName.trim(), trigger_name: d.triggerName.trim(),
    invalidation: d.invalidation.trim(), exit_plan: d.exitPlan.trim(),
    status: d.status, enabled: d.enabled,
    timeframes: { trend: d.tf.trend, setup: d.tf.setup, trigger: d.tf.trigger },
    allowed_symbols: splitList(d.allowedText), blocked_symbols: splitList(d.blockedText),
    risk_per_trade: risk, leverage: Math.round(lev), min_score: Math.round(ms), params,
    backtest: { enabled: true, timeframe: d.bt.tf, lookback_days: Math.round(days), symbol_mode: d.bt.mode, symbols: d.bt.symbols, top_n: Math.round(topN) },
    tags: (() => { try { return JSON.parse(d.tags || '{}'); } catch { return {}; } })(),
    notes: d.notes.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
  };
}

/* ── 小元件 ────────────────────────────────────────── */

const input = 'w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50';
const monoInput = `${input} font-mono`;
const pillBtn = 'rounded-full border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50';

function Lbl({ text, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm text-slate-300">
        <span>{text}</span>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Metric({ label, value, good }) {
  const tone = good === true ? 'text-emerald-300' : good === false ? 'text-rose-300' : 'text-white';
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-center">
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function pct(v, d = 1) { return v == null || Number.isNaN(v) ? '--' : `${(v * 100).toFixed(d)}%`; }
function money(v) { return v == null || Number.isNaN(v) ? '--' : v.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* ── 回測結果面板 ──────────────────────────────────── */

function BacktestPanel({ job }) {
  if (!job) return null;

  const s = job.result?.summary;
  const status = { completed: '已完成', failed: '失敗', running: '執行中', pending: '排隊中' }[job.status] || job.status;
  const statusColor = { completed: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10', failed: 'text-rose-300 border-rose-400/30 bg-rose-400/10', running: 'text-sky-300 border-sky-400/30 bg-sky-400/10' }[job.status] || 'text-amber-300 border-amber-400/30 bg-amber-400/10';

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-200">回測結果</h3>
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs ${statusColor}`}>{status}</span>
      </div>

      {s ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Metric label="交易數" value={s.total_trades ?? '--'} />
          <Metric label="勝率" value={pct(s.win_rate)} good={s.win_rate > 0.45} />
          <Metric label="獲利因子" value={s.profit_factor?.toFixed(2) ?? '--'} good={s.profit_factor > 1} />
          <Metric label="淨損益" value={money(s.net_pnl)} good={s.net_pnl > 0} />
          <Metric label="最大回撤" value={pct(s.max_drawdown)} good={false} />
        </div>
      ) : null}

      {job.error ? <p className="rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{job.error}</p> : null}

      {Array.isArray(job.result?.symbols) && job.result.symbols.length ? (
        <p className="text-xs text-slate-500">幣種：{job.result.symbols.join(', ')}</p>
      ) : null}
    </div>
  );
}

/* ── 主元件 ────────────────────────────────────────── */

export default function AlphaStrategyConsole() {
  const [state, setState] = useState(null);
  const [selFile, setSelFile] = useState('');
  const [draft, setDraft] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [picker, setPicker] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingBt, setPendingBt] = useState('');
  const [localBt, setLocalBt] = useState(null);
  const [showAdv, setShowAdv] = useState(false);

  /* 載入策略列表 */
  async function load(prefer = '', opts = {}) {
    if (!opts.quiet) setLoading(true);
    try {
      const p = await getAlphaStrategies();
      const list = p?.strategies || [];
      const next = list.find((x) => x.file_name === prefer)?.file_name || prefer || list[0]?.file_name || '';
      const entry = list.find((x) => x.file_name === next) || null;
      const keep = opts.quiet && draft?.fileName === next;
      startTransition(() => { setState(p); setSelFile(next); if (!keep) setDraft(entry ? specToDraft(entry) : null); setError(''); });
      return p;
    } catch (e) { setError(e.message); return null; }
    finally { if (!opts.quiet) setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => { getTradableSymbols().then(setSymbols).catch(() => setSymbols([])); }, []);

  /* 回測輪詢 */
  useEffect(() => {
    if (!pendingBt) return;
    let off = false;
    async function poll() {
      const p = await load(pendingBt, { quiet: true });
      if (!p || off) return;
      const job = (p.strategies || []).find((x) => x.file_name === pendingBt)?.latest_backtest_job;
      if (job?.status === 'completed') { setPendingBt(''); setLocalBt(job.result ? { ...job.result, file_name: pendingBt } : null); setNotice('回測完成'); }
      else if (job?.status === 'failed') { setPendingBt(''); setError(job.error || '回測失敗'); }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { off = true; clearInterval(t); };
  }, [pendingBt]); // eslint-disable-line

  const list = state?.strategies || [];
  const sel = list.find((x) => x.file_name === selFile) || null;
  const btJob = localBt?.file_name === selFile ? { status: 'completed', result: localBt } : sel?.latest_backtest_job || null;

  function pick(fn) { const e = list.find((x) => x.file_name === fn); setSelFile(fn); setDraft(e ? specToDraft(e) : null); setLocalBt(null); setNotice(''); setError(''); }
  function set(k, v) { setDraft((d) => ({ ...d, [k]: v })); }
  function setBt(k, v) { setDraft((d) => ({ ...d, bt: { ...d.bt, [k]: v } })); }
  function setTf(k, v) { setDraft((d) => ({ ...d, tf: { ...d.tf, [k]: v } })); }

  async function save() {
    if (!draft) return;
    const spec = draftToSpec(draft);
    const r = await saveAlphaStrategy(draft.fileName, spec);
    await load(r?.strategy?.file_name || draft.fileName);
    setNotice('已儲存');
    return r;
  }

  async function handleSave() { setSaving(true); setError(''); setNotice(''); try { await save(); } catch (e) { setError(e.message); } finally { setSaving(false); } }

  async function handleRun() {
    setApplying(true); setError(''); setNotice(''); setLocalBt(null);
    try {
      const sr = await save();
      const fn = sr?.strategy?.file_name || draft.fileName;
      await applyAlphaStrategies();
      const bt = await runAlphaStrategyBacktest(fn);
      if (bt.completed) { setLocalBt({ ...bt, file_name: fn }); setNotice(`回測完成，共 ${bt.symbol_count ?? 0} 個幣種`); }
      else { setPendingBt(fn); setNotice('回測已排隊，等待交易核心執行...'); }
      await load(fn);
    } catch (e) { setError(e.message); } finally { setApplying(false); }
  }

  /* ── 渲染 ──────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* 錯誤 / 通知 */}
      {error ? <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-2.5 text-sm text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-200">{notice}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* ── 左側：策略列表 ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">策略列表</h2>
            <button type="button" onClick={() => load(selFile)} className={`${pillBtn} border-white/10 bg-white/5 text-slate-300 hover:text-white`}>
              重整
            </button>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-slate-500">載入中...</p>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">目前沒有策略</p>
          ) : (
            list.map((e) => {
              const on = e.file_name === selFile;
              const st = e.spec.status === 'champion' ? '主策略' : '候選';
              const stClr = e.spec.status === 'champion' ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' : 'text-amber-300 border-amber-400/30 bg-amber-400/10';
              return (
                <button key={e.file_name} type="button" onClick={() => pick(e.file_name)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${on ? 'border-amber-300/50 bg-amber-400/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm font-medium text-white">{e.spec.strategy_id || e.file_name}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${stClr}`}>{st}</span>
                  </div>
                  {e.spec.thesis ? <p className="mt-1.5 line-clamp-1 text-xs text-slate-400">{e.spec.thesis}</p> : null}
                </button>
              );
            })
          )}
        </div>

        {/* ── 右側：編輯區 ── */}
        {!draft ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] text-sm text-slate-500">
            從左邊選一個策略開始編輯
          </div>
        ) : (
          <div className="space-y-4">
            {/* 標題列 + 按鈕 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{draft.strategyId || draft.fileName}</h3>
                <p className="text-xs text-slate-500">{draft.fileName}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleSave} disabled={saving || applying}
                  className={`${pillBtn} border-white/10 bg-white/5 text-slate-200 hover:text-white`}>
                  {saving ? '儲存中...' : '儲存'}
                </button>
                <button type="button" onClick={handleRun} disabled={saving || applying}
                  className={`${pillBtn} border-amber-300/35 bg-amber-400/12 text-amber-50 hover:border-amber-300/60`}>
                  {applying ? '執行中...' : '儲存並回測'}
                </button>
              </div>
            </div>

            {/* 回測結果 */}
            <BacktestPanel job={btJob} />

            {/* ── 核心設定 ── */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 space-y-4">
              <h4 className="text-sm font-medium text-slate-300">核心設定</h4>

              <div className="grid gap-3 sm:grid-cols-2">
                <Lbl text="策略 ID">
                  <input value={draft.strategyId} onChange={(e) => set('strategyId', e.target.value)} className={monoInput} />
                </Lbl>
                <Lbl text="策略階段">
                  <select value={draft.status} onChange={(e) => set('status', e.target.value)} className={input}>
                    <option value="candidate">候選策略</option>
                    <option value="champion">主策略</option>
                  </select>
                </Lbl>
                <Lbl text="型態名稱" hint="setup">
                  <input value={draft.setupName} onChange={(e) => set('setupName', e.target.value)} className={input} />
                </Lbl>
                <Lbl text="觸發名稱" hint="trigger">
                  <input value={draft.triggerName} onChange={(e) => set('triggerName', e.target.value)} className={input} />
                </Lbl>
              </div>

              <Lbl text="策略假說">
                <textarea rows={2} value={draft.thesis} onChange={(e) => set('thesis', e.target.value)} className={input} />
              </Lbl>

              <div className="grid gap-3 sm:grid-cols-3">
                <Lbl text="大方向週期">
                  <select value={draft.tf.trend} onChange={(e) => setTf('trend', e.target.value)} className={input}>
                    {['1d', '4h', '1h'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
                <Lbl text="型態週期">
                  <select value={draft.tf.setup} onChange={(e) => setTf('setup', e.target.value)} className={input}>
                    {['4h', '1h', '15m'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
                <Lbl text="觸發週期">
                  <select value={draft.tf.trigger} onChange={(e) => setTf('trigger', e.target.value)} className={input}>
                    {TIMEFRAMES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Lbl text="每筆風險" hint="佔帳戶 %">
                  <input type="number" step="0.001" value={draft.risk} onChange={(e) => set('risk', e.target.value)} className={monoInput} />
                </Lbl>
                <Lbl text="槓桿倍數">
                  <input type="number" step="1" value={draft.leverage} onChange={(e) => set('leverage', e.target.value)} className={monoInput} />
                </Lbl>
                <Lbl text="最低分數" hint="0~100">
                  <input type="number" step="1" value={draft.minScore} onChange={(e) => set('minScore', e.target.value)} className={monoInput} />
                </Lbl>
              </div>
            </div>

            {/* ── 回測範圍 ── */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 space-y-4">
              <h4 className="text-sm font-medium text-slate-300">回測範圍</h4>

              <div className="grid gap-3 sm:grid-cols-3">
                <Lbl text="回測週期">
                  <select value={draft.bt.tf} onChange={(e) => setBt('tf', e.target.value)} className={input}>
                    {TIMEFRAMES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
                <Lbl text="回溯天數">
                  <input type="number" step="1" value={draft.bt.days} onChange={(e) => setBt('days', e.target.value)} className={monoInput} />
                </Lbl>
                <Lbl text="幣種來源">
                  <select value={draft.bt.mode} onChange={(e) => setBt('mode', e.target.value)} className={input}>
                    {BACKTEST_SYMBOL_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Lbl>
              </div>

              {draft.bt.mode === 'top_n' ? (
                <Lbl text="前幾名" hint="依 24h 成交額排序">
                  <input type="number" step="1" value={draft.bt.topN} onChange={(e) => setBt('topN', e.target.value)} className={monoInput} />
                </Lbl>
              ) : null}

              {draft.bt.mode === 'manual' ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input list="sym-list" value={picker} onChange={(e) => setPicker(e.target.value)}
                      placeholder="輸入幣種，例如 BTCUSDT" className={`flex-1 ${monoInput}`} />
                    <datalist id="sym-list">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
                    <button type="button" onClick={() => { const s = picker.trim().toUpperCase(); if (!s) return; setBt('symbols', [...new Set([...draft.bt.symbols, s])]); setPicker(''); }}
                      className={`${pillBtn} border-white/10 bg-white/5 text-slate-200 hover:text-white`}>加入</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {draft.bt.symbols.length ? draft.bt.symbols.map((s) => (
                      <button key={s} type="button" onClick={() => setBt('symbols', draft.bt.symbols.filter((x) => x !== s))}
                        className="rounded-full border border-sky-300/30 bg-sky-400/10 px-2.5 py-0.5 font-mono text-xs text-sky-200 hover:border-sky-200/60">{s} x</button>
                    )) : <span className="text-xs text-slate-500">尚未選擇幣種</span>}
                  </div>
                </div>
              ) : null}

              {draft.bt.mode === 'strategy_allowed' ? (
                <p className="text-xs text-slate-500">會使用下方進階設定裡的「允許幣種」清單。若為空則自動退回前 {draft.bt.topN} 名。</p>
              ) : null}
            </div>

            {/* ── 策略參數 ── */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-300">策略參數</h4>
                <button type="button" onClick={() => set('paramRows', [...draft.paramRows, { id: uid(), key: '', type: 'number', val: '' }])}
                  className={`${pillBtn} border-white/10 bg-white/5 text-xs text-slate-300 hover:text-white`}>新增</button>
              </div>

              {draft.paramRows.length === 0 ? (
                <p className="text-xs text-slate-500">目前沒有自訂參數</p>
              ) : (
                draft.paramRows.map((r) => (
                  <div key={r.id} className="grid gap-2 sm:grid-cols-[1fr_90px_1.3fr_auto]">
                    <input value={r.key} placeholder="名稱" onChange={(e) => set('paramRows', draft.paramRows.map((x) => x.id === r.id ? { ...x, key: e.target.value } : x))} className={monoInput} />
                    <select value={r.type} onChange={(e) => set('paramRows', draft.paramRows.map((x) => x.id === r.id ? { ...x, type: e.target.value } : x))} className={input}>
                      {PARAM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input value={r.val} placeholder="值" onChange={(e) => set('paramRows', draft.paramRows.map((x) => x.id === r.id ? { ...x, val: e.target.value } : x))} className={monoInput} />
                    <button type="button" onClick={() => set('paramRows', draft.paramRows.filter((x) => x.id !== r.id))}
                      className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200 hover:border-rose-300/40">刪除</button>
                  </div>
                ))
              )}
            </div>

            {/* ── 進階設定（收折） ── */}
            <button type="button" onClick={() => setShowAdv(!showAdv)}
              className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-400 transition hover:text-white">
              <span>進階設定</span>
              <span className="text-xs">{showAdv ? '收起' : '展開'}</span>
            </button>

            {showAdv ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Lbl text="市場型態">
                    <input value={draft.marketType} onChange={(e) => set('marketType', e.target.value)} className={input} />
                  </Lbl>
                  <Lbl text="啟用策略">
                    <label className="flex items-center gap-2 pt-1 text-sm text-slate-300">
                      <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-4 w-4 rounded" />
                      啟用
                    </label>
                  </Lbl>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Lbl text="失效條件">
                    <textarea rows={3} value={draft.invalidation} onChange={(e) => set('invalidation', e.target.value)} className={input} />
                  </Lbl>
                  <Lbl text="出場計畫">
                    <textarea rows={3} value={draft.exitPlan} onChange={(e) => set('exitPlan', e.target.value)} className={input} />
                  </Lbl>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Lbl text="允許幣種" hint="逗號或換行">
                    <textarea rows={4} value={draft.allowedText} onChange={(e) => set('allowedText', e.target.value)} className={`${monoInput} text-xs`} />
                  </Lbl>
                  <Lbl text="排除幣種" hint="逗號或換行">
                    <textarea rows={4} value={draft.blockedText} onChange={(e) => set('blockedText', e.target.value)} className={`${monoInput} text-xs`} />
                  </Lbl>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Lbl text="備註" hint="一行一條">
                    <textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} className={input} />
                  </Lbl>
                  <Lbl text="標籤（JSON）">
                    <textarea rows={3} value={draft.tags} onChange={(e) => set('tags', e.target.value)} className={monoInput} />
                  </Lbl>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
