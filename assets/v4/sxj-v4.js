/* 私享家洗衣店 v4 — progressive enhancement; every page works without this file. */
(function () {
  'use strict';
  var d = document, w = window;
  var RM = !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var CAMP = [{"start":"2026-10-26","end":"2026-11-09","ribbon":"萬聖節派對後，沾到糖漿、油彩的鞋衣先別泡水","period":"10/26–11/9"},{"start":"2026-11-10","end":"2026-11-30","ribbon":"入冬換季：外套拿出來，先翻領口、袖口、腋下","period":"11/10–11/30"},{"start":"2026-12-01","end":"2026-12-25","ribbon":"聖誕聚會前：大衣、毛衣、西裝提早送，聚會前拿回","period":"12/1–12/25"},{"start":"2026-12-26","end":"2027-02-05","ribbon":"過年前：棉被、窗簾、地毯，大件不用自己搬","period":"12/26–2/5"}];
  var HOURS = { 1: [10, 20], 2: [10, 20], 3: [10, 20], 4: [10, 20], 5: [10, 20], 6: [12, 18] };
  var DAY = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  var LINE = '/go/line.html?source=';
  var PAGE = d.body.getAttribute('data-page') || '';
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function tp() { var n = new Date(); return new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000); }
  function ymd(t) { return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function status() {
    var t = tp(), dd = t.getDay(), h = t.getHours() + t.getMinutes() / 60, td = HOURS[dd], txt, on = false;
    if (td && h >= td[0] && h < td[1]) { txt = '營業中・今天到 ' + td[1] + ':00'; on = true; }
    else if (td && h < td[0]) { txt = '休息中・今天 ' + td[0] + ':00 開門'; }
    else { var i = 1; while (!HOURS[(dd + i) % 7]) i++; var nd = (dd + i) % 7; txt = (dd === 0 ? '週日公休' : '已打烊') + '・' + (i === 1 ? '明天' : DAY[nd]) + ' ' + HOURS[nd][0] + ':00 開門'; }
    $$('[data-open-text]').forEach(function (e) { e.textContent = txt; });
    $$('[data-open-dot]').forEach(function (e) { e.style.background = on ? 'var(--color-accent)' : 'var(--color-neutral-500)'; });
    $$('[data-day]').forEach(function (e) { e.style.borderTopColor = (+e.getAttribute('data-day') === dd) ? 'var(--color-accent)' : 'var(--color-neutral-300)'; });
  }

  function campaign() {
    var td = ymd(tp()), i = -1, k;
    for (k = 0; k < CAMP.length; k++) if (td >= CAMP[k].start && td <= CAMP[k].end) { i = k; break; }
    if (i < 0) for (k = 0; k < CAMP.length; k++) if (td < CAMP[k].start) { i = k; break; }
    if (i < 0) i = CAMP.length - 1;
    $$('[data-camp-ribbon]').forEach(function (e) { e.textContent = CAMP[i].ribbon; });
    $$('[data-camp-period]').forEach(function (e) { e.textContent = CAMP[i].period; });
    $$('[data-campaign]').forEach(function (e, j) { if (j === i) e.removeAttribute('hidden'); else e.setAttribute('hidden', ''); });
  }

  function intro() {
    if (PAGE !== 'home' || RM) return;
    try { if (sessionStorage.getItem('sxj-intro')) return; sessionStorage.setItem('sxj-intro', '1'); } catch (e) {}
    var o = d.createElement('div'); o.className = 'sxj-intro'; o.setAttribute('aria-hidden', 'true');
    o.innerHTML = '<div class="w"><span class="m">私</span><span class="t"><b>私享家洗衣店</b><i>先看材質，再決定洗法。</i></span></div>';
    d.body.appendChild(o);
    setTimeout(function () { o.classList.add('out'); setTimeout(function () { o.remove(); }, 1100); }, 900);
  }

  function reveals() {
    if (RM || !w.IntersectionObserver) return;
    var vh = w.innerHeight;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; var el = e.target;
        if (el.getAttribute('data-reveal') === 'img') el.style.clipPath = 'inset(0 0 0% 0)'; else { el.style.opacity = '1'; el.style.transform = 'none'; }
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    $$('[data-reveal]').forEach(function (el) {
      if (el.closest('[hidden]') || el.getBoundingClientRect().top < vh * 0.94) return;
      if (el.getAttribute('data-reveal') === 'img') { el.style.clipPath = 'inset(0 0 100% 0)'; el.style.transition = 'clip-path 1.3s cubic-bezier(.2,.7,.1,1)'; }
      else { el.style.opacity = '0'; el.style.transform = 'translateY(36px)'; el.style.transition = 'opacity 1s cubic-bezier(.2,.7,.2,1), transform 1s cubic-bezier(.2,.7,.2,1)'; }
      io.observe(el);
    });
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; var el = e.target, to = +el.getAttribute('data-to'), t0 = performance.now(); cio.unobserve(el);
        (function step(t) { var p = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(t0);
      });
    }, { threshold: 0.4 });
    $$('[data-count]').forEach(function (el) { if (el.getBoundingClientRect().top < vh) return; el.setAttribute('data-to', el.textContent.trim()); el.textContent = '0'; cio.observe(el); });
  }

  var mf = null, mfTotal = 0;
  function manifestoInit() {
    var p = $('#sxj-manifesto'); if (!p || RM) return;
    var spans = [];
    Array.prototype.slice.call(p.childNodes).forEach(function (n) {
      var red = n.nodeType === 1, text = n.textContent, frag = d.createDocumentFragment();
      Array.from(text).forEach(function (ch) { var s = d.createElement('span'); s.textContent = ch; s.style.transition = 'color .25s'; s.setAttribute('data-c', red ? 'var(--color-accent-700)' : 'var(--color-text)'); s.style.color = 'var(--color-neutral-300)'; frag.appendChild(s); spans.push(s); });
      if (red) { n.textContent = ''; n.appendChild(frag); } else p.replaceChild(frag, n);
    });
    mf = spans; mfTotal = spans.length;
  }

  function onScroll() {
    var vh = w.innerHeight, sy = w.scrollY || w.pageYOffset;
    var prog = $('#sxj-progress');
    if (prog) { var max = d.documentElement.scrollHeight - vh; prog.style.transform = 'scaleX(' + (max > 0 ? clamp(sy / max, 0, 1) : 0) + ')'; }
    if (RM) return;
    $$('[data-parallax]').forEach(function (el) { var r = el.parentElement.getBoundingClientRect(); if (r.bottom < -200 || r.top > vh + 200) return; var f = +el.getAttribute('data-parallax') || 0.1; el.style.transform = 'translate3d(0,' + ((r.top + r.height / 2 - vh / 2) * -f).toFixed(1) + 'px,0) scale(1.14)'; });
    var line = $('#sxj-line'); if (line) { var lr = line.parentElement.getBoundingClientRect(); line.style.transform = 'scaleX(' + clamp((vh * 0.9 - lr.top) / (vh * 0.7), 0, 1) + ')'; }
    if (mf) { var m = $('#manifesto').getBoundingClientRect(), pr = clamp((vh * 0.85 - m.top) / (m.height * 0.8), 0, 1), lit = Math.floor(pr * mfTotal * 1.05); mf.forEach(function (s, i) { s.style.color = i < lit ? s.getAttribute('data-c') : 'var(--color-neutral-300)'; }); }
  }

  function loupe() {
    var hero = $('#sxj-hero'); if (!hero) return; var img = $('img', hero); if (!img) return;
    var Z = 2.6, lp = d.createElement('div'), li = d.createElement('img'), tag = d.createElement('span');
    lp.className = 'sxj-loupe'; lp.setAttribute('aria-hidden', 'true'); li.alt = ''; tag.textContent = '先看材質 ×2.6';
    lp.appendChild(li); lp.appendChild(tag); hero.appendChild(lp);
    function place(x, y, ease) {
      var W = hero.clientWidth, H = hero.clientHeight; if (!W) return;
      var L = Math.round(clamp(W * 0.17, 120, 240)), lx = clamp(x * W, L / 2, W - L / 2), ly = clamp(y * H, L / 2, H - L / 2);
      var tr = ease ? 'left .7s cubic-bezier(.2,.7,.2,1), top .7s cubic-bezier(.2,.7,.2,1), transform-origin .7s cubic-bezier(.2,.7,.2,1)' : 'none';
      if (!li.src) li.src = img.currentSrc || img.src;
      lp.style.transition = tr; li.style.transition = tr;
      lp.style.width = lp.style.height = L + 'px'; lp.style.left = (lx - L / 2) + 'px'; lp.style.top = (ly - L / 2) + 'px';
      li.style.width = W + 'px'; li.style.height = H + 'px'; li.style.left = (L / 2 - lx) + 'px'; li.style.top = (L / 2 - ly) + 'px';
      li.style.transformOrigin = lx + 'px ' + ly + 'px'; li.style.transform = 'scale(' + Z + ')';
    }
    function mv(e) { var t = e.touches ? e.touches[0] : e, r = hero.getBoundingClientRect(); place((t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height, false); }
    var rest = function () { place(0.64, 0.46, true); };
    hero.addEventListener('mousemove', mv); hero.addEventListener('touchmove', mv, { passive: true }); hero.addEventListener('mouseleave', rest);
    var fit = function () { place(0.64, 0.46, false); };
    if (w.ResizeObserver) new ResizeObserver(fit).observe(hero); else w.addEventListener('resize', fit);
    if (img.complete) fit(); else img.addEventListener('load', fit);
  }

  function svcPreview() {
    var svc = $('#sxj-svc'); if (!svc || !w.matchMedia || !w.matchMedia('(hover: hover) and (min-width: 1100px)').matches) return;
    var pv = d.createElement('div'); pv.className = 'sxj-pv'; pv.setAttribute('aria-hidden', 'true');
    var imgs = $$('[data-svc] img', svc).map(function (t) { var i = d.createElement('img'); i.src = t.src; i.alt = ''; pv.appendChild(i); return i; });
    d.body.appendChild(pv);
    $$('[data-svc]', svc).forEach(function (a) { a.addEventListener('mouseenter', function () { var k = +a.getAttribute('data-svc'); imgs.forEach(function (im, j) { im.style.opacity = j === k ? 1 : 0; }); pv.classList.add('on'); }); });
    svc.addEventListener('mousemove', function (e) { pv.style.left = (e.clientX + 32) + 'px'; pv.style.top = (e.clientY - 180) + 'px'; });
    svc.addEventListener('mouseleave', function () { pv.classList.remove('on'); });
  }

  function sendLine(text, src, btn) {
    try { if (typeof w.gtag === 'function') w.gtag('event', 'line_click', { source: src, link_source: src, transport_type: 'beacon' }); } catch (e) {}
    w.open('https://line.me/R/oaMessage/%40454foyks/?' + encodeURIComponent(text), '_blank', 'noopener');
    if (btn) btn.textContent = '訊息已準備，請在 LINE 確認送出 →';
  }

  function estimator() {
    var rows = $$('[data-key]'); if (!rows.length) return;
    var cnt = $('#est-count'), sub = $('#est-sub'), send = $('#est-send'), clear = $('#est-clear'), q = {};
    function render() {
      var c = 0, s = 0, picked = [];
      rows.forEach(function (r) { var n = q[r.getAttribute('data-key')] || 0; $('[data-qty]', r).textContent = n; if (n) { c += n; s += n * +r.getAttribute('data-price'); picked.push(r.getAttribute('data-name') + ' × ' + n); } });
      cnt.textContent = c; sub.textContent = '$' + s.toLocaleString(); send.disabled = !c; send.textContent = '開啟 LINE，帶入清單 →';
      send._text = '你好，我想詢問送洗：\n' + picked.map(function (p) { return '・' + p; }).join('\n') + '\n參考小計 $' + s + '（水洗參考價）\n照片另傳。';
    }
    rows.forEach(function (r) { var k = r.getAttribute('data-key');
      $('[data-inc]', r).addEventListener('click', function () { q[k] = (q[k] || 0) + 1; render(); });
      $('[data-dec]', r).addEventListener('click', function () { q[k] = Math.max(0, (q[k] || 0) - 1); render(); }); });
    clear.addEventListener('click', function () { q = {}; render(); });
    send.addEventListener('click', function () { sendLine(send._text, 'v4-prices-estimate', send); });
    render();
  }

  function business() {
    var box = $('#biz-rows'); if (!box) return;
    var tpl = $('[data-biz-row]', box).cloneNode(true), out = $('#biz-text'), btn = $('#biz-send');
    function build() {
      var ind = ($('input[name="bizind"]:checked') || {}).value || '';
      var items = $$('[data-biz-row]', box).map(function (r) { var qy = $('[data-f="qty"]', r).value.replace(/[^0-9]/g, ''); return qy ? '・' + $('[data-f="item"]', r).value + ' × ' + qy + '（' + $('[data-f="freq"]', r).value + '）' : ''; }).filter(Boolean);
      var note = $('#biz-note').value.trim();
      out.textContent = '你好，我想詢問店家／公司大量送洗。\n行業：' + ind + '\n品項：\n' + items.join('\n') + '\n交接方式：' + $('#biz-handover').value + '\n區域：' + $('#biz-district').value + (note ? '\n備註：' + note : '') + '\n（照片另傳）';
      var rs = $$('[data-biz-row]', box); rs.forEach(function (r) { $('[data-remove]', r).disabled = rs.length <= 1; });
      btn.textContent = '開啟 LINE，帶入清單 →';
    }
    function wire(r) { $('[data-remove]', r).addEventListener('click', function () { if ($$('[data-biz-row]', box).length > 1) { r.remove(); build(); } }); }
    $$('[data-biz-row]', box).forEach(wire);
    $('#biz-add').addEventListener('click', function () { var r = tpl.cloneNode(true); $('[data-f="qty"]', r).value = ''; $('[data-f="item"]', r).selectedIndex = 0; $('[data-f="freq"]', r).selectedIndex = 0; box.appendChild(r); wire(r); build(); });
    d.addEventListener('input', function (e) { if (e.target.closest('#biz-form')) build(); });
    d.addEventListener('change', function (e) { if (e.target.closest('#biz-form')) build(); });
    btn.addEventListener('click', function () { sendLine(out.textContent, 'v4-business-list', btn); });
    build();
  }

  status(); campaign(); intro(); manifestoInit(); reveals(); loupe(); svcPreview(); estimator(); business();
  var raf = 0; w.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; onScroll(); }); }, { passive: true });
  w.addEventListener('resize', onScroll); onScroll(); setInterval(status, 60000);
})();
/* ==== v4.1 ==== */
(function () {
  var PROD = /(^|\.)sixiangjialaundry\.com$|^39211\.github\.io$/.test(location.hostname);
  if (!PROD) {
    var me = document.querySelector('script[src*="assets/v4/sxj-v4.js"]');
    var base = me ? me.src.replace(/assets\/v4\/sxj-v4\.js.*$/, '') : '';
    var LOCAL = { '/': 'index.html', '/index.html': 'index.html', '/campaign/': 'campaign/index.html', '/campaign/index.html': 'campaign/index.html' };
    ['taichung-laundry-price-list', 'shoe-bag-care', 'luxury-garment-cleaning', 'taichung-citywide-laundry-pickup', 'business-bulk-laundry'].forEach(function (n) { LOCAL['/services/' + n + '.html'] = 'services/' + n + '.html'; });
    document.querySelectorAll('a[href^="/"]').forEach(function (a) {
      var h = a.getAttribute('href'); if (h.indexOf('//') === 0) return;
      var path = h.split('#')[0].split('?')[0], rest = h.slice(path.length);
      a.setAttribute('href', LOCAL[path] && base ? base + LOCAL[path] + rest : 'https://sixiangjialaundry.com' + h);
    });
  }
  var OA = 'https://line.me/R/oaMessage/%40454foyks/?';
  function ga(ev, src) { try { if (typeof window.gtag === 'function') window.gtag('event', ev, { source: src, link_source: src, transport_type: 'beacon' }); } catch (e) {} }
  document.querySelectorAll('[data-line-builder]').forEach(function (box) {
    var out = box.querySelector('[data-line-text]'), open = box.querySelector('[data-line-open]'), copy = box.querySelector('[data-line-copy]');
    var src = box.getAttribute('data-source') || 'v4-guide';
    function text() {
      var L = [box.getAttribute('data-head') || '你好，我想詢問送洗：'];
      box.querySelectorAll('[data-group],[data-field]').forEach(function (g) {
        if (g.hasAttribute('data-field')) { L.push(g.getAttribute('data-field') + '：' + g.value); return; }
        var on = [].filter.call(g.querySelectorAll('[aria-pressed]'), function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return b.textContent.trim(); });
        if (g.getAttribute('data-multi') === '1') { var f = g.getAttribute('data-fmt') || '・{v}'; if (on.length) on.forEach(function (v) { L.push(f.replace('{v}', v)); }); else L.push(g.getAttribute('data-empty') || f.replace('{v}', '＿＿')); }
        else L.push(g.getAttribute('data-group') + '：' + (on[0] || '＿＿'));
      });
      (box.getAttribute('data-tail') || '照片另傳。').split('|').forEach(function (l) { L.push(l); });
      return L.join('\n');
    }
    function render() { var t = text(); if (out) out.textContent = t; if (open) open.setAttribute('href', OA + encodeURIComponent(t)); }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[aria-pressed]'); if (!b || !box.contains(b)) return;
      var g = b.closest('[data-group]'), on = b.getAttribute('aria-pressed') !== 'true';
      if (g && g.getAttribute('data-multi') !== '1') g.querySelectorAll('[aria-pressed]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); render();
    });
    box.addEventListener('change', render);
    if (open) open.addEventListener('click', function () { ga('line_click', src); });
    if (copy) copy.addEventListener('click', function () {
      var t = text(), lab = copy.textContent, done = function () { copy.textContent = '已複製 ✓'; setTimeout(function () { copy.textContent = lab; }, 1800); };
      function failed() {
        copy.textContent = '請長按或選取上方訊息複製';
        if (out && window.getSelection) { var range = document.createRange(); range.selectNodeContents(out); var selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, failed); else failed();
      ga('line_copy', src);
    });
    render();
  });
  var qrs = document.querySelectorAll('[data-line-qr]');
  if (qrs.length && !(window.matchMedia && matchMedia('(pointer:coarse)').matches)) {
    var s = document.createElement('script'); s.async = true; s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    s.onload = function () { try { var q = window.qrcode(0, 'M'); q.addData('https://line.me/R/ti/p/%40454foyks'); q.make(); var svg = q.createSvgTag(4, 0); qrs.forEach(function (el) { el.innerHTML = svg; }); } catch (e) {} };
    document.head.appendChild(s);
  }
})();
