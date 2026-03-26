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
 * Backfill labels for collected ml_features rows.
 * For each row where label IS NULL, look up the kline 4h later
 * and compute the forward return.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} opts
 * @param {number}  opts.upThreshold    default 0.02
 * @param {number}  opts.downThreshold  default -0.02
 * @param {number}  opts.batchSize      rows per batch, default 500
 */
export async function backfillLabels(supabase, {
  upThreshold   = 0.02,
  downThreshold = -0.02,
  batchSize     = 500,
} = {}) {
  console.log('[labels] Starting label backfill...');

  let offset = 0;
  let totalUpdated = 0;

  while (true) {
    // Fetch unlabelled rows (ts older than 4h so future price is available)
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('ml_features')
      .select('id, symbol, ts, features')
      .is('label', null)
      .lt('ts', cutoff)
      .order('ts', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error('[labels] Fetch error:', error.message);
      break;
    }

    if (!rows || rows.length === 0) break;

    // For each row, look up what the price was 4h later
    const updates = [];
    for (const row of rows) {
      const futureTs = new Date(new Date(row.ts).getTime() + 4 * 60 * 60 * 1000).toISOString();

      // Find closest feature row for same symbol at future timestamp
      const { data: futureRow } = await supabase
        .from('ml_features')
        .select('features')
        .eq('symbol', row.symbol)
        .gte('ts', futureTs)
        .order('ts', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!futureRow) continue;

      const currentClose = row.features?.macd_line !== undefined
        ? null // can't recover close from features, skip
        : null;

      // Use entry price stored in features if available, else skip
      // We embed close_price as a pseudo-feature for label backfill
      const curClose = row.features?._close_price;
      const futClose = futureRow.features?._close_price;

      if (!curClose || !futClose) continue;

      const forwardReturn = (futClose - curClose) / curClose;
      const label = createLabel(curClose, futClose, upThreshold, downThreshold);

      updates.push({ id: row.id, label, forward_return_4h: forwardReturn });
    }

    if (updates.length > 0) {
      // Batch update
      for (const upd of updates) {
        await supabase
          .from('ml_features')
          .update({ label: upd.label, forward_return_4h: upd.forward_return_4h })
          .eq('id', upd.id);
      }
      totalUpdated += updates.length;
      console.log(`[labels] Updated ${totalUpdated} labels so far...`);
    }

    if (rows.length < batchSize) break;
    offset += batchSize;
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
