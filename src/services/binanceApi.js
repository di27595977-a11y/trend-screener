import { createSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const target = (import.meta.env.VITE_API_TARGET || '').trim().replace(/\/$/, '');
const API_BASE = target ? `${target}/api` : '/api';
const supabase =
  !target && isSupabaseConfigured({ url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY })
    ? createSupabaseClient({ url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY })
    : null;

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

async function invokeTrendApi(action, payload = {}) {
  if (supabase) {
    const { data, error } = await supabase.functions.invoke('trend-api', {
      body: {
        action,
        ...payload,
      },
    });

    if (error) {
      throw error;
    }

    return data;
  }

  return null;
}

export async function getScannerStatus() {
  const data = await invokeTrendApi('status');
  if (data) return data;
  return requestJson('/status');
}

export async function getRuntimeSettings() {
  const data = await invokeTrendApi('get-settings');
  if (data) return data;
  return requestJson('/settings');
}

export async function updateRuntimeSettings(settings) {
  const data = await invokeTrendApi('update-settings', { settings });
  if (data) return data;

  return requestJson('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function getScanResults({ timeframe = '1h', minScore = 55, patterns = [], force = false } = {}) {
  const data = await invokeTrendApi('scan-results', { timeframe, minScore, patterns, force });
  if (data) return data;

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
  const data = await invokeTrendApi('run-scan', { timeframe });
  if (data) return data;

  return requestJson('/scan', {
    method: 'POST',
    body: JSON.stringify({ timeframe }),
  });
}

export async function getSymbolOverview(symbol) {
  const data = await invokeTrendApi('symbol-overview', { symbol });
  if (data) return data;
  return requestJson(`/scan/${symbol}`);
}

export async function getSymbolCandles(symbol, { interval = '1h', limit = 72 } = {}) {
  const data = await invokeTrendApi('chart-data', { symbol, interval, limit });
  if (data) return data;

  const params = new URLSearchParams({ interval, limit: String(limit) });
  return requestJson(`/chart/${symbol}?${params.toString()}`);
}

export async function getBacktestReport({ timeframe = '1h', days = 30 } = {}) {
  const data = await invokeTrendApi('backtest-report', { timeframe, days });
  if (data) return data;

  const params = new URLSearchParams({ timeframe, days: String(days) });
  return requestJson(`/backtest/report?${params.toString()}`);
}

export function buildBinanceChartUrl(symbol) {
  return `https://www.binance.com/en/futures/${symbol}`;
}

export function buildTradingViewUrl(symbol) {
  return `https://www.tradingview.com/chart/?symbol=BINANCE%3A${encodeURIComponent(`${symbol}.P`)}`;
}
