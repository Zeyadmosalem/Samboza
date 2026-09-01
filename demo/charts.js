/* Hand-rolled SVG charts — no libraries.
   Palette hexes are the validated categorical slots; income/expense green vs
   red sits in the CVD warn band, so it always ships with a legend, fixed
   left/right position and signed values as the secondary channel. */
window.Charts = (function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    income:'#1baf7a', expense:'#e34948', trend:'#2a78d6',
    surface:'#ffffff', grid:'#e5eae8', ink:'#15201c', sub:'#6b7a74'
  };

  const registry = [];          // redrawn on resize / language change

  function svgEl(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  /* Rounded data-end, square at the baseline (marks spec). */
  function barPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) +
           'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
           'h' + (w - 2 * r) +
           'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
           'V' + (y + h) + 'Z';
  }

  function niceMax(v, steps) {
    if (!(v > 0)) return 10;
    const raw = v / steps;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    return step * steps;
  }

  function tipFor(host) {
    let t = host.querySelector('.viz-tip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'viz-tip';
      t.hidden = true;
      host.appendChild(t);
    }
    return t;
  }

  function place(host, tip, x, y) {
    const w = host.clientWidth;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let left = x - tw / 2;
    if (left < 4) left = 4;
    if (left + tw > w - 4) left = w - tw - 4;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(4, y - tip.offsetHeight - 12) + 'px';
  }

  function mount(host, draw) {
    host.classList.add('viz');
    const entry = { host: host, draw: draw };
    const i = registry.findIndex(function (e) { return e.host === host; });
    if (i >= 0) registry[i] = entry; else registry.push(entry);
    render(entry);
  }

  function render(entry) {
    const host = entry.host;
    if (!host.isConnected) return;
    const tip = host.querySelector('.viz-tip');
    Array.prototype.slice.call(host.querySelectorAll('svg')).forEach(function (s) { s.remove(); });
    if (tip) tip.hidden = true;
    const w = host.clientWidth || 640;
    if (w < 40) return;
    entry.draw(host, w);
  }

  function redrawAll() {
    for (let i = registry.length - 1; i >= 0; i--) {
      if (!registry[i].host.isConnected) registry.splice(i, 1);
      else render(registry[i]);
    }
  }

  /* ---------------------------------------------------------------------
     Grouped columns — income vs expense per month.
     opts: { labels:[], income:[], expense:[], fmt(v), legend:{income,expense} }
  --------------------------------------------------------------------- */
  function columns(host, opts) {
    mount(host, function (host, W) {
      const H = 260, padT = 18, padB = 28, padL = 58, padR = 8;
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const svg = svgEl('svg', { width: W, height: H, class: 'viz-svg' }, host);
      const tip = tipFor(host);

      const peak = Math.max.apply(null, opts.income.concat(opts.expense));
      const max = niceMax(peak, 4);
      const yOf = function (v) { return padT + plotH - (v / max) * plotH; };

      for (let i = 0; i <= 4; i++) {
        const v = (max / 4) * i, y = yOf(v);
        svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: C.grid, 'stroke-width': 1 }, svg);
        const tx = svgEl('text', { x: padL - 8, y: y + 4, fill: C.sub, 'font-size': 11, 'text-anchor': 'end' }, svg);
        tx.textContent = opts.tick ? opts.tick(v) : Math.round(v);
      }

      const band = plotW / opts.labels.length;
      const bw = Math.min(24, Math.max(8, band * 0.3));
      const gap = 2;                                   // surface gap between the pair
      const hot = [];

      opts.labels.forEach(function (label, i) {
        const cx = padL + band * i + band / 2;
        const xIn = cx - bw - gap / 2, xEx = cx + gap / 2;

        [[xIn, opts.income[i], C.income], [xEx, opts.expense[i], C.expense]].forEach(function (b) {
          const h = Math.max(1, (b[1] / max) * plotH);
          svgEl('path', { d: barPath(b[0], padT + plotH - h, bw, h, 4), fill: b[2] }, svg);
        });

        const tl = svgEl('text', { x: cx, y: H - 9, fill: C.sub, 'font-size': 11, 'text-anchor': 'middle' }, svg);
        tl.textContent = label;
        hot.push({ x0: padL + band * i, x1: padL + band * (i + 1), cx: cx, i: i });
      });

      // Direct-label the extremes only — the axis and tooltip carry the rest.
      const maxIn = opts.income.indexOf(Math.max.apply(null, opts.income));
      const maxEx = opts.expense.indexOf(Math.max.apply(null, opts.expense));
      [[maxIn, opts.income, -bw - gap / 2 - bw / 2], [maxEx, opts.expense, gap / 2 + bw / 2]].forEach(function (m) {
        const i = m[0], v = m[1][i];
        const t = svgEl('text', {
          x: padL + band * i + band / 2 + m[2], y: yOf(v) - 7,
          fill: C.ink, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle'
        }, svg);
        t.textContent = opts.fmt(v);
      });

      const rect = svgEl('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' }, svg);
      rect.addEventListener('mousemove', function (e) {
        const box = svg.getBoundingClientRect();
        const x = e.clientX - box.left;
        const hit = hot.find(function (h) { return x >= h.x0 && x < h.x1; });
        if (!hit) { tip.hidden = true; return; }
        tip.innerHTML =
          '<b>' + opts.labels[hit.i] + '</b>' +
          '<i style="--k:' + C.income + '"></i>' + opts.legend.income + '<em>' + opts.fmt(opts.income[hit.i]) + '</em>' +
          '<i style="--k:' + C.expense + '"></i>' + opts.legend.expense + '<em>' + opts.fmt(opts.expense[hit.i]) + '</em>';
        place(host, tip, hit.cx, padT + 40);
      });
      rect.addEventListener('mouseleave', function () { tip.hidden = true; });
    });
  }

  /* ---------------------------------------------------------------------
     Donut — part-to-whole, six segments maximum.
     opts: { slices:[{label,value,color}], total, fmt(v), centerLabel }
  --------------------------------------------------------------------- */
  function donut(host, opts) {
    mount(host, function (host, W) {
      const size = Math.min(W, 220), H = size;
      const svg = svgEl('svg', { width: W, height: H, class: 'viz-svg' }, host);
      const tip = tipFor(host);
      const cx = W / 2, cy = H / 2, rO = size / 2 - 4, rI = rO * 0.62, rM = (rO + rI) / 2;
      const total = opts.total || opts.slices.reduce(function (s, x) { return s + x.value; }, 0);
      const gap = total > 0 ? (2 / rM) : 0;            // a 2px surface gap, in radians

      let a = -Math.PI / 2;
      opts.slices.forEach(function (s, i) {
        const span = total > 0 ? (s.value / total) * Math.PI * 2 : 0;
        const a0 = a + gap / 2, a1 = a + span - gap / 2;
        a += span;
        if (a1 <= a0) return;
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        const pt = function (r, ang) { return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]; };
        const p0 = pt(rO, a0), p1 = pt(rO, a1), p2 = pt(rI, a1), p3 = pt(rI, a0);
        const path = svgEl('path', {
          d: 'M' + p0 + 'A' + rO + ',' + rO + ' 0 ' + large + ' 1 ' + p1 +
             'L' + p2 + 'A' + rI + ',' + rI + ' 0 ' + large + ' 0 ' + p3 + 'Z',
          fill: s.color, class: 'viz-slice'
        }, svg);
        const mid = (a0 + a1) / 2, mp = pt(rM, mid);
        path.addEventListener('mousemove', function () {
          tip.innerHTML = '<b>' + s.label + '</b><i style="--k:' + s.color + '"></i>' +
                          opts.fmt(s.value) + '<em>' + Math.round(s.value / total * 100) + '%</em>';
          place(host, tip, mp[0], mp[1]);
        });
        path.addEventListener('mouseleave', function () { tip.hidden = true; });
      });

      const t1 = svgEl('text', { x: cx, y: cy - 2, fill: C.ink, 'font-size': 16, 'font-weight': 800, 'text-anchor': 'middle' }, svg);
      t1.textContent = opts.fmt(total);
      const t2 = svgEl('text', { x: cx, y: cy + 15, fill: C.sub, 'font-size': 11, 'text-anchor': 'middle' }, svg);
      t2.textContent = opts.centerLabel || '';
    });
  }

  /* ---------------------------------------------------------------------
     Line — single series, crosshair + tooltip.
     opts: { labels:[], values:[], fmt(v), tick(v), name }
  --------------------------------------------------------------------- */
  function line(host, opts) {
    mount(host, function (host, W) {
      const H = 230, padT = 18, padB = 28, padL = 58, padR = 14;
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const svg = svgEl('svg', { width: W, height: H, class: 'viz-svg' }, host);
      const tip = tipFor(host);

      const max = niceMax(Math.max.apply(null, opts.values), 4);
      const xOf = function (i) { return padL + (opts.values.length === 1 ? plotW / 2 : (plotW / (opts.values.length - 1)) * i); };
      const yOf = function (v) { return padT + plotH - (v / max) * plotH; };

      for (let i = 0; i <= 4; i++) {
        const v = (max / 4) * i, y = yOf(v);
        svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: C.grid, 'stroke-width': 1 }, svg);
        const tx = svgEl('text', { x: padL - 8, y: y + 4, fill: C.sub, 'font-size': 11, 'text-anchor': 'end' }, svg);
        tx.textContent = opts.tick ? opts.tick(v) : Math.round(v);
      }

      const pts = opts.values.map(function (v, i) { return [xOf(i), yOf(v)]; });
      svgEl('path', {
        d: 'M' + pts.map(function (p) { return p.join(','); }).join('L') +
           'L' + pts[pts.length - 1][0] + ',' + (padT + plotH) + 'L' + pts[0][0] + ',' + (padT + plotH) + 'Z',
        fill: C.trend, 'fill-opacity': 0.1
      }, svg);
      svgEl('path', {
        d: 'M' + pts.map(function (p) { return p.join(','); }).join('L'),
        fill: 'none', stroke: C.trend, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }, svg);

      opts.labels.forEach(function (l, i) {
        const t = svgEl('text', { x: xOf(i), y: H - 9, fill: C.sub, 'font-size': 11, 'text-anchor': 'middle' }, svg);
        t.textContent = l;
      });

      // End marker: >=8px, with a 2px ring in the surface colour.
      const last = pts[pts.length - 1];
      svgEl('circle', { cx: last[0], cy: last[1], r: 5, fill: C.trend, stroke: C.surface, 'stroke-width': 2 }, svg);
      const el = svgEl('text', {
        x: last[0], y: last[1] - 12, fill: C.ink, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'end'
      }, svg);
      el.textContent = opts.fmt(opts.values[opts.values.length - 1]);

      const rule = svgEl('line', { y1: padT, y2: padT + plotH, stroke: C.sub, 'stroke-width': 1, opacity: 0 }, svg);
      const dot = svgEl('circle', { r: 5, fill: C.trend, stroke: C.surface, 'stroke-width': 2, opacity: 0 }, svg);

      const rect = svgEl('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' }, svg);
      rect.addEventListener('mousemove', function (e) {
        const box = svg.getBoundingClientRect();
        const x = e.clientX - box.left;
        let i = 0, best = Infinity;
        pts.forEach(function (p, k) { const dx = Math.abs(p[0] - x); if (dx < best) { best = dx; i = k; } });
        rule.setAttribute('x1', pts[i][0]); rule.setAttribute('x2', pts[i][0]); rule.setAttribute('opacity', 0.3);
        dot.setAttribute('cx', pts[i][0]); dot.setAttribute('cy', pts[i][1]); dot.setAttribute('opacity', 1);
        tip.innerHTML = '<b>' + opts.labels[i] + '</b><i style="--k:' + C.trend + '"></i>' +
                        opts.name + '<em>' + opts.fmt(opts.values[i]) + '</em>';
        place(host, tip, pts[i][0], pts[i][1]);
      });
      rect.addEventListener('mouseleave', function () {
        tip.hidden = true; rule.setAttribute('opacity', 0); dot.setAttribute('opacity', 0);
      });
    });
  }

  let pending;
  window.addEventListener('resize', function () {
    clearTimeout(pending);
    pending = setTimeout(redrawAll, 120);
  });

  return { colors: C, columns: columns, donut: donut, line: line, redrawAll: redrawAll };
})();
