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

  render() {
    if (!this.ctx || !this.canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.width / ratio;
    const height = this.canvas.height / ratio;
    const ctx = this.ctx;
    const { supportResistance, triangle, wBottom, mTop, swingPoints } = this.patterns;

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
      ctx.strokeStyle = `${color}cc`;
      ctx.lineWidth = Math.min(level.touches, 3);
      ctx.setLineDash([7, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawText(`${level.type === 'resistance' ? 'R' : 'S'} ${level.price.toPrecision(6)} x${level.touches}`, 12, y - 6, color);
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

      const label =
        {
          ascending: '▲ 上升三角',
          descending: '▽ 下降三角',
          symmetric: '◇ 對稱三角',
        }[triangle.type] || '三角收斂';
      const anchor = this.tp(triangle.upperPoints[0].time, triangle.upperPoints[0].price);

      if (anchor.x != null && anchor.y != null) {
        this.drawText(label, anchor.x, anchor.y - 14, '#fde047');
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

      const necklineY = this.series.priceToCoordinate(wBottom.necklinePrice);
      if (necklineY != null) {
        ctx.strokeStyle = '#34d39988';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(0, necklineY);
        ctx.lineTo(width, necklineY);
        ctx.stroke();
        ctx.setLineDash([]);
        this.drawText(`W ${wBottom.necklinePrice.toPrecision(6)}`, 12, necklineY - 6, '#6ee7b7');
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

      const necklineY = this.series.priceToCoordinate(mTop.necklinePrice);
      if (necklineY != null) {
        ctx.strokeStyle = '#fb718588';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(0, necklineY);
        ctx.lineTo(width, necklineY);
        ctx.stroke();
        ctx.setLineDash([]);
        this.drawText(`M ${mTop.necklinePrice.toPrecision(6)}`, 12, necklineY + 14, '#fda4af');
      }
    }
  }
}

export default PatternRenderer;
