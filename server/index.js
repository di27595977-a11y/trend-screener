import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { BacktestJob } from './backtestJob.js';
import { createPersistenceLayer } from './persistence.js';
import { ScanJob, fetchCandles } from './scanJob.js';

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT || '8787', 10);
const persistence = createPersistenceLayer();
const scanJob = new ScanJob({ persistence });
const backtestJob = new BacktestJob({ persistence });

app.use(cors());
app.use(express.json());

app.get('/api/status', (_request, response) => {
  response.json({
    scanner: scanJob.getStatus(),
    backtest: backtestJob.getStatus(),
    persistence: persistence.mode,
  });
});

app.get('/api/scan', async (request, response, next) => {
  try {
    const patterns = Array.isArray(request.query.pattern)
      ? request.query.pattern
      : request.query.pattern
        ? [request.query.pattern]
        : [];
    const timeframe = request.query.timeframe || '1h';
    const minScore = Number.parseInt(request.query.minScore || '60', 10);
    const force = request.query.force === '1';
    const result = await scanJob.getResults({
      timeframe,
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

  scanJob.scanTimeframe(timeframe, { force: true }).catch((error) => {
    console.error('Manual scan failed', error);
  });

  response.status(202).json({ ok: true, timeframe });
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
    const limit = Number.parseInt(request.query.limit || '72', 10);
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

app.get('/api/backtest/report', async (request, response, next) => {
  try {
    const timeframe = request.query.timeframe || '1h';
    const days = Number.parseInt(request.query.days || '14', 10);
    const report = await backtestJob.getReport({ timeframe, days });
    response.json(report);
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
});
