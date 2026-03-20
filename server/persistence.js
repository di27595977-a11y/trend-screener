import { createSupabaseClient } from '../src/services/supabaseClient.js';
import { scoreBucket } from '../src/utils/scoring.js';

function average(values) {
  const valid = values.filter((value) => value != null && !Number.isNaN(value));

  if (!valid.length) {
    return null;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percentChange(entryPrice, exitPrice) {
  if (entryPrice == null || exitPrice == null || entryPrice === 0) {
    return null;
  }

  return ((exitPrice - entryPrice) / entryPrice) * 100;
}

function toSnapshotRow(timeframe, totalSymbols, filteredCount, params, scannedAt) {
  return {
    id: crypto.randomUUID(),
    scanned_at: scannedAt,
    timeframe,
    total_symbols: totalSymbols,
    filtered_count: filteredCount,
    params,
  };
}

function toResultRow(snapshotId, result, createdAt) {
  return {
    id: crypto.randomUUID(),
    snapshot_id: snapshotId,
    symbol: result.symbol,
    timeframe: result.timeframe,
    trend_score: result.trendScore,
    r_squared: result.rSquared,
    slope: result.slope,
    slope_pct_per_bar: result.slopePctPerBar,
    pullback_ratio: result.pullbackRatio,
    volume_ratio: result.volumeRatio,
    price_change_pct: result.priceChangePct,
    position_score: result.positionScore,
    entry_price: result.entryPrice,
    detected_patterns: result.detectedPatterns,
    sparkline: result.sparkline,
    created_at: createdAt,
  };
}

function toBacktestInsert(resultRow) {
  return {
    scan_result_id: resultRow.id,
    symbol: resultRow.symbol,
    entry_price: resultRow.entry_price,
  };
}

function mergeBacktestRecords(backtests, resultsById) {
  return backtests
    .map((backtest) => {
      const result = resultsById.get(backtest.scan_result_id);

      if (!result) {
        return null;
      }

      const entryPrice = Number(backtest.entry_price ?? result.entry_price);

      return {
        id: backtest.id,
        scanResultId: backtest.scan_result_id,
        symbol: result.symbol,
        timeframe: result.timeframe,
        trendScore: result.trend_score,
        entryPrice,
        createdAt: result.created_at,
        detectedPatterns: result.detected_patterns || [],
        price1h: backtest.price_1h,
        price4h: backtest.price_4h,
        price12h: backtest.price_12h,
        price24h: backtest.price_24h,
        price48h: backtest.price_48h,
        price72h: backtest.price_72h,
        return24h: percentChange(entryPrice, backtest.price_24h),
        return72h: percentChange(entryPrice, backtest.price_72h),
        maxProfitPct: backtest.max_profit_pct,
        maxDrawdownPct: backtest.max_drawdown_pct,
      };
    })
    .filter(Boolean);
}

function buildGroupStats(records, getKeys) {
  const groups = new Map();

  records.forEach((record) => {
    const keys = getKeys(record);

    keys.forEach((key) => {
      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(record);
    });
  });

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const valid24h = items.filter((item) => item.return24h != null);
      return {
        key,
        samples: items.length,
        avg24hReturn: average(items.map((item) => item.return24h)),
        avg72hReturn: average(items.map((item) => item.return72h)),
        winRate24h: valid24h.length ? (valid24h.filter((item) => item.return24h > 0).length / valid24h.length) * 100 : null,
      };
    })
    .sort((left, right) => right.samples - left.samples);
}

function harmonicFamilyKeys(record) {
  const families = new Set();

  (record.detectedPatterns || []).forEach((pattern) => {
    if (!pattern.startsWith('harmonic:')) {
      return;
    }

    const [, name, direction] = pattern.split(':');
    families.add(`harmonic_family:${name}:${direction}`);
  });

  return Array.from(families);
}

export function createPersistenceLayer() {
  const supabase = createSupabaseClient();
  const memory = {
    snapshots: [],
    results: [],
    backtests: [],
  };
  const mode = supabase ? 'supabase' : 'memory';

  return {
    mode,

    async recordScan({ timeframe, totalSymbols, filteredCount, params, results, scannedAt = new Date().toISOString() }) {
      if (!supabase) {
        const snapshot = toSnapshotRow(timeframe, totalSymbols, filteredCount, params, scannedAt);
        const resultRows = results.map((result) => toResultRow(snapshot.id, result, scannedAt));
        const backtestRows = resultRows.map((resultRow) => ({
          id: crypto.randomUUID(),
          ...toBacktestInsert(resultRow),
          timeframe: resultRow.timeframe,
          trend_score: resultRow.trend_score,
          detected_patterns: resultRow.detected_patterns,
          created_at: resultRow.created_at,
        }));

        memory.snapshots.unshift(snapshot);
        memory.results.unshift(...resultRows);
        memory.backtests.unshift(...backtestRows);

        return snapshot;
      }

      const { data: snapshotData, error: snapshotError } = await supabase
        .from('scan_snapshots')
        .insert({
          scanned_at: scannedAt,
          timeframe,
          total_symbols: totalSymbols,
          filtered_count: filteredCount,
          params,
        })
        .select()
        .single();

      if (snapshotError) {
        throw snapshotError;
      }

      if (results.length) {
        const resultPayload = results.map((result) => ({
          snapshot_id: snapshotData.id,
          symbol: result.symbol,
          timeframe: result.timeframe,
          trend_score: result.trendScore,
          r_squared: result.rSquared,
          slope: result.slope,
          pullback_ratio: result.pullbackRatio,
          volume_ratio: result.volumeRatio,
          price_change_pct: result.priceChangePct,
          position_score: result.positionScore,
          entry_price: result.entryPrice,
          detected_patterns: result.detectedPatterns,
        }));
        const { data: insertedResults, error: resultError } = await supabase.from('scan_results').insert(resultPayload).select();

        if (resultError) {
          throw resultError;
        }

        if (insertedResults?.length) {
          const backtestPayload = insertedResults.map((resultRow) => ({
            scan_result_id: resultRow.id,
            symbol: resultRow.symbol,
            entry_price: resultRow.entry_price,
          }));
          const { error: backtestError } = await supabase.from('backtest_tracking').insert(backtestPayload);

          if (backtestError) {
            throw backtestError;
          }
        }
      }

      return snapshotData;
    },

    async getLatestScanResults(timeframe) {
      if (!supabase) {
        const snapshot = memory.snapshots.find((item) => item.timeframe === timeframe);

        if (!snapshot) {
          return { snapshot: null, results: [] };
        }

        return {
          snapshot,
          results: memory.results
            .filter((result) => result.snapshot_id === snapshot.id)
            .sort((left, right) => right.trend_score - left.trend_score),
        };
      }

      const { data: snapshot, error: snapshotError } = await supabase
        .from('scan_snapshots')
        .select('*')
        .eq('timeframe', timeframe)
        .order('scanned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (snapshotError) {
        throw snapshotError;
      }

      if (!snapshot) {
        return { snapshot: null, results: [] };
      }

      const { data: results, error: resultError } = await supabase
        .from('scan_results')
        .select('*')
        .eq('snapshot_id', snapshot.id)
        .order('trend_score', { ascending: false });

      if (resultError) {
        throw resultError;
      }

      return { snapshot, results: results || [] };
    },

    async getLatestSymbolOverview(symbol) {
      const upperSymbol = symbol.toUpperCase();

      if (!supabase) {
        const rows = memory.results
          .filter((result) => result.symbol === upperSymbol)
          .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));

        const uniqueByTimeframe = Array.from(new Map(rows.map((row) => [row.timeframe, row])).values());
        const best = [...uniqueByTimeframe].sort((left, right) => right.trend_score - left.trend_score)[0] || null;

        return {
          symbol: upperSymbol,
          best:
            best && {
              symbol: best.symbol,
              timeframe: best.timeframe,
              trendScore: best.trend_score,
              rSquared: best.r_squared,
              priceChangePct: best.price_change_pct,
              entryPrice: best.entry_price,
              detectedPatterns: best.detected_patterns,
            },
          results: uniqueByTimeframe,
        };
      }

      const { data: rows, error } = await supabase
        .from('scan_results')
        .select('*')
        .eq('symbol', upperSymbol)
        .order('created_at', { ascending: false })
        .limit(12);

      if (error) {
        throw error;
      }

      const uniqueByTimeframe = Array.from(new Map((rows || []).map((row) => [row.timeframe, row])).values());
      const best = [...uniqueByTimeframe].sort((left, right) => right.trend_score - left.trend_score)[0] || null;

      return {
        symbol: upperSymbol,
        best:
          best && {
            symbol: best.symbol,
            timeframe: best.timeframe,
            trendScore: best.trend_score,
            rSquared: best.r_squared,
            priceChangePct: best.price_change_pct,
            entryPrice: best.entry_price,
            detectedPatterns: best.detected_patterns,
          },
        results: uniqueByTimeframe,
      };
    },

    async listPendingBacktests(limit = 200, timeframe) {
      if (!supabase) {
        return memory.backtests
          .filter((item) => item.price_72h == null && (!timeframe || item.timeframe === timeframe))
          .sort((left, right) => new Date(left.created_at) - new Date(right.created_at))
          .slice(0, limit)
          .map((item) => ({
            ...item,
            created_at: item.created_at,
          }));
      }

      const { data: pendingRows, error: pendingError } = await supabase
        .from('backtest_tracking')
        .select('*')
        .is('price_72h', null)
        .limit(limit);

      if (pendingError) {
        throw pendingError;
      }

      const resultIds = (pendingRows || []).map((row) => row.scan_result_id);

      if (!resultIds.length) {
        return [];
      }

      const { data: resultRows, error: resultError } = await supabase
        .from('scan_results')
        .select('*')
        .in('id', resultIds);

      if (resultError) {
        throw resultError;
      }

      const resultMap = new Map((resultRows || []).map((row) => [row.id, row]));

      return (pendingRows || [])
        .map((row) => {
          const result = resultMap.get(row.scan_result_id);

          if (!result || (timeframe && result.timeframe !== timeframe)) {
            return null;
          }

          return {
            ...row,
            created_at: result.created_at,
            timeframe: result.timeframe,
            trend_score: result.trend_score,
            detected_patterns: result.detected_patterns,
          };
        })
        .filter(Boolean);
    },

    async updateBacktestEntry(id, patch) {
      if (!supabase) {
        const target = memory.backtests.find((item) => item.id === id);

        if (target) {
          Object.assign(target, patch);
        }

        return target || null;
      }

      const { error } = await supabase.from('backtest_tracking').update(patch).eq('id', id);

      if (error) {
        throw error;
      }

      return null;
    },

    async buildBacktestReport({ timeframe = '1h', days = 14 }) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      let mergedRecords = [];

      if (!supabase) {
        const resultMap = new Map(
          memory.results
            .filter((result) => result.timeframe === timeframe && result.created_at >= since)
            .map((result) => [result.id, result]),
        );
        const backtests = memory.backtests.filter((item) => item.timeframe === timeframe && item.created_at >= since);
        mergedRecords = mergeBacktestRecords(backtests, resultMap);
      } else {
        const { data: resultRows, error: resultError } = await supabase
          .from('scan_results')
          .select('*')
          .eq('timeframe', timeframe)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1000);

        if (resultError) {
          throw resultError;
        }

        const resultMap = new Map((resultRows || []).map((row) => [row.id, row]));
        const ids = Array.from(resultMap.keys());

        if (ids.length) {
          const { data: backtestRows, error: backtestError } = await supabase
            .from('backtest_tracking')
            .select('*')
            .in('scan_result_id', ids);

          if (backtestError) {
            throw backtestError;
          }

          mergedRecords = mergeBacktestRecords(backtestRows || [], resultMap);
        }
      }

      const totalsValid24h = mergedRecords.filter((record) => record.return24h != null);

      const scoreBuckets = buildGroupStats(mergedRecords, (record) => [scoreBucket(record.trendScore)]).map((bucket) => ({
        bucket: bucket.key,
        samples: bucket.samples,
        avg24hReturn: bucket.avg24hReturn,
        avg72hReturn: bucket.avg72hReturn,
        winRate24h: bucket.winRate24h,
      }));

      const patternBuckets = buildGroupStats(mergedRecords, (record) =>
        record.detectedPatterns.length ? record.detectedPatterns : ['trend_only'],
      )
        .slice(0, 12)
        .map((bucket) => ({
          pattern: bucket.key,
          samples: bucket.samples,
          avg24hReturn: bucket.avg24hReturn,
          avg72hReturn: bucket.avg72hReturn,
          winRate24h: bucket.winRate24h,
        }));

      const harmonicBuckets = buildGroupStats(mergedRecords, (record) => harmonicFamilyKeys(record))
        .map((bucket) => ({
          pattern: bucket.key,
          samples: bucket.samples,
          avg24hReturn: bucket.avg24hReturn,
          avg72hReturn: bucket.avg72hReturn,
          winRate24h: bucket.winRate24h,
        }))
        .sort((left, right) => right.samples - left.samples);

      return {
        timeframe,
        days,
        mode,
        totals: {
          samples: mergedRecords.length,
          avg24hReturn: average(mergedRecords.map((record) => record.return24h)),
          avg72hReturn: average(mergedRecords.map((record) => record.return72h)),
          winRate24h: totalsValid24h.length
            ? (totalsValid24h.filter((record) => record.return24h > 0).length / totalsValid24h.length) * 100
            : null,
          avgMaxProfitPct: average(mergedRecords.map((record) => record.maxProfitPct)),
          avgMaxDrawdownPct: average(mergedRecords.map((record) => record.maxDrawdownPct)),
        },
        scoreBuckets,
        patternBuckets,
        harmonicBuckets,
        recent: mergedRecords.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, 25),
      };
    },
  };
}
