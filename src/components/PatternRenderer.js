const TRIANGLE_LABELS = {
  ascending: '\u25b2 \u4e0a\u5347\u4e09\u89d2',
  descending: '\u25bd \u4e0b\u964d\u4e09\u89d2',
  symmetric: '\u25c7 \u5c0d\u7a31\u4e09\u89d2',
  fallingWedge: '\u25bd \u4e0b\u964d\u6954\u5f62',
  risingWedge: '\u25b2 \u4e0a\u5347\u6954\u5f62',
};

const HARMONIC_PALETTES = {
  bullish: [
    {
      line: '#60a5fa',
      lineSoft: '#60a5fa88',
      fill: '#60a5fa1f',
      chipBg: '#2563ebdd',
      chipBorder: '#93c5fd',
      text: '#dbeafe',
      ratio: '#93c5fd',
      target1: '#67e8f9aa',
      target2: '#bae6fdaa',
      stop: '#f8717188',
    },
    {
      line: '#38bdf8',
      lineSoft: '#38bdf888',
      fill: '#38bdf81a',
      chipBg: '#0284c7dd',
      chipBorder: '#7dd3fc',
      text: '#e0f2fe',
      ratio: '#7dd3fc',
      target1: '#5eead4aa',
      target2: '#99f6e4aa',
      stop: '#fb718588',
    },
  ],
  bearish: [
    {
      line: '#f59e0b',
      lineSoft: '#f59e0b88',
      fill: '#f59e0b1f',
      chipBg: '#f59e0bdd',
      chipBorder: '#fde68a',
      text: '#fff7ed',
      ratio: '#fcd34d',
      target1: '#fb718588',
      target2: '#fda4af88',
      stop: '#93c5fd88',
    },
    {
      line: '#fb7185',
      lineSoft: '#fb718588',
      fill: '#fb71851c',
      chipBg: '#e11d48dd',
      chipBorder: '#fda4af',
      text: '#fff1f2',
      ratio: '#fda4af',
      target1: '#fb718588',
      target2: '#fecdd388',
      stop: '#93c5fd88',
    },
  ],
};

class PatternRenderer {
  constructor(chart, candleSeries) {
    this.chart = chart;
    this.series = candleSeries;
    this.canvas = null;
    this.ctx = null;
    this.patterns = {};
    this.handleLogicalRangeChange = this.render.bind(this);
    this.handleCrosshairMove = this.render.bind(this);
    this.resizeObserver = null;
    this.init();
  }

  init() {
    const chartElement = this.chart.chartElement();
    this.canvas = document.createElement('canvas');

    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '10',
      pointerEvents: 'none',
    });

    chartElement.style.position = 'relative';
    chartElement.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.resize();

    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.handleLogicalRangeChange);
    this.chart.subscribeCrosshairMove(this.handleCrosshairMove);
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.render();
    });
    this.resizeObserver.observe(chartElement);
  }

  destroy() {
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.handleLogicalRangeChange);
    this.chart.unsubscribeCrosshairMove(this.handleCrosshairMove);
    this.resizeObserver?.disconnect();
    this.canvas?.remove();
  }

  resize() {
    const parent = this.canvas?.parentElement;

    if (!parent || !this.ctx) {
      return;
    }

    const bounds = parent.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    this.canvas.width = bounds.width * ratio;
    this.canvas.height = bounds.height * ratio;
    this.canvas.style.width = `${bounds.width}px`;
    this.canvas.style.height = `${bounds.height}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  tp(time, price) {
    return {
      x: this.chart.timeScale().timeToCoordinate(time),
      y: this.series.priceToCoordinate(price),
    };
  }

  setPatterns(patterns) {
    this.patterns = patterns || {};
    this.render();
  }

  drawText(text, x, y, color, font = '11px JetBrains Mono, monospace') {
    if (!this.ctx || !text) {
      return;
    }

    this.ctx.fillStyle = color;
    this.ctx.font = font;
    this.ctx.fillText(text, x, y);
  }

  drawRoundedRect(x, y, width, height, radius, fillStyle, strokeStyle = null) {
    if (!this.ctx) {
      return;
    }

    const ctx = this.ctx;
    const r = Math.min(radius, height / 2, width / 2);

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();

    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }

    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  drawGuideLine(price, color, text, yOffset = -6, dash = [8, 4]) {
    const y = this.series.priceToCoordinate(price);

    if (y == null || !this.ctx || !this.canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.width / ratio;

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.2;
    this.ctx.setLineDash(dash);
    this.ctx.beginPath();
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(width, y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.drawText(text, 12, y + yOffset, color.replace('88', '').replace('aa', ''));
  }

  drawRangeBand(lowPrice, highPrice, fillColor, strokeColor, text, startX, endX) {
    if (!this.ctx || !this.canvas) {
      return;
    }

    const lowY = this.series.priceToCoordinate(lowPrice);
    const highY = this.series.priceToCoordinate(highPrice);

    if (lowY == null || highY == null) {
      return;
    }

    const x1 = Math.max(6, startX ?? 6);
    const x2 = Math.max(x1 + 12, endX ?? x1 + 120);
    const y = Math.min(lowY, highY);
    const height = Math.max(Math.abs(lowY - highY), 3);

    this.ctx.fillStyle = fillColor;
    this.ctx.fillRect(x1, y, x2 - x1, height);
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x1, y, x2 - x1, height);
    this.drawText(text, x1 + 8, y + 14, strokeColor.replace('88', '').replace('aa', ''));
  }

  drawSegmentLabel(text, first, second, color, background, offsetX = 0, offsetY = 0) {
    if (!this.ctx || first.x == null || first.y == null || second.x == null || second.y == null || !text) {
      return;
    }

    this.ctx.font = '11px JetBrains Mono, monospace';
    const x = (first.x + second.x) / 2 + offsetX;
    const y = (first.y + second.y) / 2 + offsetY;
    const textWidth = this.ctx.measureText(text).width;
    this.drawRoundedRect(x - 6, y - 13, textWidth + 12, 18, 8, background);
    this.drawText(text, x, y, color);
  }

  drawStatusBubble(text, x, y, palette, direction, index) {
    if (!this.ctx || x == null || y == null || !text || !this.canvas) {
      return;
    }

    const width = this.canvas.width / (window.devicePixelRatio || 1);
    this.ctx.font = '12px JetBrains Mono, monospace';
    const bubbleWidth = Math.min(width - 16, this.ctx.measureText(text).width + 22);
    const bubbleHeight = 26;
    const offsetY = direction === 'bullish' ? 30 + index * 18 : -44 - index * 18;
    const bubbleX = Math.max(8, Math.min(width - bubbleWidth - 8, x - bubbleWidth / 2));
    const bubbleY = Math.max(10, y + offsetY);
    const pointerX = Math.max(bubbleX + 12, Math.min(bubbleX + bubbleWidth - 12, x));
    const ctx = this.ctx;

    this.drawRoundedRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 10, palette.chipBg, palette.chipBorder);
    this.drawText(text, bubbleX + 11, bubbleY + 17, palette.text, '12px JetBrains Mono, monospace');

    ctx.beginPath();
    ctx.fillStyle = palette.chipBg;

    if (direction === 'bullish') {
      ctx.moveTo(pointerX - 7, bubbleY);
      ctx.lineTo(pointerX + 7, bubbleY);
      ctx.lineTo(pointerX, bubbleY - 9);
    } else {
      ctx.moveTo(pointerX - 7, bubbleY + bubbleHeight);
      ctx.lineTo(pointerX + 7, bubbleY + bubbleHeight);
      ctx.lineTo(pointerX, bubbleY + bubbleHeight + 9);
    }

    ctx.closePath();
    ctx.fill();
  }

  harmonicPalette(direction, index) {
    const palettes = HARMONIC_PALETTES[direction] || HARMONIC_PALETTES.bullish;
    return palettes[index % palettes.length];
  }

  harmonicStatusText(pattern) {
    const bias = pattern.direction === 'bullish' ? '\u770b\u6f32' : '\u770b\u8dcc';
    const statusMap = {
      forming: '\u5f62\u6210\u4e2d',
      confirmed: '\u5df2\u78ba\u8a8d',
      tp1_hit: '\u6b62\u76c81 \u2705',
      tp2_hit: '\u6b62\u76c8 \u2705',
      sl_hit: '\u6b62\u640d',
    };
    const status = statusMap[pattern.status?.key] || '\u89c0\u5bdf\u4e2d';
    return `[${bias}] ${pattern.label} [${status}]`;
  }

  drawHarmonicPattern(pattern, index, width) {
    if (!this.ctx) {
      return;
    }

    const points = [
      ['X', pattern.x],
      ['A', pattern.a],
      ['B', pattern.b],
      ['C', pattern.c],
      ['D', pattern.d],
    ].map(([label, point]) => ({
      label,
      point,
      position: this.tp(point.time, point.price),
    }));

    if (points.some((item) => item.position.x == null || item.position.y == null)) {
      return;
    }

    const palette = this.harmonicPalette(pattern.direction, index);
    const ctx = this.ctx;
    const [xPoint, aPoint, bPoint, cPoint, dPoint] = points;

    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    points.forEach((item, pointIndex) => {
      if (pointIndex === 0) {
        ctx.moveTo(item.position.x, item.position.y);
      } else {
        ctx.lineTo(item.position.x, item.position.y);
      }
    });
    ctx.stroke();

    ctx.strokeStyle = palette.lineSoft;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(xPoint.position.x, xPoint.position.y);
    ctx.lineTo(dPoint.position.x, dPoint.position.y);
    ctx.stroke();
    ctx.setLineDash([]);

    points.forEach((item, pointIndex) => {
      ctx.beginPath();
      ctx.fillStyle = palette.line;
      ctx.arc(item.position.x, item.position.y, pointIndex === 4 ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      this.drawText(
        item.label,
        item.position.x + 6,
        item.position.y + (pointIndex % 2 === 0 ? -8 : 14),
        palette.text,
        '12px JetBrains Mono, monospace',
      );
    });

    this.drawSegmentLabel(pattern.ratios?.xab?.toFixed(3), aPoint.position, bPoint.position, palette.ratio, '#09101ddd', 0, -8);
    this.drawSegmentLabel(pattern.ratios?.abc?.toFixed(3), bPoint.position, cPoint.position, palette.ratio, '#09101ddd', 0, -10);
    this.drawSegmentLabel(pattern.ratios?.bcd?.toFixed(3), cPoint.position, dPoint.position, palette.ratio, '#09101ddd', 0, 16);
    this.drawSegmentLabel(pattern.ratios?.xad?.toFixed(3), xPoint.position, dPoint.position, palette.ratio, '#09101ddd', 0, -18);

    const bandStartX = Math.max(8, (cPoint.position.x || dPoint.position.x) - 12);
    const bandEndX = Math.min(width - 10, (dPoint.position.x || width * 0.75) + 110);
    this.drawRangeBand(
      pattern.przRange[0],
      pattern.przRange[1],
      palette.fill,
      palette.lineSoft,
      `PRZ ${pattern.ratioTargets?.xad ? pattern.ratioTargets.xad[0].toFixed(3) : ''}`,
      bandStartX,
      bandEndX,
    );

    this.drawGuideLine(
      pattern.stopLoss,
      palette.stop,
      `SL ${pattern.stopLoss.toPrecision(6)}`,
      pattern.direction === 'bullish' ? 14 : -6,
      [6, 6],
    );
    this.drawGuideLine(
      pattern.target1,
      palette.target1,
      `T1 ${pattern.target1.toPrecision(6)}`,
      pattern.direction === 'bullish' ? -6 : 14,
      [7, 4],
    );
    this.drawGuideLine(
      pattern.target2,
      palette.target2,
      `T2 ${pattern.target2.toPrecision(6)}`,
      pattern.direction === 'bullish' ? -6 : 14,
      [4, 6],
    );

    this.drawStatusBubble(this.harmonicStatusText(pattern), dPoint.position.x, dPoint.position.y, palette, pattern.direction, index);
  }

  render() {
    if (!this.ctx || !this.canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.width / ratio;
    const height = this.canvas.height / ratio;
    const ctx = this.ctx;
    const { supportResistance, triangle, harmonics, harmonic, wBottom, mTop, swingPoints } = this.patterns;

    ctx.clearRect(0, 0, width, height);

    if (swingPoints) {
      swingPoints.swingHighs.forEach((point) => {
        const position = this.tp(point.time, point.price);

        if (position.x == null || position.y == null) {
          return;
        }

        ctx.fillStyle = '#fb718580';
        ctx.beginPath();
        ctx.moveTo(position.x, position.y - 9);
        ctx.lineTo(position.x - 5, position.y - 2);
        ctx.lineTo(position.x + 5, position.y - 2);
        ctx.closePath();
        ctx.fill();
      });

      swingPoints.swingLows.forEach((point) => {
        const position = this.tp(point.time, point.price);

        if (position.x == null || position.y == null) {
          return;
        }

        ctx.fillStyle = '#34d39980';
        ctx.beginPath();
        ctx.moveTo(position.x, position.y + 9);
        ctx.lineTo(position.x - 5, position.y + 2);
        ctx.lineTo(position.x + 5, position.y + 2);
        ctx.closePath();
        ctx.fill();
      });
    }

    supportResistance?.forEach((level) => {
      const yMid = this.series.priceToCoordinate(level.price);
      const yHigh = this.series.priceToCoordinate(level.priceHigh ?? level.price);
      const yLow = this.series.priceToCoordinate(level.priceLow ?? level.price);

      if (yMid == null) {
        return;
      }

      const color = level.type === 'resistance' ? '#fb7185' : '#34d399';
      const flipLabel = level.flipped ? ' \u21c5' : '';
      const strengthLabel = level.strength === 'strong' ? ' \u2588' : '';
      const label = `${level.type === 'resistance' ? '\u58d3\u529b' : '\u652f\u6490'} ${level.price.toPrecision(6)} \u00d7${level.touches}${strengthLabel}${flipLabel}`;

      // Draw band (zone between priceHigh and priceLow)
      if (yHigh != null && yLow != null && yHigh !== yLow) {
        const bandTop = Math.min(yHigh, yLow);
        const bandHeight = Math.max(Math.abs(yHigh - yLow), 2);
        const alpha = level.strength === 'strong' ? '40' : '1a';
        ctx.fillStyle = `${color}${alpha}`;
        ctx.fillRect(0, bandTop, width, bandHeight);

        // Flipped: draw diagonal hatching
        if (level.flipped) {
          ctx.strokeStyle = `${color}30`;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          for (let hx = -bandHeight; hx < width; hx += 12) {
            ctx.beginPath();
            ctx.moveTo(hx, bandTop + bandHeight);
            ctx.lineTo(hx + bandHeight, bandTop);
            ctx.stroke();
          }
        }
      }

      // Draw center line
      ctx.strokeStyle = `${color}cc`;
      ctx.lineWidth = level.strength === 'strong' ? 2.5 : 1.5;
      ctx.setLineDash(level.flipped ? [4, 6] : [7, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yMid);
      ctx.lineTo(width, yMid);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawText(label, 12, yMid - 6, color);
    });

    if (triangle && triangle.highLine && triangle.lowLine) {
      const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
      const leftIdx = visibleRange ? Math.floor(visibleRange.from) : 0;
      const rightIdx = visibleRange ? Math.ceil(visibleRange.to) : 0;

      const drawTrendLine = (line) => {
        const { slope, intercept, p1, p2 } = line;
        if (!p1 || !p2 || p1.index === p2.index) return null;

        const timeDelta = (p2.time - p1.time) / (p2.index - p1.index);
        const leftTime = p1.time + (leftIdx - p1.index) * timeDelta;
        const rightTime = p1.time + (rightIdx - p1.index) * timeDelta;
        const leftPrice = slope * leftIdx + intercept;
        const rightPrice = slope * rightIdx + intercept;

        const start = this.tp(leftTime, leftPrice);
        const end = this.tp(rightTime, rightPrice);

        if (start.x == null || start.y == null || end.x == null || end.y == null) return null;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        return end;
      };

      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;

      drawTrendLine(triangle.highLine);
      const lowEnd = drawTrendLine(triangle.lowLine);

      const label = TRIANGLE_LABELS[triangle.type] || '\u4e09\u89d2\u6536\u6582';

      if (lowEnd) {
        this.drawText(label, lowEnd.x + 8, lowEnd.y - 6, '#fde047');
      }
    }

    const harmonicPatterns = harmonics?.length ? harmonics : harmonic ? [harmonic] : [];
    harmonicPatterns.forEach((pattern, index) => {
      this.drawHarmonicPattern(pattern, index, width, height);
    });

    if (wBottom) {
      const first = this.tp(wBottom.leftFoot.time, wBottom.leftFoot.price);
      const middle = this.tp(wBottom.neckline.time, wBottom.neckline.price);
      const third = this.tp(wBottom.rightFoot.time, wBottom.rightFoot.price);

      if (first.x != null && middle.x != null && third.x != null) {
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(middle.x, middle.y);
        ctx.lineTo(third.x, third.y);
        ctx.stroke();

        [first, third].forEach((point) => {
          ctx.beginPath();
          ctx.fillStyle = '#34d399';
          ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      this.drawGuideLine(wBottom.necklinePrice, '#34d39988', `W \u5e95\u9818\u7dda ${wBottom.necklinePrice.toPrecision(6)}`);

      if (wBottom.isBreakout && wBottom.targetPrice) {
        this.drawGuideLine(wBottom.targetPrice, '#86efac88', `\u76ee\u6a19 ${wBottom.targetPrice.toPrecision(6)}`);
      }
    }

    if (mTop) {
      const first = this.tp(mTop.leftPeak.time, mTop.leftPeak.price);
      const middle = this.tp(mTop.neckline.time, mTop.neckline.price);
      const third = this.tp(mTop.rightPeak.time, mTop.rightPeak.price);

      if (first.x != null && middle.x != null && third.x != null) {
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(middle.x, middle.y);
        ctx.lineTo(third.x, third.y);
        ctx.stroke();

        [first, third].forEach((point) => {
          ctx.beginPath();
          ctx.fillStyle = '#fb7185';
          ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      this.drawGuideLine(mTop.necklinePrice, '#fb718588', `M \u9802\u9818\u7dda ${mTop.necklinePrice.toPrecision(6)}`, 14);

      if (mTop.isBreakdown && mTop.targetPrice) {
        this.drawGuideLine(mTop.targetPrice, '#fca5a588', `\u76ee\u6a19 ${mTop.targetPrice.toPrecision(6)}`, 14);
      }
    }
  }
}

export default PatternRenderer;
