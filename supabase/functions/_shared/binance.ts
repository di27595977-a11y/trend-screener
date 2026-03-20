import { Candle } from './logic.ts';

const API_BASE = Deno.env.get('BINANCE_API_BASE') || 'https://fapi.binance.com';
const SYMBOL_LIMIT = Number.parseInt(Deno.env.get('BINANCE_SYMBOL_LIMIT') || '', 10);

export async function requestBinance(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${API_BASE}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Binance request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchTradableSymbols() {
  const data = await requestBinance('/fapi/v1/exchangeInfo');
  const symbols = data.symbols
    .filter((item: any) => item.status === 'TRADING' && item.contractType === 'PERPETUAL' && item.quoteAsset === 'USDT')
    .map((item: any) => item.symbol);

  if (Number.isFinite(SYMBOL_LIMIT) && SYMBOL_LIMIT > 0) {
    return symbols.slice(0, SYMBOL_LIMIT);
  }

  return symbols;
}

export async function fetchCandles(
  symbol: string,
  interval: string,
  limit: number,
  extraParams: Record<string, string | number> = {},
): Promise<Candle[]> {
  const data = await requestBinance('/fapi/v1/klines', {
    symbol,
    interval,
    limit,
    ...extraParams,
  });

  return data.map((row: any[]) => ({
    time: row[0] / 1000,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}
