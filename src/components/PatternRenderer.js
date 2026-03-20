const TRIANGLE_LABELS = {
  ascending: '\u25b2 \u4e0a\u5347\u4e09\u89d2',
  descending: '\u25bd \u4e0b\u964d\u4e09\u89d2',
  symmetric: '\u25c7 \u5c0d\u7a31\u4e09\u89d2',
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

  drawText(text, x, y, color) {
    if (!this.ctx) {
      return;
    }

    this.ctx.fillStyle = color;
    this.ctx.font = '11px JetBrains Mono, monospace';
    this.ctx.fillText(text, x, y);
  }

  drawGuideLine(price, color, text, yOffset = -6, dash = [8, 4]) {
    const y = this.series.priceToCoordinate(price);

    if (y == null || !this.ctx || !this.canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.width / ratio;

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash(dash);
    this.ctx.beginPath();
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(width, y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.drawText(text, 12, y + yOffset, color.replace('88', '').replace('cc', ''));
  }

  drawRangeBand(lowPrice, highPrice, fillColor, strokeColor, text, startX = 0) {
    if (!this.ctx || !this.canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.width / ratio;
    const lowY = this.series.priceToCoordinate(lowPrice);
    const highY = this.series.priceToCoordinate(highPrice);

    if (lowY == null || highY == null) {
      return;
    }

    const y = Math.min(lowY, highY);
    const height = Math.max(Math.abs(lowY - highY), 3);

    this.ctx.fillStyle = fillColor;
    this.ctx.fillRect(startX, y, width - startX, height);
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(startX, y, width - startX, height);
    this.drawText(text, startX + 10, y + 14, strokeColor.replace('88', '').replace('cc', ''));
  }

  render() {
    if (!this.ctx || !this.canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.width / ratio;
    const height = this.canvas.height / ratio;
    const ctx = this.ctx;
    const { supportResistance, triangle, harmonic, wBottom, mTop, swingPoints } = this.patterns;

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
      const y = this.series.priceToCoordinate(level.price);

      if (y == null) {
        return;
      }

      const color = level.type === 'resistance' ? '#fb7185' : '#34d399';
      const label = `${level.type === 'resistance' ? '\u58d3\u529b' : '\u652f\u6490'} ${level.price.toPrecision(6)} \u00d7${level.touches}`;
      ctx.strokeStyle = `${color}cc`;
      ctx.lineWidth = Math.min(level.touches, 3);
      ctx.setLineDash([7, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawText(label, 12, y - 6, color);
    });

    if (triangle) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;

      [triangle.upperPoints, triangle.lowerPoints].forEach((points) => {
        ctx.beginPath();
        points.forEach((point, index) => {
          const position = this.tp(point.time, point.price);

          if (position.x == null || position.y == null) {
            return;
          }

          if (index === 0) {
            ctx.moveTo(position.x, position.y);
          } else {
            ctx.lineTo(position.x, position.y);
          }
        });
        ctx.stroke();
      });

      const label = TRIANGLE_LABELS[triangle.type] || '\u4e09\u89d2\u6536\u6582';
      const anchor = this.tp(triangle.upperPoints[0].time, triangle.upperPoints[0].price);

      if (anchor.x != null && anchor.y != null) {
        this.drawText(label, anchor.x, anchor.y - 14, '#fde047');
      }
    }

    if (harmonic) {
      const color = harmonic.direction === 'bullish' ? '#38bdf8' : '#fb923c';
      const guideColor = harmonic.direction === 'bullish' ? '#38bdf888' : '#fb923c88';
      const targetColor = harmonic.direction === 'bullish' ? '#7dd3fc88' : '#fdba7488';
      const stopColor = harmonic.direction === 'bullish' ? '#f8717188' : '#f472b688';
      const directionLabel = harmonic.direction === 'bullish' ? '\u725b\u8ae7\u6ce2' : '\u718a\u8ae7\u6ce2';
      const points = [
        ['X', harmonic.x],
        ['A', harmonic.a],
        ['B', harmonic.b],
        ['C', harmonic.c],
        ['D', harmonic.d],
      ];

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      points.forEach(([, point], index) => {
        const position = this.tp(point.time, point.price);

        if (position.x == null || position.y == null) {
          return;
        }

        if (index === 0) {
          ctx.moveTo(position.x, position.y);
        } else {
          ctx.lineTo(position.x, position.y);
        }
      });

      ctx.stroke();

      points.forEach(([label, point], index) => {
        const position = this.tp(point.time, point.price);

        if (position.x == null || position.y == null) {
          return;
        }

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(position.x, position.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        this.drawText(label, position.x + 6, position.y + (index % 2 === 0 ? -8 : 14), color);
      });

      const anchor = this.tp(harmonic.d.time, harmonic.d.price);
      if (anchor.x != null && anchor.y != null) {
        this.drawText(`${harmonic.label} ${directionLabel}`, anchor.x + 10, anchor.y + (harmonic.direction === 'bullish' ? 18 : -14), color);
      }

      const bandStartX = Math.max(0, (anchor.x ?? width * 0.55) - 18);
      this.drawRangeBand(
        harmonic.przRange[0],
        harmonic.przRange[1],
        harmonic.direction === 'bullish' ? '#38bdf822' : '#fb923c22',
        guideColor,
        `PRZ ${harmonic.przRange[0].toPrecision(6)} - ${harmonic.przRange[1].toPrecision(6)}`,
        bandStartX,
      );

      this.drawGuideLine(
        harmonic.stopLoss,
        stopColor,
        `\u505c\u640d ${harmonic.stopLoss.toPrecision(6)}`,
        harmonic.direction === 'bullish' ? 14 : -6,
        [6, 6],
      );

      if (harmonic.target1) {
        this.drawGuideLine(
          harmonic.target1,
          targetColor,
          `T1 ${harmonic.target1.toPrecision(6)}`,
          harmonic.direction === 'bullish' ? -6 : 14,
        );
      }

      if (harmonic.target2) {
        this.drawGuideLine(
          harmonic.target2,
          harmonic.direction === 'bullish' ? '#bae6fd88' : '#fed7aa88',
          `T2 ${harmonic.target2.toPrecision(6)}`,
          harmonic.direction === 'bullish' ? -6 : 14,
          [4, 6],
        );
      }
    }

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
