/* 轻量 SVG 图表：月度多序列折线（单轴）+ 递延余额柱图。无第三方依赖。 */
(function (global) {
  'use strict';
  const U = global.RevUtil;

  const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
  const COLORS = () => [css('--series-1'), css('--series-2'), css('--series-3')];
  const compact = (v) => {
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(1) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return String(Math.round(v));
  };

  let tooltipEl = null;
  function tooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'viz-tooltip';
      tooltipEl.hidden = true;
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }
  function showTip(html, x, y) {
    const t = tooltip();
    t.innerHTML = html;
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(x + 14, window.innerWidth - w - 10) + 'px';
    t.style.top = Math.max(10, y - h - 12) + 'px';
  }
  function hideTip() { tooltip().hidden = true; }
  function tipRow(color, label, value) {
    return `<div class="tt-row"><span><span class="dot" style="background:${color}"></span>${label}</span><b>${U.fmtMoney(value)}</b></div>`;
  }

  function baseSvg(width, height) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    return svg;
  }
  const el = (svg, tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    svg.appendChild(n);
    return n;
  };

  /**
   * 多序列折线图（单一 y 轴）
   * @param series [{name, color, points:[{label, value}]}]
   */
  function lineChart(container, series) {
    container.innerHTML = '';
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    legend.innerHTML = series.map((s) =>
      `<span class="key"><span class="line-key" style="background:${s.color}"></span>${s.name}</span>`).join('');
    container.appendChild(legend);

    const labels = series[0].points.map((p) => p.label);
    const n = labels.length;
    const W = Math.max(640, n * 56), H = 300;
    const M = { top: 18, right: 18, bottom: 46, left: 64 };
    const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
    const svg = baseSvg(W, H);
    container.appendChild(svg);

    const allVals = series.flatMap((s) => s.points.map((p) => p.value));
    const maxV = Math.max(1, ...allVals), minV = Math.min(0, ...allVals);
    const ticks = niceTicks(minV, maxV, 5);
    const yMax = ticks[ticks.length - 1], yMin = ticks[0];
    const x = (i) => M.left + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => M.top + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

    // 网格与 y 轴刻度
    for (const tv of ticks) {
      el(svg, 'line', { x1: M.left, x2: W - M.right, y1: y(tv), y2: y(tv), stroke: css('--grid'), 'stroke-width': 1 });
      const t = el(svg, 'text', { x: M.left - 8, y: y(tv) + 4, 'text-anchor': 'end', fill: css('--muted'), 'font-size': 11 });
      t.textContent = compact(tv);
    }
    el(svg, 'line', { x1: M.left, x2: W - M.right, y1: y(0), y2: y(0), stroke: css('--baseline'), 'stroke-width': 1 });

    // x 轴标签（稀疏显示，避免重叠）
    const step = Math.max(1, Math.ceil(n / Math.floor(iw / 64)));
    labels.forEach((lb, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const t = el(svg, 'text', {
        x: x(i), y: H - M.bottom + 18, 'text-anchor': 'middle',
        fill: css('--muted'), 'font-size': 11,
        transform: `rotate(-35 ${x(i)} ${H - M.bottom + 18})`,
      });
      t.textContent = lb;
    });

    // 折线 2px + 端点 8px 圆点（surface 2px ring）
    series.forEach((s) => {
      const pts = s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
      el(svg, 'polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      s.points.forEach((p, i) => {
        el(svg, 'circle', { cx: x(i), cy: y(p.value), r: 4, fill: s.color, stroke: css('--surface'), 'stroke-width': 2 });
      });
    });

    // 十字悬停层（命中带比点更宽）
    const cross = el(svg, 'line', { x1: 0, x2: 0, y1: M.top, y2: M.top + ih, stroke: css('--baseline'), 'stroke-width': 1, visibility: 'hidden' });
    const hit = el(svg, 'rect', { x: M.left, y: M.top, width: iw, height: ih, fill: 'transparent' });
    hit.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const mx = (ev.clientX - rect.left) * (W / rect.width);
      const i = Math.max(0, Math.min(n - 1, Math.round(((mx - M.left) / iw) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      const html = `<div class="tt-title">${labels[i]}</div>` +
        series.map((s) => tipRow(s.color, s.name, s.points[i].value)).join('');
      showTip(html, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  /** 柱图：单列递延余额（允许负值，从 0 基线生长，数据端 4px 圆角） */
  function barChart(container, points) {
    container.innerHTML = '';
    const n = points.length;
    const W = Math.max(640, n * 46), H = 260;
    const M = { top: 18, right: 18, bottom: 46, left: 64 };
    const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
    const svg = baseSvg(W, H);
    container.appendChild(svg);
    const vals = points.map((p) => p.value);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals, 1), 5);
    const yMax = ticks[ticks.length - 1], yMin = ticks[0];
    const y = (v) => M.top + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const band = iw / n, barW = Math.min(24, band * 0.62);

    for (const tv of ticks) {
      el(svg, 'line', { x1: M.left, x2: W - M.right, y1: y(tv), y2: y(tv), stroke: css('--grid'), 'stroke-width': 1 });
      const t = el(svg, 'text', { x: M.left - 8, y: y(tv) + 4, 'text-anchor': 'end', fill: css('--muted'), 'font-size': 11 });
      t.textContent = compact(tv);
    }
    const baseY = y(0);
    el(svg, 'line', { x1: M.left, x2: W - M.right, y1: baseY, y2: baseY, stroke: css('--baseline'), 'stroke-width': 1 });

    const color = COLORS()[0];
    points.forEach((p, i) => {
      const cx = M.left + band * i + band / 2;
      const top = y(Math.max(p.value, 0)), bot = y(Math.min(p.value, 0));
      const h = Math.max(2, bot - top);
      const r = Math.min(4, h / 2);
      const path = roundedRect(cx - barW / 2, top, barW, h, r, p.value >= 0);
      el(svg, 'path', { d: path, fill: color, opacity: 0.88 });
      if (i % Math.max(1, Math.ceil(n / Math.floor(iw / 64))) === 0 || i === n - 1) {
        const t = el(svg, 'text', {
          x: cx, y: H - M.bottom + 18, 'text-anchor': 'middle', fill: css('--muted'), 'font-size': 11,
          transform: `rotate(-35 ${cx} ${H - M.bottom + 18})`,
        });
        t.textContent = p.label;
      }
      const hit = el(svg, 'rect', { x: cx - band / 2, y: M.top, width: band, height: ih, fill: 'transparent' });
      hit.addEventListener('mousemove', (ev) =>
        showTip(`<div class="tt-title">${p.label}</div>${tipRow(color, '月末递延余额', p.value)}`, ev.clientX, ev.clientY));
      hit.addEventListener('mouseleave', hideTip);
    });
  }

  function roundedRect(x, y, w, h, r, growsDown) {
    // growsDown=true：底边贴基线（方角），顶边圆角；false 反过来
    if (growsDown) {
      return `M${x},${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} H${x} Z`;
    }
    return `M${x},${y} H${x + w} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} Z`;
  }

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const out = [];
    for (let v = lo; v <= max + step * 0.001; v += step) out.push(U.round2(v));
    return out;
  }

  global.RevChart = { lineChart, barChart, colors: COLORS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
