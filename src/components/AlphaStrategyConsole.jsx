import { startTransition, useEffect, useState } from 'react';
import {
  applyAlphaStrategies,
  getAlphaStrategies,
  getTradableSymbols,
  runAlphaStrategyBacktest,
  saveAlphaStrategy,
} from '../services/binanceApi';

const TYPE_OPTIONS = [
  ['string', '文字'],
  ['number', '數字'],
  ['boolean', '布林'],
  ['array', '陣列'],
  ['object', '物件'],
];

const STRATEGY_STATUS_OPTIONS = [
  ['candidate', '候選策略'],
  ['champion', '主策略'],
];

const BACKTEST_SYMBOL_MODE_OPTIONS = [
  ['top_n', '前幾名成交量幣種'],
  ['manual', '手動選幣'],
  ['strategy_allowed', '沿用策略允許幣種'],
];

const BACKTEST_TIMEFRAMES = ['15m', '1h', '4h'];

function inferValueType(value) {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value && typeof value === 'object') return 'object';
  return 'string';
}

function formatTypedValue(value, type) {
  if (type === 'array' || type === 'object') {
    return JSON.stringify(value ?? (type === 'array' ? [] : {}), null, 2);
  }

  if (value == null) {
    return '';
  }

  return String(value);
}

function parseTypedValue(rawValue, type) {
  const text = String(rawValue ?? '').trim();

  if (type === 'number') {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      throw new Error(`參數數字格式錯誤: ${rawValue}`);
    }
    return parsed;
  }

  if (type === 'boolean') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    throw new Error(`布林值只能輸入 true 或 false: ${rawValue}`);
  }

  if (type === 'array') {
    const parsed = JSON.parse(text || '[]');
    if (!Array.isArray(parsed)) {
      throw new Error(`陣列格式錯誤: ${rawValue}`);
    }
    return parsed;
  }

  if (type === 'object') {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`物件格式錯誤: ${rawValue}`);
    }
    return parsed;
  }

  return rawValue ?? '';
}

function splitListText(text) {
  return Array.from(
    new Set(
      String(text ?? '')
        .split(/\r?\n|,/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function splitLineText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(text, fallback = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 物件格式錯誤');
  }
  return parsed;
}

function nextRowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toParamRows(params = {}) {
  return Object.entries(params).map(([key, value]) => {
    const type = inferValueType(value);
    return {
      id: nextRowId(),
      key,
      type,
      valueText: formatTypedValue(value, type),
    };
  });
}

function normalizeBacktest(backtest = {}, triggerTimeframe = '15m', allowedSymbols = []) {
  return {
    enabled: backtest?.enabled !== false,
    timeframe: backtest?.timeframe || triggerTimeframe || '15m',
    lookback_days: Number(backtest?.lookback_days || 60),
    symbol_mode: backtest?.symbol_mode || (allowedSymbols.length ? 'strategy_allowed' : 'top_n'),
    symbols: Array.isArray(backtest?.symbols) ? backtest.symbols.map((item) => String(item).trim().toUpperCase()).filter(Boolean) : [],
    top_n: Number(backtest?.top_n || 20),
  };
}

function strategyToDraft(entry) {
  const spec = entry?.spec || {};
  const backtest = normalizeBacktest(spec.backtest, spec.timeframes?.trigger, spec.allowed_symbols || []);

  return {
    fileName: entry?.file_name || '',
    filePath: entry?.file_path || '',
    strategyId: spec.strategy_id || '',
    thesis: spec.thesis || '',
    marketType: spec.market_type || '',
    setupName: spec.setup_name || '',
    triggerName: spec.trigger_name || '',
    invalidation: spec.invalidation || '',
    exitPlan: spec.exit_plan || '',
    status: spec.status || 'candidate',
    enabled: Boolean(spec.enabled),
    trendTimeframe: spec.timeframes?.trend || '4h',
    setupTimeframe: spec.timeframes?.setup || '1h',
    triggerTimeframe: spec.timeframes?.trigger || '15m',
    allowedSymbolsText: (spec.allowed_symbols || []).join('\n'),
    blockedSymbolsText: (spec.blocked_symbols || []).join('\n'),
    riskPerTradeText: String(spec.risk_per_trade ?? 0.005),
    leverageText: String(spec.leverage ?? 5),
    minScoreText: String(spec.min_score ?? 55),
    backtestTimeframe: backtest.timeframe,
    backtestLookbackDaysText: String(backtest.lookback_days),
    backtestSymbolMode: backtest.symbol_mode,
    backtestTopNText: String(backtest.top_n),
    backtestSymbols: backtest.symbols,
    notesText: (spec.notes || []).join('\n'),
    tagsText: JSON.stringify(spec.tags || {}, null, 2),
    paramRows: toParamRows(spec.params || {}),
  };
}

function draftToSpec(draft) {
  const params = {};
  draft.paramRows.forEach((row) => {
    const key = String(row.key || '').trim();
    if (!key) {
      return;
    }
    params[key] = parseTypedValue(row.valueText, row.type);
  });

  const riskPerTrade = Number(draft.riskPerTradeText);
  const leverage = Number(draft.leverageText);
  const minScore = Number(draft.minScoreText);
  const lookbackDays = Number(draft.backtestLookbackDaysText);
  const topN = Number(draft.backtestTopNText);

  if (!Number.isFinite(riskPerTrade) || riskPerTrade <= 0) {
    throw new Error('risk_per_trade 必須大於 0');
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new Error('leverage 必須大於 0');
  }
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    throw new Error('min_score 必須介於 0 到 100');
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    throw new Error('回測天數必須大於 0');
  }
  if (draft.backtestSymbolMode === 'top_n' && (!Number.isFinite(topN) || topN <= 0)) {
    throw new Error('前幾名幣種數量必須大於 0');
  }
  if (draft.backtestSymbolMode === 'manual' && draft.backtestSymbols.length === 0) {
    throw new Error('手動選幣模式至少要選 1 個幣種');
  }

  return {
    strategy_id: draft.strategyId.trim(),
    thesis: draft.thesis.trim(),
    market_type: draft.marketType.trim(),
    setup_name: draft.setupName.trim(),
    trigger_name: draft.triggerName.trim(),
    invalidation: draft.invalidation.trim(),
    exit_plan: draft.exitPlan.trim(),
    status: draft.status.trim() || 'candidate',
    enabled: Boolean(draft.enabled),
    timeframes: {
      trend: draft.trendTimeframe.trim(),
      setup: draft.setupTimeframe.trim(),
      trigger: draft.triggerTimeframe.trim(),
    },
    allowed_symbols: splitListText(draft.allowedSymbolsText),
    blocked_symbols: splitListText(draft.blockedSymbolsText),
    risk_per_trade: riskPerTrade,
    leverage: Math.round(leverage),
    min_score: Math.round(minScore),
    params,
    backtest: {
      enabled: true,
      timeframe: draft.backtestTimeframe.trim(),
      lookback_days: Math.round(lookbackDays),
      symbol_mode: draft.backtestSymbolMode,
      symbols: draft.backtestSymbols,
      top_n: Math.round(topN),
    },
    tags: parseJsonObject(draft.tagsText, {}),
    notes: splitLineText(draft.notesText),
  };
}

function statusTone(status) {
  if (status === 'candidate') return 'text-amber-200 bg-amber-400/10 border-amber-400/30';
  if (status === 'champion') return 'text-emerald-200 bg-emerald-400/10 border-emerald-400/30';
  return 'text-slate-200 bg-white/5 border-white/10';
}

function strategyStatusLabel(status) {
  return (
    {
      candidate: '候選策略',
      champion: '主策略',
    }[status] || status || '--'
  );
}

function jobTone(status) {
  if (status === 'completed') return 'text-emerald-100 bg-emerald-400/10 border-emerald-400/30';
  if (status === 'failed') return 'text-rose-100 bg-rose-400/10 border-rose-400/30';
  if (status === 'running') return 'text-sky-100 bg-sky-400/10 border-sky-400/30';
  return 'text-amber-100 bg-amber-400/10 border-amber-400/30';
}

function jobStatusLabel(status) {
  return (
    {
      completed: '已完成',
      failed: '失敗',
      running: '執行中',
      pending: '排隊中',
    }[status] || status || '--'
  );
}

function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatPnl(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Field({ label, children, hint = '' }) {
  return (
    <label className="block rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-100">{label}</span>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function MetricCard({ label, value, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function BacktestResultPanel({ job }) {
  if (!job) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-slate-400">
        這個策略目前還沒有回測結果。按「儲存、套用並回測」後，這裡會顯示最新績效。
      </div>
    );
  }

  const summary = job.result?.summary || null;
  const symbolCount = job.result?.symbol_count ?? job.result?.symbols?.length ?? job.symbols?.length ?? 0;
  const timeframe = job.result?.timeframe || job.timeframe || '--';
  const lookbackDays = job.result?.lookback_days || job.lookback_days || '--';

  return (
    <div className="space-y-4 rounded-[28px] border border-white/10 bg-slate-950/55 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">最新回測</p>
          <h3 className="mt-2 text-xl font-semibold text-white">最新策略回測</h3>
          <p className="mt-2 text-sm text-slate-400">
            狀態、幣種範圍與最近一次回測的關鍵績效會顯示在這裡。
          </p>
        </div>
        <div className={`inline-flex rounded-full border px-3 py-1 text-sm ${jobTone(job.status)}`}>
          {jobStatusLabel(job.status)}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="回測週期" value={timeframe} />
        <MetricCard label="回溯天數" value={`${lookbackDays} 天`} />
        <MetricCard label="幣種數量" value={String(symbolCount || '--')} />
      </div>

      {summary ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="總交易數" value={String(summary.total_trades ?? '--')} />
          <MetricCard label="勝率" value={formatPercent(summary.win_rate)} />
          <MetricCard label="獲利因子" value={summary.profit_factor?.toFixed?.(2) ?? '--'} />
          <MetricCard label="淨損益" value={formatPnl(summary.net_pnl)} tone={summary.net_pnl >= 0 ? 'text-emerald-200' : 'text-rose-200'} />
          <MetricCard label="最大回撤" value={formatPercent(summary.max_drawdown)} />
        </div>
      ) : null}

      {job.error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{job.error}</div>
      ) : null}

      {Array.isArray(job.result?.symbols) && job.result.symbols.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">本次回測幣種</p>
          <p className="mt-2 text-sm text-slate-300">{job.result.symbols.join(', ')}</p>
        </div>
      ) : null}
    </div>
  );
}

export default function AlphaStrategyConsole() {
  const [consoleState, setConsoleState] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [draft, setDraft] = useState(null);
  const [tradableSymbols, setTradableSymbols] = useState([]);
  const [symbolPicker, setSymbolPicker] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingBacktestFileName, setPendingBacktestFileName] = useState('');
  const [localBacktestResult, setLocalBacktestResult] = useState(null);

  async function loadStrategies(preferredFileName = '', { preserveDraft = false } = {}) {
    if (!preserveDraft) {
      setLoading(true);
    }

    try {
      const payload = await getAlphaStrategies();
      const strategies = payload?.strategies || [];
      const nextSelected =
        strategies.find((item) => item.file_name === preferredFileName)?.file_name ||
        preferredFileName ||
        strategies[0]?.file_name ||
        '';
      const nextEntry = strategies.find((item) => item.file_name === nextSelected) || null;
      const preserveCurrentDraft = preserveDraft && draft?.fileName === nextSelected;

      startTransition(() => {
        setConsoleState(payload);
        setSelectedFileName(nextSelected);
        if (!preserveCurrentDraft) {
          setDraft(nextEntry ? strategyToDraft(nextEntry) : null);
        }
        setError('');
      });

      return payload;
    } catch (loadError) {
      setError(loadError.message);
      return null;
    } finally {
      if (!preserveDraft) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadStrategies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSymbolUniverse() {
      try {
        setLoadingSymbols(true);
        const symbols = await getTradableSymbols();
        if (!cancelled) {
          setTradableSymbols(symbols);
        }
      } catch {
        if (!cancelled) {
          setTradableSymbols([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingSymbols(false);
        }
      }
    }

    loadSymbolUniverse();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pendingBacktestFileName) {
      return undefined;
    }

    let cancelled = false;

    async function pollBacktestStatus() {
      const payload = await loadStrategies(pendingBacktestFileName, { preserveDraft: true });
      if (!payload || cancelled) {
        return;
      }

      const nextEntry = (payload.strategies || []).find((item) => item.file_name === pendingBacktestFileName);
      const latestJob = nextEntry?.latest_backtest_job || null;

      if (latestJob?.status === 'completed') {
        setPendingBacktestFileName('');
        setLocalBacktestResult(latestJob.result ? { ...latestJob.result, file_name: pendingBacktestFileName } : null);
        setNotice('遠端回測已完成，結果已更新到策略控制台。');
      } else if (latestJob?.status === 'failed') {
        setPendingBacktestFileName('');
        setError(latestJob.error || '遠端回測失敗');
      }
    }

    pollBacktestStatus();
    const timerId = window.setInterval(pollBacktestStatus, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBacktestFileName]);

  const strategies = consoleState?.strategies || [];
  const selectedEntry = strategies.find((item) => item.file_name === selectedFileName) || null;
  const displayedBacktestJob =
    localBacktestResult && localBacktestResult.file_name === selectedFileName
      ? { status: 'completed', result: localBacktestResult }
      : selectedEntry?.latest_backtest_job || null;

  function selectStrategy(fileName) {
    const nextEntry = strategies.find((item) => item.file_name === fileName) || null;
    setSelectedFileName(fileName);
    setDraft(nextEntry ? strategyToDraft(nextEntry) : null);
    setLocalBacktestResult(null);
    setNotice('');
    setError('');
  }

  function updateDraftField(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateParamRow(rowId, patch) {
    setDraft((current) => ({
      ...current,
      paramRows: current.paramRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  function addParamRow() {
    setDraft((current) => ({
      ...current,
      paramRows: [...current.paramRows, { id: nextRowId(), key: '', type: 'number', valueText: '' }],
    }));
  }

  function removeParamRow(rowId) {
    setDraft((current) => ({
      ...current,
      paramRows: current.paramRows.filter((row) => row.id !== rowId),
    }));
  }

  function addBacktestSymbol() {
    const symbol = symbolPicker.trim().toUpperCase();
    if (!symbol) {
      return;
    }

    setDraft((current) => ({
      ...current,
      backtestSymbols: Array.from(new Set([...(current.backtestSymbols || []), symbol])),
    }));
    setSymbolPicker('');
  }

  function removeBacktestSymbol(symbol) {
    setDraft((current) => ({
      ...current,
      backtestSymbols: current.backtestSymbols.filter((item) => item !== symbol),
    }));
  }

  async function persistCurrentDraft() {
    if (!draft) {
      throw new Error('目前沒有可儲存的策略');
    }

    const spec = draftToSpec(draft);
    const saveResult = await saveAlphaStrategy(draft.fileName, spec);
    await loadStrategies(saveResult?.strategy?.file_name || draft.fileName);
    setNotice(`已儲存 ${draft.fileName}`);
    return saveResult;
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await persistCurrentDraft();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyAndBacktest() {
    setApplying(true);
    setError('');
    setNotice('');
    setLocalBacktestResult(null);

    try {
      const saveResult = await persistCurrentDraft();
      const fileName = saveResult?.strategy?.file_name || draft.fileName;
      const applyResult = await applyAlphaStrategies();
      const backtestResult = await runAlphaStrategyBacktest(fileName);

      if (backtestResult.completed) {
        setLocalBacktestResult({ ...backtestResult, file_name: fileName });
        setNotice(
          `已套用 ${applyResult.strategy_count ?? 0} 個候選策略，並完成 ${backtestResult.symbol_count ?? 0} 個幣種的回測。`,
        );
      } else {
        setPendingBacktestFileName(fileName);
        setNotice('已套用策略並建立回測工作，等待 Alpha 交易核心執行中。');
      }

      await loadStrategies(fileName, { preserveDraft: false });
    } catch (applyError) {
      setError(applyError.message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <BacktestResultPanel job={displayedBacktestJob} />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-[28px] border border-white/10 bg-slate-950/55 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-300/75">策略控制</p>
              <h2 className="mt-2 text-xl font-semibold text-white">策略控制台</h2>
              <p className="mt-2 text-sm text-slate-300">
                這裡直接編輯 Alpha 交易核心的策略規格，並在套用後立刻排入回測。
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadStrategies(selectedFileName)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:border-amber-300/40 hover:text-white"
            >
              重新整理
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
            儲存後會同步到策略規格。按下套用時，會先更新候選設定，再建立最新回測工作。
          </div>

          <div className="mt-5 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-sm text-slate-400">
                載入策略中...
              </div>
            ) : strategies.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-sm text-slate-400">
                目前還沒有策略檔。
              </div>
            ) : (
              strategies.map((entry) => {
                const active = entry.file_name === selectedFileName;
                const latestJob = entry.latest_backtest_job;
                return (
                  <button
                    key={entry.file_name}
                    type="button"
                    onClick={() => selectStrategy(entry.file_name)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      active
                        ? 'border-amber-300/50 bg-amber-400/10 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.2)]'
                        : 'border-white/10 bg-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm font-semibold text-white">{entry.spec.strategy_id}</span>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusTone(entry.spec.status)}`}>
                        {strategyStatusLabel(entry.spec.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">{entry.file_name}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-300">{entry.spec.thesis}</p>
                    {latestJob ? (
                      <div className={`mt-3 inline-flex rounded-full border px-2 py-0.5 text-xs ${jobTone(latestJob.status)}`}>
                        回測 {jobStatusLabel(latestJob.status)}
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="rounded-[28px] border border-white/10 bg-slate-950/55 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          {error ? (
            <div className="mb-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
          ) : null}
          {notice ? (
            <div className="mb-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50">{notice}</div>
          ) : null}

          {!draft ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-400">
              請先從左側選一個策略。
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.35em] text-sky-300/80">交易核心</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">{draft.strategyId || draft.fileName}</h3>
                  <p className="mt-2 text-sm text-slate-400">{draft.fileName}</p>
                  <p className="mt-1 text-xs text-slate-500">{draft.filePath}</p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || applying}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? '儲存中...' : '先儲存'}
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyAndBacktest}
                    disabled={saving || applying}
                    className="rounded-full border border-amber-300/35 bg-amber-400/12 px-4 py-2 text-sm font-medium text-amber-50 transition hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {applying ? '套用與回測中...' : '儲存、套用並回測'}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Field label="策略 ID">
                  <input
                    value={draft.strategyId}
                    onChange={(event) => updateDraftField('strategyId', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="策略階段" hint="候選策略 / 主策略">
                  <select
                    value={draft.status}
                    onChange={(event) => updateDraftField('status', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  >
                    {STRATEGY_STATUS_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                    {!STRATEGY_STATUS_OPTIONS.some(([value]) => value === draft.status) ? (
                      <option value={draft.status}>{draft.status}</option>
                    ) : null}
                  </select>
                </Field>
                <Field label="市場型態">
                  <input
                    value={draft.marketType}
                    onChange={(event) => updateDraftField('marketType', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="啟用策略">
                  <label className="inline-flex items-center gap-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => updateDraftField('enabled', event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-slate-950/60"
                    />
                    啟用這個策略
                  </label>
                </Field>
                <Field label="型態名稱">
                  <input
                    value={draft.setupName}
                    onChange={(event) => updateDraftField('setupName', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="觸發名稱">
                  <input
                    value={draft.triggerName}
                    onChange={(event) => updateDraftField('triggerName', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
              </div>

              <Field label="策略假說">
                <textarea
                  rows={4}
                  value={draft.thesis}
                  onChange={(event) => updateDraftField('thesis', event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                />
              </Field>

              <div className="grid gap-4 xl:grid-cols-2">
                <Field label="失效條件">
                  <textarea
                    rows={4}
                    value={draft.invalidation}
                    onChange={(event) => updateDraftField('invalidation', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="出場計畫">
                  <textarea
                    rows={4}
                    value={draft.exitPlan}
                    onChange={(event) => updateDraftField('exitPlan', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <Field label="大方向週期">
                  <input
                    value={draft.trendTimeframe}
                    onChange={(event) => updateDraftField('trendTimeframe', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="型態週期">
                  <input
                    value={draft.setupTimeframe}
                    onChange={(event) => updateDraftField('setupTimeframe', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="觸發週期">
                  <input
                    value={draft.triggerTimeframe}
                    onChange={(event) => updateDraftField('triggerTimeframe', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="每筆風險">
                  <input
                    type="number"
                    step="0.001"
                    value={draft.riskPerTradeText}
                    onChange={(event) => updateDraftField('riskPerTradeText', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="槓桿">
                  <input
                    type="number"
                    step="1"
                    value={draft.leverageText}
                    onChange={(event) => updateDraftField('leverageText', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="最低分數">
                  <input
                    type="number"
                    step="1"
                    value={draft.minScoreText}
                    onChange={(event) => updateDraftField('minScoreText', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
              </div>

              <div className="space-y-4 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-300/80">回測範圍</p>
                  <h4 className="mt-2 text-lg font-semibold text-white">套用後回測設定</h4>
                  <p className="mt-2 text-sm text-slate-400">
                    這裡決定套用策略後要回測多久、用哪個週期、以及要測哪些幣種。
                  </p>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  <Field label="回測週期">
                    <select
                      value={draft.backtestTimeframe}
                      onChange={(event) => updateDraftField('backtestTimeframe', event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                    >
                      {BACKTEST_TIMEFRAMES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="回溯天數">
                    <input
                      type="number"
                      step="1"
                      value={draft.backtestLookbackDaysText}
                      onChange={(event) => updateDraftField('backtestLookbackDaysText', event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                    />
                  </Field>
                  <Field label="回測幣種模式">
                    <select
                      value={draft.backtestSymbolMode}
                      onChange={(event) => updateDraftField('backtestSymbolMode', event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                    >
                      {BACKTEST_SYMBOL_MODE_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {draft.backtestSymbolMode === 'top_n' ? (
                  <Field label="前幾名幣種" hint="依 Binance 24 小時成交額排序">
                    <input
                      type="number"
                      step="1"
                      value={draft.backtestTopNText}
                      onChange={(event) => updateDraftField('backtestTopNText', event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                    />
                  </Field>
                ) : null}

                {draft.backtestSymbolMode === 'strategy_allowed' ? (
                  <div className="rounded-2xl border border-sky-400/15 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
                    會直接沿用下面「策略允許幣種」欄位。如果那裡是空的，回測會自動退回到前 {draft.backtestTopNText || '20'} 名成交量幣種。
                  </div>
                ) : null}

                {draft.backtestSymbolMode === 'manual' ? (
                  <div className="space-y-4">
                    <Field label="手動選幣" hint={loadingSymbols ? '讀取幣種中...' : `${tradableSymbols.length} 個可選幣種`}>
                      <div className="flex flex-col gap-3 lg:flex-row">
                        <div className="flex-1">
                          <input
                            list="alpha-tradable-symbols"
                            value={symbolPicker}
                            onChange={(event) => setSymbolPicker(event.target.value)}
                            placeholder="輸入或選擇幣種，例如 BTCUSDT"
                            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                          />
                          <datalist id="alpha-tradable-symbols">
                            {tradableSymbols.map((symbol) => (
                              <option key={symbol} value={symbol} />
                            ))}
                          </datalist>
                        </div>
                        <button
                          type="button"
                          onClick={addBacktestSymbol}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:border-white/20 hover:text-white"
                        >
                          加入幣種
                        </button>
                      </div>
                    </Field>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                      <p className="text-sm font-medium text-slate-100">本次回測幣種</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {draft.backtestSymbols.length ? (
                          draft.backtestSymbols.map((symbol) => (
                            <button
                              key={symbol}
                              type="button"
                              onClick={() => removeBacktestSymbol(symbol)}
                              className="rounded-full border border-sky-300/30 bg-sky-400/10 px-3 py-1 font-mono text-xs text-sky-100 transition hover:border-sky-200/60"
                            >
                              {symbol} ×
                            </button>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">尚未選擇任何幣種。</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Field label="策略允許幣種" hint="給 Alpha 交易核心執行用，逗號或換行分隔">
                  <textarea
                    rows={6}
                    value={draft.allowedSymbolsText}
                    onChange={(event) => updateDraftField('allowedSymbolsText', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="排除幣種" hint="逗號或換行分隔">
                  <textarea
                    rows={6}
                    value={draft.blockedSymbolsText}
                    onChange={(event) => updateDraftField('blockedSymbolsText', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold text-white">策略參數</h4>
                    <p className="mt-1 text-sm text-slate-400">複雜型別請用 JSON，例如 `["MICRO_HIGH_BREAK"]`。</p>
                  </div>
                  <button
                    type="button"
                    onClick={addParamRow}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:border-white/20 hover:text-white"
                  >
                    新增參數
                  </button>
                </div>

                <div className="space-y-3">
                  {draft.paramRows.map((row) => (
                    <div key={row.id} className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/45 p-3 lg:grid-cols-[1.1fr_120px_1.4fr_auto]">
                      <input
                        value={row.key}
                        onChange={(event) => updateParamRow(row.id, { key: event.target.value })}
                        placeholder="參數名稱"
                        className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                      />
                      <select
                        value={row.type}
                        onChange={(event) => updateParamRow(row.id, { type: event.target.value })}
                        className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                      >
                        {TYPE_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        rows={row.type === 'array' || row.type === 'object' ? 4 : 2}
                        value={row.valueText}
                        onChange={(event) => updateParamRow(row.id, { valueText: event.target.value })}
                        placeholder="參數值"
                        className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                      />
                      <button
                        type="button"
                        onClick={() => removeParamRow(row.id)}
                        className="rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm text-rose-100 transition hover:border-rose-300/40"
                      >
                        刪除
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Field label="備註" hint="一行一條">
                  <textarea
                    rows={6}
                    value={draft.notesText}
                    onChange={(event) => updateDraftField('notesText', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
                <Field label="標籤 JSON" hint='例如 {"owner": "alpha_research"}'>
                  <textarea
                    rows={6}
                    value={draft.tagsText}
                    onChange={(event) => updateDraftField('tagsText', event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-sky-400/50"
                  />
                </Field>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
