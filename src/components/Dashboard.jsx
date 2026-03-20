import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterPanel from './FilterPanel';
import StatusBar from './StatusBar';
import CoinTable from './CoinTable';
import { loadDashboardSnapshot, triggerScan } from '../services/scanner';
import wsManager from '../services/wsManager';

const DEFAULT_FILTERS = {
  timeframe: '1h',
  minScore: 60,
  search: '',
  patterns: {
    triangle: false,
    wBottom: false,
    mTop: false,
  },
};

function toPatternFilterList(patterns) {
  const entries = [];

  if (patterns.triangle) {
    entries.push('triangle');
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(null);
  const [meta, setMeta] = useState({});
  const [priceMap, setPriceMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <FilterPanel
        filters={filters}
        onChange={(nextValues) => {
          setFilters((current) => ({ ...current, ...nextValues }));
        }}
      />

      <div>
        <StatusBar
          status={status}
          timeframe={filters.timeframe}
          wsConnected={wsConnected}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="panel-soft rounded-[24px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Candidates</p>
            <p className="mt-3 font-mono text-3xl text-white">{visibleRows.length}</p>
            <p className="mt-2 text-sm text-slate-300">Filtered from {meta.totalSymbols || '--'} active perpetuals</p>
          </div>
          <div className="panel-soft rounded-[24px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Average score</p>
            <p className="mt-3 font-mono text-3xl text-white">{averageScore(visibleRows) || '--'}</p>
            <p className="mt-2 text-sm text-slate-300">Using the current score floor and pattern filters</p>
          </div>
          <div className="panel-soft rounded-[24px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Top setup</p>
            <p className="mt-3 font-mono text-3xl text-white">{bestRow?.symbol || '--'}</p>
            <p className="mt-2 text-sm text-slate-300">
              {bestRow ? `Score ${bestRow.trendScore} with ${bestRow.detectedPatterns?.length || 0} pattern tags` : 'Waiting for scan output'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="panel flex min-h-[320px] items-center justify-center rounded-[28px] text-slate-300">
            Scanning Binance futures universe...
          </div>
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
