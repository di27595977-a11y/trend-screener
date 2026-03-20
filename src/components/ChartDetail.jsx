import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CandlestickSeries, HistogramSeries, createChart } from 'lightweight-charts';
import PatternRenderer from './PatternRenderer';
import PatternTags from './PatternTags';
import ScoreBadge from './ScoreBadge';
import { buildBinanceChartUrl, buildTradingViewUrl, getSymbolCandles, getSymbolOverview } from '../services/binanceApi';
import wsManager from '../services/wsManager';
import { detectAllPatterns } from '../services/patternDetection';
import { evaluateTrend } from '../services/indicators';
import { calculateTrendScore } from '../utils/scoring';

function toCandleSeriesData(candles) {
  return candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function toVolumeSeriesData(candles) {
  return candles.map((candle) => ({
    time: candle.time,
    value: candle.volume,
    color: candle.close >= candle.open ? '#34d39966' : '#fb718566',
  }));
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  if (value >= 1000) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function formatPercent(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return `${value.toFixed(digits)}%`;
}

function fallbackOverview(candles) {
  const recent = candles.slice(-24);
  const metrics = evaluateTrend(recent);

  return {
    trendScore: calculateTrendScore(metrics),
    rSquared: metrics.rSquared,
    priceChangePct: metrics.priceChange,
    entryPrice: recent.at(-1)?.close ?? null,
    timeframe: '1h',
  };
}

export default function ChartDetail() {
  const { symbol } = useParams();
  const location = useLocation();
  const initialCoin = location.state?.coin || null;
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const rendererRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const chartReadyRef = useRef(false);
  const shouldRecalculatePatternsRef = useRef(true);
  const [candles, setCandles] = useState([]);
  const [overview, setOverview] = useState(initialCoin);
  const [patterns, setPatterns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [livePrice, setLivePrice] = useState(initialCoin?.entryPrice || null);
  const [toggles, setToggles] = useState({
    supportResistance: true,
    triangle: true,
    reversals: true,
    swingPoints: true,
  });

  useEffect(() => {
    if (!containerRef.current || chartRef.current) {
      return undefined;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 520,
      layout: {
        background: { color: '#09101d' },
        textColor: '#94a3b8',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: '#172236' },
        horzLines: { color: '#172236' },
      },
      rightPriceScale: {
        borderColor: '#243349',
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#243349',
      },
      crosshair: {
        vertLine: { color: '#334155', labelBackgroundColor: '#111827' },
        horzLine: { color: '#334155', labelBackgroundColor: '#111827' },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      borderVisible: false,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    const renderer = new PatternRenderer(chart, candleSeries);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    rendererRef.current = renderer;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      chart.applyOptions({
        width: entry.contentRect.width,
        height: 520,
      });
      renderer.render();
    });
    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      renderer.destroy();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const [candleResponse, overviewResponse] = await Promise.all([getSymbolCandles(symbol), getSymbolOverview(symbol)]);

        if (cancelled) {
          return;
        }

        const nextCandles = candleResponse.candles || [];

        setCandles(nextCandles);
        setOverview(overviewResponse.best || initialCoin || fallbackOverview(nextCandles));
        setPatterns(detectAllPatterns(nextCandles));
        setLivePrice(nextCandles.at(-1)?.close ?? null);
        setError('');
        shouldRecalculatePatternsRef.current = false;
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          chartReadyRef.current = false;
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [initialCoin, symbol]);

  useEffect(() => {
    if (!candles.length || !candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) {
      return;
    }

    candleSeriesRef.current.setData(toCandleSeriesData(candles));
    volumeSeriesRef.current.setData(toVolumeSeriesData(candles));

    if (!chartReadyRef.current) {
      chartRef.current.timeScale().fitContent();
      chartReadyRef.current = true;
    }
  }, [candles]);

  const visiblePatterns = useMemo(() => {
    if (!patterns) {
      return null;
    }

    return {
      supportResistance: toggles.supportResistance ? patterns.supportResistance : [],
      triangle: toggles.triangle ? patterns.triangle : null,
      wBottom: toggles.reversals ? patterns.wBottom : null,
      mTop: toggles.reversals ? patterns.mTop : null,
      swingPoints: toggles.swingPoints ? patterns.swingPoints : null,
    };
  }, [patterns, toggles]);

  useEffect(() => {
    rendererRef.current?.setPatterns(visiblePatterns);
  }, [visiblePatterns]);

  useEffect(() => {
    const unsubscribe = wsManager.onKlineUpdate((nextSymbol, interval, kline) => {
      if (nextSymbol !== symbol || interval !== '1h') {
        return;
      }

      setLivePrice(kline.close);
      setCandles((current) => {
        if (!current.length) {
          return current;
        }

        const next = [...current];
        const last = next.at(-1);

        if (last?.time === kline.time) {
          next[next.length - 1] = kline;
        } else if (kline.time > (last?.time || 0)) {
          next.push(kline);
        }

        shouldRecalculatePatternsRef.current = kline.isClosed;
        return next.slice(-72);
      });
    });

    wsManager.connectKline(symbol, '1h');

    return () => {
      unsubscribe();
      wsManager.disconnectKline(symbol, '1h');
    };
  }, [symbol]);

  useEffect(() => {
    if (!candles.length || !shouldRecalculatePatternsRef.current) {
      return;
    }

    setPatterns(detectAllPatterns(candles));
    shouldRecalculatePatternsRef.current = false;
  }, [candles]);

  const scoreSource = overview || fallbackOverview(candles);

  return (
    <div className="space-y-6">
      <section className="panel rounded-[28px] px-5 py-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white">
              <span aria-hidden="true">←</span>
              Back to dashboard
            </Link>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h2 className="font-mono text-3xl font-semibold text-white">{symbol}</h2>
              <ScoreBadge score={scoreSource?.trendScore || 0} />
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
                {scoreSource?.timeframe?.toUpperCase() || '1H'} scan basis
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-sm text-slate-300">
              <span>Live {formatPrice(livePrice)}</span>
              <span>R2 {scoreSource?.rSquared?.toFixed?.(2) || '--'}</span>
              <span>Change {formatPercent(scoreSource?.priceChangePct)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={buildBinanceChartUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-sm font-medium text-emerald-50 transition hover:border-emerald-300/50"
            >
              Open on Binance
            </a>
            <a
              href={buildTradingViewUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20"
            >
              Open on TradingView
            </a>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="panel rounded-[28px] px-5 py-5">
          <div ref={containerRef} className="h-[520px] w-full overflow-hidden rounded-[24px] border border-white/10 bg-[#09101d]" />
          {loading && <p className="mt-4 text-sm text-slate-300">Loading 72 x 1H candles...</p>}
        </div>

        <div className="space-y-6">
          <section className="panel rounded-[28px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Detected patterns</p>
            <div className="mt-4">
              <PatternTags patterns={patterns} emptyLabel="No major structure yet" />
            </div>
          </section>

          <section className="panel rounded-[28px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Overlay toggles</p>
            <div className="mt-4 space-y-2">
              {[
                ['supportResistance', 'Support / resistance'],
                ['triangle', 'Triangle'],
                ['reversals', 'W / M reversal'],
                ['swingPoints', 'Swing points'],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={toggles[key]}
                    onChange={(event) =>
                      setToggles((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-emerald-400"
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="panel rounded-[28px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Structure notes</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">Support / resistance</p>
                <p className="mt-1">
                  {patterns?.supportResistance?.length
                    ? patterns.supportResistance
                        .slice(0, 2)
                        .map((level) => `${level.type} ${formatPrice(level.price)} x${level.touches}`)
                        .join(' / ')
                    : 'No repeated level clusters in the last 72 bars.'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">Triangle</p>
                <p className="mt-1">
                  {patterns?.triangle ? `Detected ${patterns.triangle.type} triangle from recent swing compression.` : 'No active triangle compression.'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">W / M setup</p>
                <p className="mt-1">
                  {patterns?.wBottom
                    ? `W bottom neckline ${formatPrice(patterns.wBottom.necklinePrice)}${patterns.wBottom.isBreakout ? ' already broken.' : ' still under neckline.'}`
                    : patterns?.mTop
                      ? `M top neckline ${formatPrice(patterns.mTop.necklinePrice)}${patterns.mTop.isBreakdown ? ' already broken.' : ' still holding.'}`
                      : 'No clear W or M reversal structure in the current window.'}
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
