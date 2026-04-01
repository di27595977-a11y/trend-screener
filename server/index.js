import cors from 'cors';
import cron from 'node-cron';
import dotenv from 'dotenv';
import express from 'express';
import { BacktestJob } from './backtestJob.js';
import { createPersistenceLayer } from './persistence.js';
import { ScanJob, fetchCandles, fetchTradableSymbols } from './scanJob.js';
import { getModelMetrics, isModelReady, loadModel, predictSymbol } from './ml/predict.js';
import { trainModel } from './ml/train.js';
import { computeFeatures, FEATURE_COLUMNS } from './ml/features.js';
import { fetchSymbolData, collectFeaturesForSymbol } from './ml/dataPipeline.js';
import { RangeDetector } from './rangeDetector.js';
import { isTelegramConfigured, notifyRangeSignals, notifySignalScores, sendTelegram } from './telegram.js';
import { startTelegramBot } from './telegramBot.js';
import { computeSignalScores } from './signalScore.js';

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT || '8787', 10);
const persistence = createPersistenceLayer();
const scanJob = new ScanJob({ persistence });
const backtestJob = new BacktestJob({ persistence });
const rangeDetector = new RangeDetector();

app.use(cors());
app.use(express.json());

app.get('/api/status', (_request, response) => {
  response.json({
    scanner: scanJob.getStatus(),
    backtest: backtestJob.getStatus(),
    persistence: persistence.mode,
  });
});

app.get('/api/settings', async (_request, response, next) => {
  try {
    response.json(await persistence.getRuntimeSettings());
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', async (request, response, next) => {
  try {
    response.json(await persistence.updateRuntimeSettings(request.body || {}));
  } catch (error) {
    next(error);
  }
});

app.get('/api/scan', async (request, response, next) => {
  try {
    const patterns = Array.isArray(request.query.pattern)
      ? request.query.pattern
      : request.query.pattern
        ? [request.query.pattern]
        : [];
    const timeframe = request.query.timeframe || '1h';
    const mode = request.query.mode || 'trend';
    const bias = request.query.bias || 'long';
    const minScore = request.query.minScore != null ? Number.parseInt(request.query.minScore, 10) : undefined;
    const force = request.query.force === '1';
    const result = await scanJob.getResults({
      timeframe,
      mode,
      bias,
      minScore,
      patterns,
      force,
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/scan', (request, response) => {
  const timeframe = request.body?.timeframe || '1h';
  const mode = request.body?.mode || 'trend';
  const bias = request.body?.bias || 'long';

  scanJob.scanTimeframe(timeframe, { force: true, mode, bias }).catch((error) => {
    console.error('Manual scan failed', error);
  });

  response.status(202).json({ ok: true, timeframe, mode, bias });
});

app.get('/api/scan/:symbol', async (request, response, next) => {
  try {
    const overview = await persistence.getLatestSymbolOverview(request.params.symbol);
    response.json(overview);
  } catch (error) {
    next(error);
  }
});

app.get('/api/chart/:symbol', async (request, response, next) => {
  try {
    const interval = request.query.interval || '1h';
    const limit = Number.parseInt(request.query.limit || '240', 10);
    const candles = await fetchCandles(request.params.symbol.toUpperCase(), interval, limit);

    response.json({
      symbol: request.params.symbol.toUpperCase(),
      interval,
      candles,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/symbols', async (_request, response, next) => {
  try {
    response.json({
      symbols: await fetchTradableSymbols(),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/backtest/report', async (request, response, next) => {
  try {
    const timeframe = request.query.timeframe || '1h';
    const days = request.query.days != null ? Number.parseInt(request.query.days, 10) : undefined;
    const report = await backtestJob.getReport({ timeframe, days });
    response.json(report);
  } catch (error) {
    next(error);
  }
});

app.get('/api/alpha-signals', async (request, response, next) => {
  try {
    const limit = Math.min(Number.parseInt(request.query.limit || '100', 10), 500);
    const signals = await persistence.getAlphaSignals(limit);
    response.json(signals);
  } catch (error) {
    next(error);
  }
});

// ─── Range Detection API ─────────────────────────────────────────────────────

app.get('/api/range/signals', async (request, response, next) => {
  try {
    const timeframe = request.query.timeframe || '1h';
    const topN = request.query.topN ? Number(request.query.topN) : undefined;
    const customSymbols = request.query.customSymbols ? request.query.customSymbols.split(',').filter(Boolean) : [];
    const signals = await rangeDetector.scan(timeframe, { topN, customSymbols });
    response.json({
      signals,
      lastScanAt: rangeDetector.lastScanAt,
      config: rangeDetector.getConfig(),
      telegramConfigured: isTelegramConfigured(),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/range/scan', (request, response) => {
  const timeframe = request.body?.timeframe || '1h';
  rangeDetector
    .scan(timeframe)
    .then((signals) => notifyRangeSignals(signals, rangeDetector))
    .catch((error) => console.error('[Range] Manual scan failed:', error.message));

  response.status(202).json({ ok: true, message: 'Range scan started.' });
});

app.put('/api/range/config', (request, response) => {
  const patch = request.body || {};
  rangeDetector.updateConfig(patch);
  response.json(rangeDetector.getConfig());
});

app.post('/api/range/push-telegram', async (_request, response, next) => {
  try {
    const signals = rangeDetector.getSignals();
    if (!signals.length) {
      response.json({ ok: false, error: '目前沒有訊號可推播' });
      return;
    }
    const sent = await notifyRangeSignals(signals, rangeDetector, { ignoreCooldown: true });
    response.json({ ok: true, sent });
  } catch (error) {
    next(error);
  }
});

app.post('/api/range/test-telegram', async (_request, response, next) => {
  try {
    const result = await sendTelegram('🧪 Trend Screener 區間偵測 — Telegram 連線測試成功！');
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// ─── Signal Score API ────────────────────────────────────────────────────────

app.get('/api/signal-scores', async (request, response, next) => {
  try {
    const timeframe = request.query.timeframe || '1h';
    const topN = Number(request.query.topN) || 80;
    const data = await fetch(
      `${process.env.BINANCE_API_BASE || 'https://fapi.binance.com'}/fapi/v1/ticker/24hr`,
    ).then((r) => r.json());
    const symbols = data
      .filter((t) => t.symbol.endsWith('USDT'))
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, topN)
      .map((t) => t.symbol);
    const scores = await computeSignalScores(symbols, timeframe);
    response.json({ scores, timeframe, scannedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

// ─── ML API Endpoints ────────────────────────────────────────────────────────

app.get('/api/ml/status', (_request, response) => {
  const metrics = getModelMetrics();
  response.json({
    enabled:    process.env.ENABLE_ML === 'true',
    modelReady: isModelReady(),
    metrics,
    featureCount: FEATURE_COLUMNS.length,
  });
});

app.post('/api/ml/train', (request, response) => {
  const epochs    = Number.parseInt(request.body?.epochs    || '50',  10);
  const batchSize = Number.parseInt(request.body?.batchSize || '256', 10);

  // Run training in background
  trainModel({ epochs, batchSize })
    .then((metrics) => {
      console.log('[ML] Training complete.', metrics?.valAccuracy);
      // Reload model after training
      return loadModel();
    })
    .catch((err) => console.error('[ML] Training failed:', err.message));

  response.status(202).json({ ok: true, message: 'Training started in background.' });
});

app.get('/api/ml/features/:symbol', async (request, response, next) => {
  try {
    const symbol = request.params.symbol.toUpperCase();
    const data     = await fetchSymbolData(symbol);
    const features = computeFeatures(data);
    response.json({ symbol, features, featureCount: Object.keys(features).length });
  } catch (error) {
    next(error);
  }
});

app.get('/api/winrate/:symbol', async (request, response, next) => {
  try {
    const symbol = request.params.symbol.toUpperCase();
    const hours  = Math.max(1, Math.min(168, Number.parseInt(request.query.hours || '4', 10)));
    const limit  = Math.min(1000, 90 * 24);

    // Fetch klines + funding rates in parallel
    const [candles, fundingRaw] = await Promise.all([
      fetchCandles(symbol, '1h', limit),
      fetch(`${process.env.BINANCE_API_BASE || 'https://fapi.binance.com'}/fapi/v1/fundingRate?symbol=${symbol}&limit=500`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    ]);

    if (candles.length < hours + 10) {
      response.status(400).json({ error: '歷史資料不足，無法計算' });
      return;
    }

    // Build a funding rate map: timestamp (rounded to 1H) → rate
    const fundingMap = new Map();
    for (const f of fundingRaw) {
      const hourTs = Math.floor(Number(f.fundingTime) / 3_600_000) * 3_600_000;
      fundingMap.set(hourTs, Number(f.fundingRate));
    }

    // Get current funding rate
    const currentFunding = fundingMap.size > 0
      ? [...fundingMap.entries()].sort((a, b) => b[0] - a[0])[0]?.[1] ?? null
      : null;

    // Stats accumulators
    const stats = {
      all:       { wins: 0, total: 0, gain: 0, loss: 0, gainN: 0, lossN: 0, maxG: -Infinity, maxL: -Infinity },
      fundPos:   { wins: 0, total: 0 },   // funding > 0 (longs pay shorts)
      fundNeg:   { wins: 0, total: 0 },   // funding < 0 (shorts pay longs)
      fundHigh:  { wins: 0, total: 0 },   // funding > +0.05% (extreme positive)
      fundLow:   { wins: 0, total: 0 },   // funding < -0.01% (negative)
    };

    for (let i = 0; i < candles.length - hours; i++) {
      const entry = candles[i].close;
      const exit  = candles[i + hours].close;
      const ret   = (exit - entry) / entry;
      const win   = ret > 0;
      const barTs = candles[i].time * 1000;
      const hourTs = Math.floor(barTs / 3_600_000) * 3_600_000;

      // All-time stats
      const s = stats.all;
      s.total++;
      if (win) { s.wins++; s.gain += ret; s.gainN++; s.maxG = Math.max(s.maxG, ret); }
      else      { s.loss += Math.abs(ret); s.lossN++; s.maxL = Math.max(s.maxL, Math.abs(ret)); }

      // Funding-conditioned stats
      // Find nearest funding rate at or before this bar
      let fr = null;
      for (let lookback = 0; lookback <= 8; lookback++) {
        const ts = hourTs - lookback * 3_600_000;
        if (fundingMap.has(ts)) { fr = fundingMap.get(ts); break; }
      }

      if (fr !== null) {
        if (fr > 0)       { stats.fundPos.total++;  if (win) stats.fundPos.wins++;  }
        if (fr < 0)       { stats.fundNeg.total++;  if (win) stats.fundNeg.wins++;  }
        if (fr > 0.0005)  { stats.fundHigh.total++; if (win) stats.fundHigh.wins++; }
        if (fr < -0.0001) { stats.fundLow.total++;  if (win) stats.fundLow.wins++;  }
      }
    }

    const s = stats.all;
    const winRate       = s.wins / s.total;
    const avgGain       = s.gainN > 0 ? s.gain / s.gainN : 0;
    const avgLoss       = s.lossN > 0 ? s.loss / s.lossN : 0;
    const expectedValue = winRate * avgGain - (1 - winRate) * avgLoss;

    const wr = (st) => st.total >= 10 ? st.wins / st.total : null;

    // ML prediction
    let mlData = null;
    if (isModelReady()) {
      try { mlData = await predictSymbol(symbol); } catch { /* ignore */ }
    }

    response.json({
      symbol, hours,
      winRate,
      sampleCount:    s.total,
      avgGain, avgLoss, expectedValue,
      maxGain: s.maxG === -Infinity ? 0 : s.maxG,
      maxLoss: s.maxL === -Infinity ? 0 : s.maxL,
      currentPrice:   candles[candles.length - 1].close,
      // Funding rate analysis
      currentFunding,
      funding: {
        positive:     { winRate: wr(stats.fundPos),  sampleCount: stats.fundPos.total  },
        negative:     { winRate: wr(stats.fundNeg),  sampleCount: stats.fundNeg.total  },
        extremeHigh:  { winRate: wr(stats.fundHigh), sampleCount: stats.fundHigh.total },
        extremeLow:   { winRate: wr(stats.fundLow),  sampleCount: stats.fundLow.total  },
      },
      mlScore:     mlData?.ml_score     ?? null,
      mlDirection: mlData?.ml_direction ?? null,
      mlProb:      mlData?.ml_probability ?? null,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/ml/predict/:symbol', async (request, response, next) => {
  try {
    const symbol = request.params.symbol.toUpperCase();
    if (!isModelReady()) {
      response.status(503).json({ error: 'ML model not ready. Train the model first.' });
      return;
    }
    const result = await predictSymbol(symbol);
    if (!result) {
      response.status(500).json({ error: 'Prediction failed.' });
      return;
    }
    response.json({ symbol, ...result });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const message = error?.message || 'Unexpected server error';
  response.status(500).send(message);
});

app.listen(port, () => {
  console.log(`Trend Screener API listening on http://localhost:${port}`);
  scanJob.start();
  backtestJob.start();

  // ── Range Detector Scheduler ─────────────────────────────────────────────
  // Scan every 5 minutes (data only, NO auto Telegram push)
  const runRangeScan = async () => {
    try {
      await rangeDetector.scan();
    } catch (err) {
      console.error('[Range] Scheduled scan failed:', err.message);
    }
  };

  setTimeout(runRangeScan, 30_000);
  cron.schedule('*/5 * * * *', runRangeScan);
  console.log(`[Range] Scheduler: every 5min (no auto push), telegram=${isTelegramConfigured()}`);

  // ── Telegram Bot (inline buttons, manual push only) ───────────────────────
  startTelegramBot(rangeDetector);

  // ── ML Scheduler ────────────────────────────────────────────────────────
  if (process.env.ENABLE_ML === 'true') {
    // Load model on startup
    loadModel().then((ready) => {
      if (ready) console.log('[ML] Model loaded.');
      else console.log('[ML] No trained model yet.');
    });

    // Every 4H: collect features for all symbols (current bar)
    cron.schedule('0 */4 * * *', async () => {
      console.log('[ML] 4H feature collection started...');
      try {
        const symbols = await fetchTradableSymbols();
        let done = 0;
        for (const symbol of symbols) {
          await collectFeaturesForSymbol(persistence, symbol);
          done++;
          if (done % 50 === 0) console.log(`[ML] collected ${done}/${symbols.length}`);
        }
        console.log(`[ML] 4H collection complete: ${done} symbols`);
      } catch (err) {
        console.error('[ML] 4H collection failed:', err.message);
      }
    });

    // Every day at 03:00 UTC: retrain model with accumulated data
    cron.schedule('0 3 * * *', async () => {
      console.log('[ML] Daily retraining started...');
      try {
        const metrics = await trainModel({ epochs: 50, batchSize: 256 });
        console.log(`[ML] Retraining done. Val accuracy: ${(metrics.valAccuracy * 100).toFixed(2)}%`);
        await loadModel();  // reload fresh weights
      } catch (err) {
        console.error('[ML] Retraining failed:', err.message);
      }
    });

    console.log('[ML] Scheduler: 4H collection + daily 03:00 UTC retraining enabled.');
  }
});
