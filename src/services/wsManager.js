const MINI_TICKER_STREAM = 'wss://fstream.binance.com/ws/!miniTicker@arr';

class BinanceWSManager {
  constructor() {
    this.connections = new Map();
    this.priceCallbacks = new Set();
    this.klineCallbacks = new Set();
    this.connectionCallbacks = new Set();
    this.miniTickerConnection = null;
    this.miniTickerManualClose = false;
    this.miniTickerReconnectTimer = null;
  }

  emitConnection(payload) {
    this.connectionCallbacks.forEach((callback) => callback(payload));
  }

  connectMiniTicker() {
    if (this.miniTickerConnection?.readyState === WebSocket.OPEN || this.miniTickerConnection?.readyState === WebSocket.CONNECTING) {
      return this.miniTickerConnection;
    }

    this.miniTickerManualClose = false;
    const ws = new WebSocket(MINI_TICKER_STREAM);

    ws.onopen = () => {
      this.emitConnection({ channel: 'miniTicker', status: 'open' });
    };

    ws.onmessage = (event) => {
      const tickers = JSON.parse(event.data);
      const priceMap = {};

      tickers.forEach((ticker) => {
        priceMap[ticker.s] = {
          price: Number.parseFloat(ticker.c),
          high24h: Number.parseFloat(ticker.h),
          low24h: Number.parseFloat(ticker.l),
          volume24h: Number.parseFloat(ticker.v),
          change24h: Number.parseFloat(ticker.P || 0),
        };
      });

      this.priceCallbacks.forEach((callback) => callback(priceMap));
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onclose = () => {
      this.emitConnection({ channel: 'miniTicker', status: 'closed' });

      if (!this.miniTickerManualClose) {
        this.miniTickerReconnectTimer = window.setTimeout(() => this.connectMiniTicker(), 3000);
      }
    };

    this.miniTickerConnection = ws;
    return ws;
  }

  disconnectMiniTicker() {
    this.miniTickerManualClose = true;

    if (this.miniTickerReconnectTimer) {
      window.clearTimeout(this.miniTickerReconnectTimer);
      this.miniTickerReconnectTimer = null;
    }

    if (this.miniTickerConnection) {
      this.miniTickerConnection.close();
      this.miniTickerConnection = null;
    }
  }

  connectKline(symbol, interval = '1h') {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    const existing = this.connections.get(stream);

    if (existing) {
      existing.refCount += 1;
      return existing.ws;
    }

    const ws = new WebSocket(`wss://fstream.binance.com/ws/${stream}`);
    const entry = { ws, refCount: 1, manualClose: false };

    ws.onopen = () => {
      this.emitConnection({ channel: stream, status: 'open' });
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const kline = {
        time: data.k.t / 1000,
        open: Number.parseFloat(data.k.o),
        high: Number.parseFloat(data.k.h),
        low: Number.parseFloat(data.k.l),
        close: Number.parseFloat(data.k.c),
        volume: Number.parseFloat(data.k.v),
        isClosed: data.k.x,
      };

      this.klineCallbacks.forEach((callback) => callback(symbol, interval, kline));
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onclose = () => {
      this.emitConnection({ channel: stream, status: 'closed' });
      this.connections.delete(stream);

      if (!entry.manualClose) {
        window.setTimeout(() => this.connectKline(symbol, interval), 3000);
      }
    };

    this.connections.set(stream, entry);
    return ws;
  }

  disconnectKline(symbol, interval = '1h') {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    const entry = this.connections.get(stream);

    if (!entry) {
      return;
    }

    entry.refCount -= 1;

    if (entry.refCount <= 0) {
      entry.manualClose = true;
      entry.ws.close();
      this.connections.delete(stream);
    }
  }

  onPriceUpdate(callback) {
    this.priceCallbacks.add(callback);
    return () => this.priceCallbacks.delete(callback);
  }

  onKlineUpdate(callback) {
    this.klineCallbacks.add(callback);
    return () => this.klineCallbacks.delete(callback);
  }

  onConnectionChange(callback) {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }
}

export default new BinanceWSManager();
