import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterPanel from './FilterPanel';
import StrategySettingsPanel from './StrategySettingsPanel';
import SymbolLookupPanel from './SymbolLookupPanel';
import StatusBar from './StatusBar';
import CoinTable from './CoinTable';
import { loadDashboardSnapshot, triggerScan } from '../services/scanner';
import { getRuntimeSettings, updateRuntimeSettings } from '../services/binanceApi';
import { DEFAULT_RUNTIME_SETTINGS } from '../config/runtimeSettings';
import wsManager from '../services/wsManager';

const DEFAULT_FILTERS = {
  timeframe: '1h',
  minScore: 55,
  search: '',
  patterns: {
    triangle: false,
    harmonic: false,
    wBottom: false,
    mTop: false,
  },
};

const COPY = {
  candidates: '\u5019\u9078\u5e63\u6578',
  averageScore: '\u5e73\u5747\u5206\u6578',
  topSetup: '\u6700\u4f73\u5019\u9078',
  loading: '\u6b63\u5728\u6383\u63cf Binance USDT-M \u5408\u7d04\u5e02\u5834...',
  noBest: '\u76ee\u524d\u9084\u6c92\u6709\u7b26\u5408\u689d\u4ef6\u7684\u5e63\u7a2e',
};

function toPatternFilterList(patterns) {
  const entries = [];

  if (patterns.triangle) {
    entries.push('triangle');
  }

  if (patterns.harmonic) {
    entries.push('harmonic');
  }

  if (patterns.wBottom) {
    entries.push('w_bottom');
  }

  if (patterns.mTop) {
    entries.push('m_top');
  }

  return entries;
}

function averageScore(rows) {
  if (!rows.length) {
    return 0;
  }

  const total = rows.reduce((sum, row) => sum + row.trendScore, 0);
  return Math.round((total / rows.length) * 10) / 10;
}

function formatCandidatesDescription(totalSymbols) {
  return `\u5f9e ${totalSymbols || '--'} \u500b\u5168\u5e02\u5834\u5e63\u7a2e\u88e1\u5feb\u901f\u7e2e\u5c0f\u5230\u5c11\u6578\u5019\u9078\u3002`;
}

function formatTopDescription(bestRow) {
  if (!bestRow) {
    return COPY.noBest;
  }

  const patternCount = bestRow.detectedPatterns?.length || 0;
  return `\u5206\u6578 ${bestRow.trendScore}\uff0c\u76ee\u524d\u5075\u6e2c\u5230 ${patternCount} \u7a2e\u5f62\u614b\u7dda\u7d22\u3002`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [mobilePanel, setMobilePanel] = useState('filters');
  const [strategySettings, setStrategySettings] = useState(DEFAULT_RUNTIME_SETTINGS);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(null);
  const [meta, setMeta] = useState({});
  const [priceMap, setPriceMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = useState('');
  const [error, setError] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const deferredSearch = useDeferredValue(filters.search.trim().toUpperCase());

  useEffect(() => {
    const unsubscribePrices = wsManager.onPriceUpdate((nextPrices) => {
      startTransition(() => {
        setPriceMap(nextPrices);
      });
    });
    const unsubscribeConnection = wsManager.onConnectionChange((payload) => {
      if (payload.channel === 'miniTicker') {
        setWsConnected(payload.status === 'open');
      }
    });

    wsManager.connectMiniTicker();

    return () => {
      unsubscribePrices();
      unsubscribeConnection();
      wsManager.disconnectMiniTicker();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const nextSettings = await getRuntimeSettings();

        if (cancelled) {
          return;
        }

        setStrategySettings(nextSettings);
        setFilters((current) =>
          current.minScore === DEFAULT_FILTERS.minScore ? { ...current, minScore: nextSettings.scan.minScoreDefault } : current,
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async (force = false, silent = false) => {
      if (!silent) {
        setRefreshing(true);
      }

      try {
        const snapshot = await loadDashboardSnapshot({
          timeframe: filters.timeframe,
          minScore: filters.minScore,
          patterns: toPatternFilterList(filters.patterns),
          force,
        });

        if (!cancelled) {
          startTransition(() => {
            setRows(snapshot.rows);
            setStatus(snapshot.status);
            setMeta(snapshot.meta);
            setError('');
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    load();

    const timer = window.setInterval(() => {
      load(false, true);
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [filters.timeframe, filters.minScore, filters.patterns]);

  const visibleRows = rows.filter((row) => {
    if (deferredSearch && !row.symbol.includes(deferredSearch)) {
      return false;
    }

    return true;
  });

  const bestRow = visibleRows[0];

  async function handleRefresh() {
    setRefreshing(true);

    try {
      await triggerScan(filters.timeframe);
      const snapshot = await loadDashboardSnapshot({
        timeframe: filters.timeframe,
        minScore: filters.minScore,
        patterns: toPatternFilterList(filters.patterns),
      });

      startTransition(() => {
        setRows(snapshot.rows);
        setStatus(snapshot.status);
        setMeta(snapshot.meta);
        setError('');
      });
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);

    try {
      const nextSettings = await updateRuntimeSettings(strategySettings);
      setStrategySettings(nextSettings);
      setFilters((current) => ({
        ...current,
        minScore: nextSettings.scan.minScoreDefault,
      }));
      setSettingsSavedAt(new Date().toISOString());
      await triggerScan(filters.timeframe);
      const snapshot = await loadDashboardSnapshot({
        timeframe: filters.timeframe,
        minScore: nextSettings.scan.minScoreDefault,
        patterns: toPatternFilterList(filters.patterns),
      });

      startTransition(() => {
        setRows(snapshot.rows);
        setStatus(snapshot.status);
        setMeta(snapshot.meta);
        setError('');
      });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingSettings(false);
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-4 xl:space-y-6">
        <div className="panel rounded-[28px] p-2 xl:hidden">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['filters', '\u7be9\u9078'],
              ['strategy', '\u7b56\u7565'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobilePanel(key)}
                className={`rounded-[20px] px-4 py-3 text-sm font-medium transition ${
                  mobilePanel === key
                    ? 'bg-emerald-400/14 text-emerald-50 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]'
                    : 'bg-white/[0.04] text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="xl:hidden">
          {mobilePanel === 'filters' ? (
            <FilterPanel
              filters={filters}
              onChange={(nextValues) => {
                setFilters((current) => ({ ...current, ...nextValues }));
              }}
            />
          ) : (
            <StrategySettingsPanel
              settings={strategySettings}
              saving={savingSettings}
              savedAt={settingsSavedAt}
              onFieldChange={(section, key, value) =>
                setStrategySettings((current) => ({
                  ...current,
                  [section]: {
                    ...current[section],
                    [key]: value,
                  },
                }))
              }
              onReset={(nextSettings) => {
                setStrategySettings(nextSettings);
              }}
              onSave={handleSaveSettings}
            />
          )}
        </div>

        <div className="hidden space-y-6 xl:block">
          <FilterPanel
            filters={filters}
            onChange={(nextValues) => {
              setFilters((current) => ({ ...current, ...nextValues }));
            }}
          />

          <StrategySettingsPanel
            settings={strategySettings}
            saving={savingSettings}
            savedAt={settingsSavedAt}
            onFieldChange={(section, key, value) =>
              setStrategySettings((current) => ({
                ...current,
                [section]: {
                  ...current[section],
                  [key]: value,
                },
              }))
            }
            onReset={(nextSettings) => {
              setStrategySettings(nextSettings);
            }}
            onSave={handleSaveSettings}
          />
        </div>
      </div>

      <div>
        <StatusBar
          status={status}
          timeframe={filters.timeframe}
          wsConnected={wsConnected}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />

        <SymbolLookupPanel
          settings={strategySettings}
          status={status}
          onOpenChart={(symbol) => navigate(`/chart/${symbol}`)}
        />

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="panel-soft rounded-[24px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.candidates}</p>
            <p className="mt-3 font-mono text-3xl text-white">{visibleRows.length}</p>
            <p className="mt-2 text-sm text-slate-300">{formatCandidatesDescription(meta.totalSymbols)}</p>
          </div>
          <div className="panel-soft rounded-[24px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.averageScore}</p>
            <p className="mt-3 font-mono text-3xl text-white">{averageScore(visibleRows) || '--'}</p>
            <p className="mt-2 text-sm text-slate-300">
              {'\u5feb\u901f\u78ba\u8a8d\u76ee\u524d\u6574\u9ad4\u76e4\u9762\u662f\u5426\u9084\u4fdd\u6301\u8d8a\u52e2\u3002'}
            </p>
          </div>
          <div className="panel-soft rounded-[24px] px-5 py-5 sm:col-span-2 xl:col-span-1">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.topSetup}</p>
            <p className="mt-3 font-mono text-3xl text-white">{bestRow?.symbol || '--'}</p>
            <p className="mt-2 text-sm text-slate-300">{formatTopDescription(bestRow)}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="panel flex min-h-[320px] items-center justify-center rounded-[28px] text-slate-300">{COPY.loading}</div>
        ) : (
          <CoinTable
            rows={visibleRows}
            priceMap={priceMap}
            onSelect={(coin) => navigate(`/chart/${coin.symbol}`, { state: { coin } })}
          />
        )}
      </div>
    </div>
  );
}
