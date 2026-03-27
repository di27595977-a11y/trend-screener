// server/ml/labels.js
// Label generation for ML training data

/**
 * Create a label from price returns.
 * @param {number} currentClose
 * @param {number} futureClose    - close price 4h later
 * @param {number} upThreshold    - default +2%
 * @param {number} downThreshold  - default -2%
 * @returns {-1|0|1}
 */
export function createLabel(currentClose, futureClose, upThreshold = 0.02, downThreshold = -0.02) {
  if (!currentClose || !futureClose) return 0;
  const ret = (futureClose - currentClose) / currentClose;
  if (ret > upThreshold)  return  1;
  if (ret < downThreshold) return -1;
  return 0;
}

/**
 * Fetch all rows for a symbol in paginated fashion.
 */
async function fetchAllForSymbol(supabase, symbol) {
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabase
      .from('ml_features')
      .select('id, ts, features, label')
      .eq('symbol', symbol)
      .order('ts', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Fetch error for ${symbol}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

/**
 * Backfill labels for collected ml_features rows.
 * Optimized: loads all rows per symbol at once, does local join to find 4h-future price.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} opts
 */
export async function backfillLabels(supabase, {
  upThreshold   = 0.02,
  downThreshold = -0.02,
} = {}) {
  console.log('[labels] Starting optimized label backfill...');

  // 1. Get distinct symbols that have unlabelled rows
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data: symbolRows, error: symErr } = await supabase
    .from('ml_features')
    .select('symbol')
    .is('label', null)
    .lt('ts', cutoff)
    .limit(10000);

  if (symErr) {
    console.error('[labels] Error fetching symbols:', symErr.message);
    return 0;
  }

  const symbols = [...new Set(symbolRows.map(r => r.symbol))];
  console.log(`[labels] Found ${symbols.length} symbols with unlabelled data.`);

  let totalUpdated = 0;

  for (let si = 0; si < symbols.length; si++) {
    const symbol = symbols[si];

    // Load ALL rows for this symbol (sorted by ts)
    const rows = await fetchAllForSymbol(supabase, symbol);

    // Build a time-sorted array for binary search of future price
    const timeIndex = rows.map(r => ({ ts: new Date(r.ts).getTime(), close: r.features?._close_price }));

    const updates = [];
    for (const row of rows) {
      if (row.label !== null) continue; // already labelled

      const rowTs = new Date(row.ts).getTime();
      if (rowTs > Date.now() - 4 * 60 * 60 * 1000) continue; // too recent

      const curClose = row.features?._close_price;
      if (!curClose) continue;

      // Find the first row with ts >= rowTs + 4h
      const targetTs = rowTs + 4 * 60 * 60 * 1000;
      let futClose = null;
      for (let i = 0; i < timeIndex.length; i++) {
        if (timeIndex[i].ts >= targetTs && timeIndex[i].close) {
          futClose = timeIndex[i].close;
          break;
        }
      }

      if (!futClose) continue;

      const forwardReturn = (futClose - curClose) / curClose;
      const label = createLabel(curClose, futClose, upThreshold, downThreshold);

      updates.push({ id: row.id, label, forward_return_4h: forwardReturn });
    }

    // Batch update via parallel chunks
    if (updates.length > 0) {
      const CHUNK = 50;
      for (let c = 0; c < updates.length; c += CHUNK) {
        const chunk = updates.slice(c, c + CHUNK);
        await Promise.all(chunk.map(upd =>
          supabase
            .from('ml_features')
            .update({ label: upd.label, forward_return_4h: upd.forward_return_4h })
            .eq('id', upd.id)
        ));
      }
      totalUpdated += updates.length;
    }

    console.log(`[labels] ${si + 1}/${symbols.length} ${symbol}: ${updates.length} labelled (total: ${totalUpdated})`);
  }

  console.log(`[labels] Backfill complete. Total updated: ${totalUpdated}`);
  return totalUpdated;
}

// CLI: node server/ml/labels.js --backfill
if (process.argv.includes('--backfill')) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config();

  const { createClient } = await import('@supabase/supabase-js');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  backfillLabels(supabase).then((n) => {
    console.log(`Done: ${n} rows labelled.`);
    process.exit(0);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
