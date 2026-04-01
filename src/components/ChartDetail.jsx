import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CandlestickSeries, HistogramSeries, createChart } from 'lightweight-charts';
import PatternRenderer from './PatternRenderer';
import PatternTags from './PatternTags';
import ScoreBadge from './ScoreBadge';
import TradeAdvicePanel from './TradeAdvicePanel';
import SignalRankPanel from './SignalRankPanel';
import { buildBinanceChartUrl, buildTradingViewUrl, getSignalScores, getSymbolCandles, getSymbolOverview } from '../services/binanceApi';
import wsManager from '../services/wsManager';
import { detectAllPatterns } from '../services/patternDetection';
import { evaluateTrend, normalizeTradeBias } from '../services/indicators';
import { calculateTrendScore } from '../utils/scoring';
import { generateTradeAdvice } from '../lib/tradeAdvisor';
import { calculateSignalScore } from '../services/signalScore';

const COPY = {
  back: '\u56de\u5230\u5100\u8868\u677f',
  scoringMode: '\u8a55\u5206\u6a21\u5f0f',
  currentPrice: '\u73fe\u50f9',
  change: '\u6f32\u5e45',
  openBinance: '\u5728 Binance \u958b\u555f',
  openTradingView: '\u5728 TradingView \u958b\u555f',
  loading: '\u6b63\u5728\u8f09\u5165 K \u7dda\u8cc7\u6599...',
  detectedPatterns: '\u5075\u6e2c\u5230\u7684\u5f62\u614b',
  patternEmpty: '\u7d14\u8da8\u52e2',
  toggles: '\u986f\u793a\u958b\u95dc',
  harmonicRatios: '\u8ae7\u6ce2\u6bd4\u7387',
  harmonicList: '\u8ae7\u6ce2\u7d50\u69cb\u6e05\u55ae',
  confidence: '\u53ef\u4fe1\u5ea6',
  actualRatio: '\u5be6\u969b\u6bd4\u7387',
  targetRange: '\u7406\u60f3\u7bc4\u570d',
  przZone: 'PRZ \u5340\u9593',
  stopLoss: '\u505c\u640d',
  target1: 'T1',
  target2: 'T2',
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

function getChartHeight(width) {
  if (width < 640) {
    return 360;
  }

  if (width < 1024) {
    return 440;
  }

  return 520;
}

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

function formatPriceRange(range) {
  if (!range?.length) {
    return '--';
  }

  return `${formatPrice(range[0])} - ${formatPrice(range[1])}`;
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

function formatHarmonicBias(direction) {
  return direction === 'bullish' ? '\u770b\u6f32' : '\u770b\u8dcc';
}

function formatHarmonicStatusLabel(statusKey) {
  return (
    {
      forming: '\u5f62\u6210\u4e2d',
      confirmed: '\u5df2\u78ba\u8a8d',
      tp1_hit: '\u6b62\u76c81',
      tp2_hit: '\u6b62\u76c8',
      sl_hit: '\u6b62\u640d',
    }[statusKey] || '\u89c0\u5bdf\u4e2d'
  );
}

function harmonicStatusTone(statusKey) {
  return (
    {
      forming: 'border-slate-400/20 bg-slate-400/10 text-slate-100',
      confirmed: 'border-sky-400/25 bg-sky-400/10 text-sky-100',
      tp1_hit: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
      tp2_hit: 'border-emerald-400/30 bg-emerald-400/12 text-emerald-50',
      sl_hit: 'border-rose-400/25 bg-rose-400/10 text-rose-100',
    }[statusKey] || 'border-slate-400/20 bg-slate-400/10 text-slate-100'
  );
}

function fallbackOverview(candles, bias = 'long') {
  const recent = candles.slice(-24);
  const metrics = evaluateTrend(recent);

  return {
    trendScore: calculateTrendScore(metrics, undefined, bias),
    rSquared: metrics.rSquared,
    priceChangePct: metrics.priceChange,
    entryPrice: recent.at(-1)?.close ?? null,
    timeframe: '1h',
    setupSide: bias,
  };
}

function pickOverviewForBias(overviewResponse, initialCoin, candles, bias = 'long') {
  const preferredTimeframe = initialCoin?.timeframe || '1h';
  const results = overviewResponse?.results || [];
  const matchingTimeframe = results.find(
    (item) => (item.setup_side ?? item.setupSide ?? 'long') === bias && item.timeframe === preferredTimeframe,
  );
  const matchingBias = results.find((item) => (item.setup_side ?? item.setupSide ?? 'long') === bias);

  return matchingTimeframe || matchingBias || overviewResponse?.best || initialCoin || fallbackOverview(candles, bias);
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
  const pattern = patterns?.harmonics?.[0] || patterns?.harmonic;

  if (!pattern) {
    return COPY.noHarmonic;
  }

  const directionLabel = formatHarmonicDirection(pattern.direction);
  const targetText = pattern.target1
    ? `${COPY.target1} ${formatPrice(pattern.target1)} / ${COPY.target2} ${formatPrice(pattern.target2)}`
    : '\u5148\u89c0\u5bdf PRZ \u5340\u57df\u53cd\u61c9';
  const confirmationText =
    pattern.status?.key === 'sl_hit'
      ? '\u9019\u7d44\u7d50\u69cb\u5df2\u7d93\u7834\u58de\uff0c\u4e0d\u5efa\u8b70\u518d\u7576\u6210\u65b0\u9032\u5834\u4f9d\u64da\u3002'
      : pattern.reactionConfirmed
        ? '\u76ee\u524d\u5df2\u7d93\u958b\u59cb\u51fa\u73fe\u53cd\u61c9\u3002'
        : '\u76ee\u524d\u9084\u5728\u5b8c\u6210\u5340\u9644\u8fd1\uff0c\u53ef\u4ee5\u7b49\u5f85\u53cd\u8f49\u78ba\u8a8d\u3002';

  return `${pattern.label} ${directionLabel}\uff0c${COPY.przZone} ${formatPriceRange(pattern.przRange)}\uff0c${COPY.stopLoss} ${formatPrice(
    pattern.stopLoss,
  )}\uff0c${COPY.confidence} ${Math.round(
    pattern.confidence * 100,
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

function getDisplayHarmonics(patterns) {
  if (!patterns) {
    return [];
  }

  if (patterns.harmonics?.length) {
    return patterns.harmonics;
  }

  return patterns.harmonic ? [patterns.harmonic] : [];
}

function getAdvisorHarmonic(patterns) {
  const harmonics = getDisplayHarmonics(patterns);
  return harmonics.find((pattern) => ['forming', 'confirmed'].includes(pattern.status?.key)) || null;
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

function buildTradeLevels(patterns) {
  const supportLevels = (patterns?.supportResistance || [])
    .filter((level) => level.type === 'support')
    .map((level) => ({ price: level.price, touches: level.touches }))
    .sort((left, right) => left.price - right.price);
  const resistanceLevels = (patterns?.supportResistance || [])
    .filter((level) => level.type === 'resistance')
    .map((level) => ({ price: level.price, touches: level.touches }))
    .sort((left, right) => left.price - right.price);

  return { supportLevels, resistanceLevels };
}

function buildAdvisorPatterns(patterns) {
  const harmonicPattern = getAdvisorHarmonic(patterns);

  if (!patterns) {
    return {
      harmonic: null,
      wBottom: null,
      mTop: null,
      triangle: null,
    };
  }

  return {
    harmonic: harmonicPattern
      ? {
          type: harmonicPattern.key,
          direction: harmonicPattern.direction,
          prz: harmonicPattern.przRange,
          stopLoss: harmonicPattern.stopLoss,
          t1: harmonicPattern.target1,
          t2: harmonicPattern.target2,
          confidence: harmonicPattern.confidence,
          reactionConfirmed: harmonicPattern.reactionConfirmed,
        }
      : null,
    wBottom: patterns.wBottom ? { neckline: patterns.wBottom.necklinePrice } : null,
    mTop: patterns.mTop ? { neckline: patterns.mTop.necklinePrice } : null,
    triangle: patterns.triangle ? { type: patterns.triangle.type } : null,
  };
}

export default function ChartDetail() {
  const { symbol } = useParams();
  const location = useLocation();
  const initialCoin = location.state?.coin || null;
  const setupSide = normalizeTradeBias(initialCoin?.setupSide || 'long');
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const rendererRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const chartReadyRef = useRef(false);
  const shouldRecalculatePatternsRef = useRef(true);
  const [chartTimeframe, setChartTimeframe] = useState('1h');
  const [allSignalScores, setAllSignalScores] = useState([]);
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
      height: getChartHeight(containerRef.current.clientWidth),
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
        height: getChartHeight(entry.contentRect.width),
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
    getSignalScores(chartTimeframe)
      .then((data) => setAllSignalScores(data.scores || []))
      .catch(() => {});
  }, [chartTimeframe]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const candleLimit = chartTimeframe === '4h' ? 168 : 240;
        const [candleResponse, overviewResponse] = await Promise.all([getSymbolCandles(symbol, { interval: chartTimeframe, limit: candleLimit }), getSymbolOverview(symbol)]);

        if (cancelled) {
          return;
        }

        const nextCandles = candleResponse.candles || [];

        setCandles(nextCandles);
        setOverview(pickOverviewForBias(overviewResponse, initialCoin, nextCandles, setupSide));
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
  }, [chartTimeframe, initialCoin, setupSide, symbol]);

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

    requestAnimationFrame(() => {
      rendererRef.current?.render();
    });
  }, [candles]);

  const currentMetrics = useMemo(() => {
    if (!candles.length) {
      return null;
    }

    return evaluateTrend(candles.slice(-24));
  }, [candles]);

  const visiblePatterns = useMemo(() => {
    if (!patterns) {
      return null;
    }

    const signalScore = calculateSignalScore(symbol, chartTimeframe, patterns, candles);

    return {
      supportResistance: toggles.supportResistance ? patterns.supportResistance : [],
      triangle: toggles.triangle ? patterns.triangle : null,
      harmonic: toggles.harmonic ? patterns.harmonic : null,
      harmonics: toggles.harmonic ? getDisplayHarmonics(patterns) : [],
      wBottom: toggles.reversals ? patterns.wBottom : null,
      mTop: toggles.reversals ? patterns.mTop : null,
      swingPoints: toggles.swingPoints ? patterns.swingPoints : null,
      signalScore,
    };
  }, [candles, chartTimeframe, patterns, symbol, toggles]);

  useEffect(() => {
    rendererRef.current?.setPatterns(visiblePatterns);
  }, [visiblePatterns]);

  useEffect(() => {
    const unsubscribe = wsManager.onKlineUpdate((nextSymbol, interval, kline) => {
      if (nextSymbol !== symbol || interval !== chartTimeframe) {
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
        const maxCandles = chartTimeframe === '4h' ? 168 : 240;
        return next.slice(-maxCandles);
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

  const scoreSource = overview || fallbackOverview(candles, setupSide);
  const tradeAdvice = useMemo(() => {
    if (!patterns) {
      return null;
    }

    const levels = buildTradeLevels(patterns);
    const effectiveMetrics = currentMetrics || {};

    return generateTradeAdvice({
      currentPrice: livePrice ?? candles.at(-1)?.close ?? scoreSource?.entryPrice,
      positionScore:
        setupSide === 'short'
          ? 1 - (effectiveMetrics.positionScore ?? scoreSource?.positionScore ?? 0.5)
          : effectiveMetrics.positionScore ?? scoreSource?.positionScore,
      score: scoreSource?.trendScore ?? (currentMetrics ? calculateTrendScore(currentMetrics, undefined, setupSide) : null),
      priceChangePercent:
        setupSide === 'short'
          ? -1 * (effectiveMetrics.priceChange ?? scoreSource?.priceChangePct ?? 0)
          : effectiveMetrics.priceChange ?? scoreSource?.priceChangePct,
      patterns: buildAdvisorPatterns(patterns),
      supportLevels: levels.supportLevels,
      resistanceLevels: levels.resistanceLevels,
      pullbackRatio: setupSide === 'short' ? effectiveMetrics.bounceRatio : effectiveMetrics.pullbackRatio,
      rSquared: effectiveMetrics.rSquared ?? scoreSource?.rSquared,
      volumeRatio: setupSide === 'short' ? effectiveMetrics.bearishVolumeRatio : effectiveMetrics.volumeRatio,
      modelBias: setupSide,
    });
  }, [candles, currentMetrics, livePrice, patterns, scoreSource, setupSide]);

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
                {`${scoreSource?.timeframe?.toUpperCase() || '1H'} ${setupSide === 'short' ? '做空' : '做多'}${COPY.scoringMode}`}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-sm text-slate-300">
              <span>{`${COPY.currentPrice} ${formatPrice(livePrice)}`}</span>
              <span>{`R\u00b2 ${scoreSource?.rSquared?.toFixed?.(2) || '--'}`}</span>
              <span>{`${COPY.change} ${formatPercent(scoreSource?.priceChangePct)}`}</span>
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-3 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <div className="flex overflow-hidden rounded-full border border-white/15">
              {['1h', '4h'].map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setChartTimeframe(tf)}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    chartTimeframe === tf
                      ? 'bg-emerald-400/20 text-emerald-200'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
            <a
              href={buildBinanceChartUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-center text-sm font-medium text-emerald-50 transition hover:border-emerald-300/50"
            >
              {COPY.openBinance}
            </a>
            <a
              href={buildTradingViewUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-center text-sm font-medium text-slate-100 transition hover:border-white/20"
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
          <div
            ref={containerRef}
            className="h-[360px] w-full overflow-hidden rounded-[24px] border border-white/10 bg-[#09101d] sm:h-[440px] lg:h-[520px]"
          />
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
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
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

          {getDisplayHarmonics(patterns).length > 0 && (
            <section className="panel rounded-[28px] px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{COPY.harmonicList}</p>
                <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 font-mono text-xs text-sky-100">
                  {`${getDisplayHarmonics(patterns).length} \u7d44\u8ae7\u6ce2`}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {getDisplayHarmonics(patterns).map((harmonicPattern) => (
                  <div key={`${harmonicPattern.key}-${harmonicPattern.direction}-${harmonicPattern.d?.index || harmonicPattern.przPrice}`} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-xs text-slate-100">
                            {`${formatHarmonicBias(harmonicPattern.direction)} ${harmonicPattern.label}`}
                          </span>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs ${harmonicStatusTone(harmonicPattern.status?.key)}`}
                          >
                            {formatHarmonicStatusLabel(harmonicPattern.status?.key)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-300">
                          {`${COPY.przZone} ${formatPriceRange(harmonicPattern.przRange)} \u00b7 ${COPY.stopLoss} ${formatPrice(
                            harmonicPattern.stopLoss,
                          )} \u00b7 ${COPY.confidence} ${Math.round(harmonicPattern.confidence * 100)}%`}
                        </p>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{COPY.target1}</p>
                          <p className="mt-1 font-mono text-white">{formatPrice(harmonicPattern.target1)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{COPY.target2}</p>
                          <p className="mt-1 font-mono text-white">{formatPrice(harmonicPattern.target2)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {buildHarmonicRatioRows(harmonicPattern).map(([label, actual, target]) => (
                        <div
                          key={`${harmonicPattern.key}-${harmonicPattern.direction}-${label}`}
                          className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm sm:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
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

          <TradeAdvicePanel advice={tradeAdvice} currentPrice={livePrice ?? candles.at(-1)?.close ?? null} />

          <SignalRankPanel
            signals={allSignalScores}
            onOpenChart={(sym) => {
              window.location.href = `/chart/${sym}`;
            }}
          />
        </div>
      </section>
    </div>
  );
}
