/* 私享家 台中 29 區收送地圖 */
(function () {
  var root = document.querySelector('[data-sxj-map]'); if (!root) return;
  var NS = 'http://www.w3.org/2000/svg', STORE = [120.639961, 24.174057], HQ = '西屯區', OA = 'https://line.me/R/oaMessage/%40454foyks/?';
  var URBAN = ['西屯區', '南屯區', '北屯區', '中區', '東區', '西區', '南區', '北區'];
  var NOTE = { '西屯區': '門市所在地。可直接到店，或約到府收送；逢甲、東海生活圈也由這裡出發。', '南屯區': '大樓多，可寄放管理室代收代送；厚被與換季衣物先傳照片。', '北區': '中國醫大與科博館生活圈，工作服與厚被可約收送。', '北屯區': '北屯沒有門市，由西屯門市安排收送。', '西區': '西區不是西屯，同樣免費收送。' };
  var DEF = '由西屯門市安排免費到府收送，沒有最低消費，一件也收。';
  var all = root.querySelector('[data-map-all]'), core = root.querySelector('[data-map-core]');
  var list = [].slice.call(root.querySelectorAll('[data-d]')), btn = {}, shapes = {}, cur = null;
  list.forEach(function (b) { btn[b.getAttribute('data-d')] = b; });
  function q(s) { return root.querySelector(s); }
  var nm = q('[data-mi-name]'), no = q('[data-mi-no]'), nt = q('[data-mi-note]'), ln = q('[data-mi-line]');
  function mark(n, c, on) { (shapes[n] || []).forEach(function (e) { e.classList.toggle(c, on); }); if (btn[n]) btn[n].classList.toggle(c, on); }
  function select(n) {
    if (!btn[n]) return; if (cur) mark(cur, 'on', false); cur = n; mark(n, 'on', true);
    var i = list.indexOf(btn[n]) + 1, rg = btn[n].closest('[data-region]');
    if (nm) nm.textContent = n;
    if (no) no.textContent = 'NO. ' + (i < 10 ? '0' : '') + i + ' / ' + list.length + '・' + (rg ? rg.getAttribute('data-region') : '') + (n === HQ ? '・門市' : '・免費收送');
    if (nt) nt.textContent = NOTE[n] || DEF;
    if (ln) ln.setAttribute('href', OA + encodeURIComponent('你好，我在' + n + '，想預約收送。\n件數：＿＿\n方便時段：＿＿\n照片另傳。'));
  }
  function bind(e, n) { e.addEventListener('click', function () { select(n); }); e.addEventListener('mouseenter', function () { mark(n, 'hv', true); }); e.addEventListener('mouseleave', function () { mark(n, 'hv', false); }); }
  list.forEach(function (b) { bind(b, b.getAttribute('data-d')); });
  if (ln) ln.addEventListener('click', function () { try { if (typeof window.gtag === 'function') window.gtag('event', 'line_click', { source: 'v4-map-' + cur, link_source: 'v4-map-' + cur, transport_type: 'beacon' }); } catch (e) {} });
  select(HQ);
  function el(t, a, p) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; }
  function rings(g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function f1(v) { return v.toFixed(1); }
  function draw(svg, fs, fit, o) {
    var x0 = 999, x1 = -999, y0 = 99, y1 = -99;
    fs.forEach(function (f) { if (fit && fit.indexOf(f.properties.__name) < 0) return; rings(f.geometry).forEach(function (p) { p[0].forEach(function (c) { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; }); }); });
    var kx = Math.cos((y0 + y1) / 2 * Math.PI / 180), W = 1000, pd = o.pad, s = (W - 2 * pd) / ((x1 - x0) * kx), H = Math.round((y1 - y0) * s + 2 * pd);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.style.aspectRatio = W + ' / ' + H; svg.innerHTML = '';
    function P(c) { return [pd + (c[0] - x0) * kx * s, pd + (y1 - c[1]) * s]; }
    var gd = el('g', {}, svg), gr = el('g', {}, svg), gp = el('g', {}, svg), gl = el('g', {}, svg), st = P(STORE), lines = [];
    fs.forEach(function (f) {
      var n = f.properties.__name, d = '', c = null, best = 0;
      rings(f.geometry).forEach(function (poly) { poly.forEach(function (ring, ri) {
        var p = ring.map(P); d += 'M' + p.map(function (v) { return f1(v[0]) + ',' + f1(v[1]); }).join('L') + 'Z';
        if (ri) return; var a = 0, cx = 0, cy = 0;
        for (var i = 0, j = p.length - 1; i < p.length; j = i++) { var t = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += t; cx += (p[j][0] + p[i][0]) * t; cy += (p[j][1] + p[i][1]) * t; }
        if (a && Math.abs(a) > best) { best = Math.abs(a); c = [cx / (3 * a), cy / (3 * a)]; }
      }); });
      var path = el('path', { d: d, 'class': 'dst' + (n === HQ ? ' hq' : '') }, gd);
      (shapes[n] = shapes[n] || []).push(path); bind(path, n);
      if (o.routes && c && n !== HQ) {
        var r = el('line', { x1: f1(st[0]), y1: f1(st[1]), x2: f1(c[0]), y2: f1(c[1]), 'class': 'rt', pathLength: 100 }, gr);
        r._len = Math.hypot(c[0] - st[0], c[1] - st[1]); lines.push(r);
        shapes[n].push(r, el('rect', { x: f1(c[0] - 4), y: f1(c[1] - 4), width: 8, height: 8, 'class': 'pt' }, gp));
      }
      if (o.labels && c && o.labels.indexOf(n) > -1 && n !== HQ) { var lb = el('text', { x: f1(c[0]), y: f1(c[1]), 'class': 'lb' }, gl); lb.textContent = n.length > 2 ? n.replace('區', '') : n; }
    });
    if (o.labels) { var hl = el('text', { x: f1(st[0]), y: f1(st[1] - o.mark * 1.05), 'class': 'lb hq' }, gl); hl.textContent = '西屯・門市'; }
    var m = el('g', { 'class': 'store' }, gl), h = o.mark / 2;
    el('rect', { x: f1(st[0] - h), y: f1(st[1] - h), width: o.mark, height: o.mark }, m);
    var tx = el('text', { x: f1(st[0]), y: f1(st[1] + 1), 'font-size': Math.round(o.mark * 0.62) }, m); tx.textContent = '私';
    return lines;
  }
  function animate(lines) {
    if (!lines.length || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var max = Math.max.apply(null, lines.map(function (r) { return r._len; }));
    lines.forEach(function (r) { r.style.strokeDasharray = '100'; r.style.strokeDashoffset = '100'; });
    function go() { lines.forEach(function (r) { r.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1) ' + (0.1 + 1.3 * r._len / max).toFixed(2) + 's,opacity .2s'; r.style.strokeDashoffset = '0'; }); }
    if (!window.IntersectionObserver) return go();
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); requestAnimationFrame(function () { requestAnimationFrame(go); }); } }, { threshold: 0.3 });
    io.observe(all);
  }
  function fallback() { all.innerHTML = ''; all.setAttribute('viewBox', '0 0 1000 200'); all.style.aspectRatio = '5 / 1'; var t = el('text', { x: 0, y: 100, 'class': 'fb' }, all); t.textContent = '地圖資料暫時無法載入，請從下方區名選擇。'; }
  function start() {
    var topo = window.topojson ? Promise.resolve() : new Promise(function (ok, no) { var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    Promise.all([topo, fetch('https://cdn.jsdelivr.net/npm/taiwan-atlas/towns-10t.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })]).then(function (res) {
      var tp = res[1], key = tp.objects.towns ? 'towns' : Object.keys(tp.objects)[0];
      var fs = window.topojson.feature(tp, tp.objects[key]).features.filter(function (f) { var p = f.properties || {}; return Object.keys(p).some(function (k) { return /^(臺中市|台中市)$/.test(String(p[k])); }); });
      fs.forEach(function (f) { var p = f.properties; p.__name = p.TOWNNAME || p.townName || p.TOWN || p.name || Object.keys(p).map(function (k) { return String(p[k]); }).filter(function (v) { return /區$/.test(v); })[0]; });
      fs = fs.filter(function (f) { return btn[f.properties.__name]; });
      if (fs.length < 20) throw new Error('taichung');
      var lines = draw(all, fs, null, { pad: 24, routes: true, mark: 26 });
      if (core) draw(core, fs, URBAN, { pad: 20, labels: URBAN, mark: 56 });
      mark(cur, 'on', true); animate(lines);
    }).catch(fallback);
  }
  if (window.IntersectionObserver) { var lio = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { lio.disconnect(); start(); } }, { rootMargin: '800px 0px' }); lio.observe(root); } else start();
})();
