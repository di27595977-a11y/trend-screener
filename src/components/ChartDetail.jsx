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

const COPY = {
  back: '\u56de\u5230\u5100\u8868\u677f',
  scoringMode: '\u8a55\u5206\u6a21\u5f0f',
  currentPrice: '\u73fe\u50f9',
  change: '\u6f32\u5e45',
  openBinance: '\u5728 Binance \u958b\u555f',
  openTradingView: '\u5728 TradingView \u958b\u555f',
  loading: '\u6b63\u5728\u8f09\u5165\u904e\u53bb 72 \u6839 1H K \u7dda...',
  detectedPatterns: '\u5075\u6e2c\u5230\u7684\u5f62\u614b',
  patternEmpty: '\u7d14\u8da8\u52e2',
  toggles: '\u986f\u793a\u958b\u95dc',
  harmonicRatios: '\u8ae7\u6ce2\u6bd4\u7387',
  confidence: '\u53ef\u4fe1\u5ea6',
  actualRatio: '\u5be6\u969b\u6bd4\u7387',
  targetRange: '\u7406\u60f3\u7bc4\u570d',
  insights: '\u5feb\u901f\u89c0\u5bdf',
  supportResistance: '\u652f\u6490 / \u58d3\u529b',
  triangle: '\u4e09\u89d2\u6536\u6582',
  harmonic: '\u8ae7\u6ce2\u5f62\u614b',
  reversals: 'W / M \u53cd\u8f49',
  swingPoints: '\u8f49\u6298\u9ede',
  noLevels: '\u76ee\u524d\u6c92\u6709\u627e\u5230\u91cd\u8907\u78b0\u89f8\u7684\u95dc\u9375\u50f9\u4f4d\u3002',
  noTriangle: '\u76ee\u524d\u6c92\u6709\u660e\u986f\u7684\u6536\u6582\u4e09\u89d2\uff0c\u53ef\u4ee5\u5148\u89c0\u5bdf\u9ad8\u4f4e\u9ede\u662f\u5426\u958b\u59cb\u6536\u655b\u3002',
  noHarmonic: '\u76ee\u524d\u6c92\u6709\u5b8c\u6574\u7684 XABCD \u8ae7\u6ce2\u7d50\u69cb\u3002',
  noReversal: '\u76ee\u524d\u6c92\u6709\u5b8c\u6574\u7684 W \u5e95\u6216 M \u9802\u7d50\u69cb\u3002',
};

const TOGGLE_OPTIONS = [
  ['supportResistance', COPY.supportResistance],
  ['triangle', COPY.triangle],
  ['harmonic', COPY.harmonic],
  ['reversals', COPY.reversals],
  ['swingPoints', COPY.swingPoints],
];

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
    return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  return value.toLocaleString('zh-TW', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function formatPercent(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return `${value.toFixed(digits)}%`;
}

function formatRatio(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return value.toFixed(3);
}

function formatRatioTarget(range) {
  if (!range?.length) {
    return '--';
  }

  const [min, max] = range;

  if (Math.abs(max - min) < 0.0005) {
    return formatRatio(min);
  }

  return `${formatRatio(min)} - ${formatRatio(max)}`;
}

function formatLevelType(type) {
  return type === 'support' ? '\u652f\u6490' : '\u58d3\u529b';
}

function formatTriangleType(type) {
  return (
    {
      ascending: '\u4e0a\u5347\u4e09\u89d2',
      descending: '\u4e0b\u964d\u4e09\u89d2',
      symmetric: '\u5c0d\u7a31\u4e09\u89d2',
    }[type] || '\u4e09\u89d2\u6536\u6582'
  );
}

function formatHarmonicDirection(direction) {
  return direction === 'bullish' ? '\u725b\u8ae7\u6ce2' : '\u718a\u8ae7\u6ce2';
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

function buildLevelSummary(patterns) {
  if (!patterns?.supportResistance?.length) {
    return COPY.noLevels;
  }

  return patterns.supportResistance
    .slice(0, 2)
    .map((level) => `${formatLevelType(level.type)} ${formatPrice(level.price)} \u00d7${level.touches}`)
    .join(' / ');
}

function buildTriangleSummary(patterns) {
  if (!patterns?.triangle) {
    return COPY.noTriangle;
  }

  return `\u6700\u8fd1\u7d50\u69cb\u504f\u5411 ${formatTriangleType(patterns.triangle.type)}\uff0c\u53ef\u4ee5\u89c0\u5bdf\u6536\u6582\u672b\u7aef\u662f\u5426\u51fa\u73fe\u653e\u91cf\u7a81\u7834\u3002`;
}

function buildHarmonicSummary(patterns) {
  if (!patterns?.harmonic) {
    return COPY.noHarmonic;
  }

  const directionLabel = formatHarmonicDirection(patterns.harmonic.direction);
  const targetText = patterns.harmonic.targetPrice ? `\u7b2c\u4e00\u76ee\u6a19 ${formatPrice(patterns.harmonic.targetPrice)}` : '\u5148\u89c0\u5bdf PRZ \u5340\u57df\u53cd\u61c9';
  const confirmationText = patterns.harmonic.reactionConfirmed
    ? '\u76ee\u524d\u5df2\u7d93\u958b\u59cb\u51fa\u73fe\u53cd\u61c9\u3002'
    : '\u76ee\u524d\u9084\u5728\u5b8c\u6210\u5340\u9644\u8fd1\uff0c\u53ef\u4ee5\u7b49\u5f85\u53cd\u8f49\u78ba\u8a8d\u3002';

  return `${patterns.harmonic.label} ${directionLabel}\uff0cPRZ \u5728 ${formatPrice(patterns.harmonic.przPrice)}\uff0c${COPY.confidence} ${Math.round(
    patterns.harmonic.confidence * 100,
  )}%\uff0c${targetText}\u3002${confirmationText}`;
}

function buildHarmonicRatioRows(pattern) {
  if (!pattern) {
    return [];
  }

  return [
    ['XAB', pattern.ratios?.xab, pattern.ratioTargets?.xab],
    ['ABC', pattern.ratios?.abc, pattern.ratioTargets?.abc],
    ['BCD', pattern.ratios?.bcd, pattern.ratioTargets?.bcd],
    ['XAD', pattern.ratios?.xad, pattern.ratioTargets?.xad],
  ];
}

function buildReversalSummary(patterns) {
  if (patterns?.wBottom) {
    return `W \u5e95\u9818\u7dda\u5728 ${formatPrice(patterns.wBottom.necklinePrice)}\uff0c${
      patterns.wBottom.isBreakout
        ? '\u76ee\u524d\u5df2\u7d93\u7a81\u7834\uff0c\u53ef\u4ee5\u89c0\u5bdf\u76ee\u6a19\u50f9\u662f\u5426\u6709\u8ddf\u4e0a\u3002'
        : '\u76ee\u524d\u9084\u5728\u9818\u7dda\u4e0b\u65b9\uff0c\u53ef\u4ee5\u7b49\u5f85\u78ba\u8a8d\u6536\u76e4\u7ad9\u4e0a\u3002'
    }`;
  }

  if (patterns?.mTop) {
    return `M \u9802\u9818\u7dda\u5728 ${formatPrice(patterns.mTop.necklinePrice)}\uff0c${
      patterns.mTop.isBreakdown
        ? '\u76ee\u524d\u5df2\u7d93\u8dcc\u7834\uff0c\u53ef\u4ee5\u89c0\u5bdf\u5f31\u52e2\u662f\u5426\u5ef6\u7e8c\u3002'
        : '\u76ee\u524d\u9084\u5728\u9818\u7dda\u4e0a\u65b9\uff0c\u5148\u7b49\u5f85\u8dcc\u7834\u78ba\u8a8d\u3002'
    }`;
  }

  return COPY.noReversal;
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
    harmonic: true,
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
      harmonic: toggles.harmonic ? patterns.harmonic : null,
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
              <span aria-hidden="true">{'\u2190'}</span>
              {COPY.back}
            </Link>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h2 className="font-mono text-3xl font-semibold text-white">{symbol}</h2>
              <ScoreBadge score={scoreSource?.trendScore || 0} />
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
                {`${scoreSource?.timeframe?.toUpperCase() || '1H'} ${COPY.scoringMode}`}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-sm text-slate-300">
              <span>{`${COPY.currentPrice} ${formatPrice(livePrice)}`}</span>
              <span>{`R\u00b2 ${scoreSource?.rSquared?.toFixed?.(2) || '--'}`}</span>
              <span>{`${COPY.change} ${formatPercent(scoreSource?.priceChangePct)}`}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={buildBinanceChartUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-sm font-medium text-emerald-50 transition hover:border-emerald-300/50"
            >
              {COPY.openBinance}
            </a>
            <a
              href={buildTradingViewUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20"
            >
              {COPY.openTradingView}
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
          {loading && <p className="mt-4 text-sm text-slate-300">{COPY.loading}</p>}
        </div>

        <div className="space-y-6">
          <section className="panel rounded-[28px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.detectedPatterns}</p>
            <div className="mt-4">
              <PatternTags patterns={patterns} emptyLabel={COPY.patternEmpty} />
            </div>
          </section>

          <section className="panel rounded-[28px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.toggles}</p>
            <div className="mt-4 space-y-2">
              {TOGGLE_OPTIONS.map(([key, label]) => (
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

          {patterns?.harmonic && (
            <section className="panel rounded-[28px] px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.harmonicRatios}</p>
                <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 font-mono text-xs text-sky-100">
                  {`${COPY.confidence} ${Math.round(patterns.harmonic.confidence * 100)}%`}
                </span>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">{`${patterns.harmonic.label} ${formatHarmonicDirection(patterns.harmonic.direction)}`}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {`PRZ ${formatPrice(patterns.harmonic.przPrice)}${
                    patterns.harmonic.targetPrice ? ` \u00b7 T1 ${formatPrice(patterns.harmonic.targetPrice)}` : ''
                  } \u00b7 ${patterns.harmonic.reactionConfirmed ? '\u5df2\u958b\u59cb\u53cd\u61c9' : '\u7b49\u5f85\u53cd\u61c9'}`}
                </p>
              </div>

              <div className="mt-3 space-y-2">
                {buildHarmonicRatioRows(patterns.harmonic).map(([label, actual, target]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                  >
                    <span className="font-mono text-white">{label}</span>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{COPY.actualRatio}</p>
                      <p className="mt-1 font-mono text-slate-100">{formatRatio(actual)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{COPY.targetRange}</p>
                      <p className="mt-1 font-mono text-slate-100">{formatRatioTarget(target)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel rounded-[28px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.insights}</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">{COPY.supportResistance}</p>
                <p className="mt-1">{buildLevelSummary(patterns)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">{COPY.triangle}</p>
                <p className="mt-1">{buildTriangleSummary(patterns)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">{COPY.harmonic}</p>
                <p className="mt-1">{buildHarmonicSummary(patterns)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="font-medium text-white">{COPY.reversals}</p>
                <p className="mt-1">{buildReversalSummary(patterns)}</p>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
