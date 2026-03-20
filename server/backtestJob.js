import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { createPersistenceLayer } from './persistence.js';
import { fetchCandles } from './scanJob.js';

dotenv.config();

const BACKTEST_INTERVAL_MS = Math.max(Number.parseInt(process.env.BACKTEST_INTERVAL_MINUTES || '60', 10), 1) * 60 * 1000;

function pickPriceAtHours(candles, createdAtMs, hours) {
  const targetTime = createdAtMs + hours * 60 * 60 * 1000;

  if (Date.now() < targetTime) {
    return null;
  }

  const candle = candles.find((item) => item.time * 1000 >= targetTime) || candles.at(-1);
  return candle?.close ?? null;
}

function calculateRangeStats(candles, entryPrice) {
  if (!candles.length || !entryPrice) {
    return { maxProfitPct: null, maxDrawdownPct: null };
  }

  const maxHigh = Math.max(...candles.map((candle) => candle.high));
  const minLow = Math.min(...candles.map((candle) => candle.low));

  return {
    maxProfitPct: ((maxHigh - entryPrice) / entryPrice) * 100,
    maxDrawdownPct: ((minLow - entryPrice) / entryPrice) * 100,
  };
}

export class BacktestJob {
  constructor({ persistence, logger = console, intervalMs = BACKTEST_INTERVAL_MS } = {}) {
    this.persistence = persistence;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.status = {
      isRunning: false,
      lastRunAt: null,
      nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
      lastProcessed: 0,
    };
  }

  getStatus() {
    return this.status;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.run().catch((error) => {
      this.logger.error('Initial backtest run failed', error);
    });

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error('Scheduled backtest run failed', error);
      });
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run() {
    this.status.isRunning = true;
    const pendingEntries = await this.persistence.listPendingBacktests(150);
    let processed = 0;

    for (const entry of pendingEntries) {
      const createdAtMs = new Date(entry.created_at).getTime();
      const endTime = Math.min(createdAtMs + 72 * 60 * 60 * 1000, Date.now());
      const candles = await fetchCandles(entry.symbol, '1h', 72, {
        startTime: createdAtMs,
        endTime,
      });

      if (!candles.length) {
        continue;
      }

      const rangeStats = calculateRangeStats(candles, entry.entry_price);
      const patch = {
        updated_at: new Date().toISOString(),
        price_1h: entry.price_1h ?? pickPriceAtHours(candles, createdAtMs, 1),
        price_4h: entry.price_4h ?? pickPriceAtHours(candles, createdAtMs, 4),
        price_12h: entry.price_12h ?? pickPriceAtHours(candles, createdAtMs, 12),
        price_24h: entry.price_24h ?? pickPriceAtHours(candles, createdAtMs, 24),
        price_48h: entry.price_48h ?? pickPriceAtHours(candles, createdAtMs, 48),
        price_72h: entry.price_72h ?? pickPriceAtHours(candles, createdAtMs, 72),
        max_profit_pct: rangeStats.maxProfitPct,
        max_drawdown_pct: rangeStats.maxDrawdownPct,
      };

      await this.persistence.updateBacktestEntry(entry.id, patch);
      processed += 1;
    }

    this.status.isRunning = false;
    this.status.lastRunAt = new Date().toISOString();
    this.status.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
    this.status.lastProcessed = processed;

    return { processed };
  }

  async getReport(params) {
    return this.persistence.buildBacktestReport(params);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const persistence = createPersistenceLayer();
  const job = new BacktestJob({ persistence });

  job
    .run()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
