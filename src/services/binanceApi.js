const target = (import.meta.env.VITE_API_TARGET || '').trim().replace(/\/$/, '');
const API_BASE = target ? `${target}/api` : '/api';

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with ${response.status}`);
  }

  return response.json();
}

export async function getScannerStatus() {
  return requestJson('/status');
}

export async function getScanResults({ timeframe = '1h', minScore = 60, patterns = [], force = false } = {}) {
  const params = new URLSearchParams();
  params.set('timeframe', timeframe);
  params.set('minScore', String(minScore));

  if (force) {
    params.set('force', '1');
  }

  patterns.forEach((pattern) => params.append('pattern', pattern));

  return requestJson(`/scan?${params.toString()}`);
}

export async function triggerScan(timeframe = '1h') {
  return requestJson('/scan', {
    method: 'POST',
    body: JSON.stringify({ timeframe }),
  });
}

export async function getSymbolOverview(symbol) {
  return requestJson(`/scan/${symbol}`);
}

export async function getSymbolCandles(symbol, { interval = '1h', limit = 72 } = {}) {
  const params = new URLSearchParams({ interval, limit: String(limit) });
  return requestJson(`/chart/${symbol}?${params.toString()}`);
}

export async function getBacktestReport({ timeframe = '1h', days = 14 } = {}) {
  const params = new URLSearchParams({ timeframe, days: String(days) });
  return requestJson(`/backtest/report?${params.toString()}`);
}

export function buildBinanceChartUrl(symbol) {
  return `https://www.binance.com/en/futures/${symbol}`;
}

export function buildTradingViewUrl(symbol) {
  return `https://www.tradingview.com/chart/?symbol=BINANCE%3A${encodeURIComponent(`${symbol}.P`)}`;
}
