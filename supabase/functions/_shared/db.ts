import { createClient } from 'npm:@supabase/supabase-js@2';
import { scoreBucket } from './logic.ts';

export function createAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percentChange(entryPrice: number | null | undefined, exitPrice: number | null | undefined) {
  if (!entryPrice || exitPrice == null) return null;
  return ((exitPrice - entryPrice) / entryPrice) * 100;
}

function harmonicFamilyKeys(item: { detectedPatterns: string[] }) {
  const families = new Set<string>();

  item.detectedPatterns.forEach((pattern) => {
    if (!pattern.startsWith('harmonic:')) {
      return;
    }

    const [, name, direction] = pattern.split(':');
    families.add(`harmonic_family:${name}:${direction}`);
  });

  return Array.from(families);
}

export async function setAppState(admin: ReturnType<typeof createAdminClient>, key: string, value: Record<string, unknown>) {
  const { error } = await admin.from('app_state').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}

export async function getAppState(admin: ReturnType<typeof createAdminClient>, key: string) {
  const { data, error } = await admin.from('app_state').select('*').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}

export async function recordScan(
  admin: ReturnType<typeof createAdminClient>,
  payload: {
    timeframe: string;
    totalSymbols: number;
    filteredCount: number;
    params: Record<string, unknown>;
    scannedAt: string;
    results: Array<Record<string, unknown>>;
  },
) {
  const { data: snapshot, error: snapshotError } = await admin
    .from('scan_snapshots')
    .insert({
      scanned_at: payload.scannedAt,
      timeframe: payload.timeframe,
      total_symbols: payload.totalSymbols,
      filtered_count: payload.filteredCount,
      params: payload.params,
    })
    .select()
    .single();

  if (snapshotError) throw snapshotError;
  if (!payload.results.length) return snapshot;

  const resultPayload = payload.results.map((result) => ({
    snapshot_id: snapshot.id,
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
    created_at: payload.scannedAt,
  }));

  const { data: insertedResults, error: resultError } = await admin.from('scan_results').insert(resultPayload).select();
  if (resultError) throw resultError;

  const backtestPayload = (insertedResults || []).map((row: any) => ({
    scan_result_id: row.id,
    symbol: row.symbol,
    entry_price: row.entry_price,
  }));

  if (backtestPayload.length) {
    const { error: backtestError } = await admin.from('backtest_tracking').insert(backtestPayload);
    if (backtestError) throw backtestError;
  }

  return snapshot;
}

export async function getLatestScanResults(admin: ReturnType<typeof createAdminClient>, timeframe: string) {
  const { data: snapshot, error: snapshotError } = await admin
    .from('scan_snapshots')
    .select('*')
    .eq('timeframe', timeframe)
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError) throw snapshotError;
  if (!snapshot) return { snapshot: null, results: [] };

  const { data: results, error: resultError } = await admin
    .from('scan_results')
    .select('*')
    .eq('snapshot_id', snapshot.id)
    .order('trend_score', { ascending: false });

  if (resultError) throw resultError;

  return {
    snapshot,
    results: (results || []).map((row: any) => ({
      symbol: row.symbol,
      timeframe: row.timeframe,
      trendScore: row.trend_score,
      rSquared: row.r_squared,
      slope: row.slope,
      slopePctPerBar: row.slope_pct_per_bar,
      pullbackRatio: row.pullback_ratio,
      volumeRatio: row.volume_ratio,
      priceChangePct: row.price_change_pct,
      positionScore: row.position_score,
      entryPrice: row.entry_price,
      currentPrice: row.entry_price,
      detectedPatterns: row.detected_patterns || [],
      sparkline: row.sparkline || [],
    })),
  };
}

export async function getLatestSymbolOverview(admin: ReturnType<typeof createAdminClient>, symbol: string) {
  const { data: rows, error } = await admin
    .from('scan_results')
    .select('*')
    .eq('symbol', symbol.toUpperCase())
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;

  const uniqueByTimeframe = Array.from(new Map((rows || []).map((row: any) => [row.timeframe, row])).values());
  const best = [...uniqueByTimeframe].sort((left: any, right: any) => right.trend_score - left.trend_score)[0] || null;

  return {
    symbol: symbol.toUpperCase(),
    best: best
      ? {
          symbol: best.symbol,
          timeframe: best.timeframe,
          trendScore: best.trend_score,
          rSquared: best.r_squared,
          priceChangePct: best.price_change_pct,
          entryPrice: best.entry_price,
          detectedPatterns: best.detected_patterns || [],
        }
      : null,
    results: uniqueByTimeframe,
  };
}

export async function listPendingBacktests(admin: ReturnType<typeof createAdminClient>, limit = 60) {
  const { data: pendingRows, error: pendingError } = await admin
    .from('backtest_tracking')
    .select('*')
    .is('price_72h', null)
    .limit(limit);

  if (pendingError) throw pendingError;
  if (!pendingRows?.length) return [];

  const resultIds = pendingRows.map((row: any) => row.scan_result_id);
  const { data: resultRows, error: resultError } = await admin.from('scan_results').select('*').in('id', resultIds);
  if (resultError) throw resultError;

  const resultMap = new Map((resultRows || []).map((row: any) => [row.id, row]));
  return pendingRows
    .map((row: any) => {
      const result = resultMap.get(row.scan_result_id);
      if (!result) return null;

      return {
        ...row,
        created_at: result.created_at,
        timeframe: result.timeframe,
        trend_score: result.trend_score,
        detected_patterns: result.detected_patterns || [],
      };
    })
    .filter(Boolean);
}

export async function updateBacktestEntry(admin: ReturnType<typeof createAdminClient>, id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from('backtest_tracking').update(patch).eq('id', id);
  if (error) throw error;
}

export async function buildBacktestReport(
  admin: ReturnType<typeof createAdminClient>,
  { timeframe = '1h', days = 30 }: { timeframe?: string; days?: number },
) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data: resultRows, error: resultError } = await admin
    .from('scan_results')
    .select('*')
    .eq('timeframe', timeframe)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (resultError) throw resultError;

  const resultMap = new Map((resultRows || []).map((row: any) => [row.id, row]));
  const { data: backtestRows, error: backtestError } = await admin
    .from('backtest_tracking')
    .select('*')
    .in('scan_result_id', Array.from(resultMap.keys()));

  if (backtestError) throw backtestError;

  const merged = (backtestRows || [])
    .map((row: any) => {
      const result = resultMap.get(row.scan_result_id);
      if (!result) return null;

      const entryPrice = Number(row.entry_price ?? result.entry_price);

      return {
        symbol: result.symbol,
        timeframe: result.timeframe,
        trendScore: result.trend_score,
        entryPrice,
        createdAt: result.created_at,
        detectedPatterns: result.detected_patterns || [],
        return24h: percentChange(entryPrice, row.price_24h),
        return72h: percentChange(entryPrice, row.price_72h),
        maxProfitPct: row.max_profit_pct,
        maxDrawdownPct: row.max_drawdown_pct,
      };
    })
    .filter(Boolean) as any[];

  const totalsValid24h = merged.filter((item) => item.return24h != null);
  const scoreGroups = new Map<string, any[]>();
  const patternGroups = new Map<string, any[]>();
  const harmonicGroups = new Map<string, any[]>();

  merged.forEach((item) => {
    const scoreKey = scoreBucket(item.trendScore);
    if (!scoreGroups.has(scoreKey)) scoreGroups.set(scoreKey, []);
    scoreGroups.get(scoreKey)!.push(item);

    const patterns = item.detectedPatterns.length ? item.detectedPatterns : ['trend_only'];
    patterns.forEach((pattern: string) => {
      if (!patternGroups.has(pattern)) patternGroups.set(pattern, []);
      patternGroups.get(pattern)!.push(item);
    });

    harmonicFamilyKeys(item).forEach((pattern) => {
      if (!harmonicGroups.has(pattern)) harmonicGroups.set(pattern, []);
      harmonicGroups.get(pattern)!.push(item);
    });
  });

  return {
    timeframe,
    days,
    mode: 'supabase',
    totals: {
      samples: merged.length,
      avg24hReturn: average(merged.map((item) => item.return24h)),
      avg72hReturn: average(merged.map((item) => item.return72h)),
      winRate24h: totalsValid24h.length
        ? (totalsValid24h.filter((item) => item.return24h > 0).length / totalsValid24h.length) * 100
        : null,
      avgMaxProfitPct: average(merged.map((item) => item.maxProfitPct)),
      avgMaxDrawdownPct: average(merged.map((item) => item.maxDrawdownPct)),
    },
    scoreBuckets: Array.from(scoreGroups.entries()).map(([bucket, items]) => ({
      bucket,
      samples: items.length,
      avg24hReturn: average(items.map((item) => item.return24h)),
      avg72hReturn: average(items.map((item) => item.return72h)),
      winRate24h: items.filter((item) => item.return24h != null).length
        ? (items.filter((item) => (item.return24h ?? -999) > 0).length / items.filter((item) => item.return24h != null).length) * 100
        : null,
    })),
    patternBuckets: Array.from(patternGroups.entries())
      .map(([pattern, items]) => ({
        pattern,
        samples: items.length,
        avg24hReturn: average(items.map((item) => item.return24h)),
        avg72hReturn: average(items.map((item) => item.return72h)),
        winRate24h: items.filter((item) => item.return24h != null).length
          ? (items.filter((item) => (item.return24h ?? -999) > 0).length / items.filter((item) => item.return24h != null).length) * 100
          : null,
      }))
      .sort((left, right) => right.samples - left.samples)
      .slice(0, 12),
    harmonicBuckets: Array.from(harmonicGroups.entries())
      .map(([pattern, items]) => ({
        pattern,
        samples: items.length,
        avg24hReturn: average(items.map((item) => item.return24h)),
        avg72hReturn: average(items.map((item) => item.return72h)),
        winRate24h: items.filter((item) => item.return24h != null).length
          ? (items.filter((item) => (item.return24h ?? -999) > 0).length / items.filter((item) => item.return24h != null).length) * 100
          : null,
      }))
      .sort((left, right) => right.samples - left.samples),
    recent: merged.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 25),
  };
}
