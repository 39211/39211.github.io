#!/usr/bin/env node
// 私享家 v4 設計外殼
// 把舊模板頁（guides／local／hubs／posts／knowledge／about 與其他 services）換上 v4 頁首、LINE 引導區與頁尾字標。
// 只換 <header class="site-header">、在頁尾前後插入區塊、在 </head> 前加樣式；
// <head> 原有內容（SEO）、<main> 內容、頁尾連結全部原樣保留。任何一頁檢查不過，就保留該頁原檔並警告，不中斷部署。
// 用法：node .github/scripts/apply_v4_shell.mjs --site-root .   （加 --dry-run 只檢查不寫入）
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ==== SHELL ====
const SITE = 'https://sixiangjialaundry.com';
const MARK = '<!-- sxj-shell:v4 -->';
const OA = 'https://line.me/R/oaMessage/%40454foyks/?';
const WORD = '<div class="sv4-word" aria-hidden="true"><p>私享家洗衣店</p></div>';

function strip(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function block(html, open, closeTag) {
  const i = html.indexOf(open);
  if (i < 0) return null;
  const j = html.indexOf(closeTag, i);
  return j < 0 ? null : { start: i, end: j + closeTag.length };
}
function part(html, open, closeTag) {
  const b = block(html, open, closeTag);
  return b ? html.slice(b.start, b.end) : null;
}

function shellPage(html, opt) {
  const assetBase = (opt && opt.assetBase) || '/';
  if (html.includes(MARK)) return { html, changed: false, reason: 'already' };
  const hd = block(html, '<header class="site-header"', '</header>');
  const ft = block(html, '<footer class="site-footer"', '</footer>');
  if (!hd || !ft || html.indexOf('</head>') < 0 || html.indexOf('<main') < 0) return { html, changed: false, reason: 'not-template' };
  if (html.slice(hd.start + 1, hd.end).includes('<header')) return { html, changed: false, reason: 'nested-header' };

  const src = (html.slice(hd.start, hd.end).match(/go\/line\.html\?source=([A-Za-z0-9_-]+)/) || [])[1];
  const cid = ((html.match(/data-analytics-content-id="([^"]+)"/) || [])[1] || 'page').replace(/[^A-Za-z0-9_-]/g, '');
  const base = src ? src.replace(/-nav$/, '') : 'v4-shell-' + cid;
  const navHref = SITE + '/go/line.html?source=' + (src || base + '-nav');
  const h1 = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const topic = h1.length > 40 ? h1.slice(0, 39) + '…' : h1;
  const msg = (topic ? '你好，我看了「' + topic + '」，想詢問送洗。' : '你好，我想詢問送洗。') + '\n品項：＿＿\n區域：＿＿\n照片另傳。';
  const track = "window.gtag&&gtag('event','line_click',{source:'" + base + "-band',link_source:'" + base + "-band',transport_type:'beacon'})";

  const HEADER = '<header class="sv4-head"><nav class="sv4-nav" aria-label="主要導覽">'
    + '<a class="sv4-brand" href="' + SITE + '/" aria-label="私享家洗衣店首頁"><i aria-hidden="true">私</i><span><b>私享家洗衣店</b><small>SI XIANG JIA LAUNDRY</small></span></a>'
    + '<span class="sv4-links">'
    + '<a href="' + SITE + '/services/shoe-bag-care.html">洗鞋洗包</a>'
    + '<a href="' + SITE + '/services/luxury-garment-cleaning.html">精品・皮件</a>'
    + '<a href="' + SITE + '/services/taichung-laundry-price-list.html">價目</a>'
    + '<a href="' + SITE + '/services/taichung-citywide-laundry-pickup.html">全市收送</a>'
    + '<a href="' + SITE + '/services/business-bulk-laundry.html">店家送洗</a>'
    + '<a href="' + SITE + '/knowledge/">洗護知識庫</a>'
    + '</span><a class="sv4-line" href="' + navHref + '">LINE 預約<span aria-hidden="true">→</span></a></nav></header>';
  const CTA = '<section class="sv4-cta" aria-label="LINE 預約"><div class="sv4-cta-in">'
    + '<p class="k">LINE 送洗 — 官方帳號 @454foyks</p><p class="big">一件也收。</p>'
    + '<div class="row"><ol><li><b>01</b>整體照</li><li><b>02</b>痕跡近照</li><li><b>03</b>洗標或材質</li></ol>'
    + '<div class="act"><p>台中全市免費收送，沒有最低消費。拍三張傳 LINE，門市先看材質再報價。</p>'
    + '<a class="go" href="' + OA + encodeURIComponent(msg) + '" onclick="' + track + '">開啟 LINE，訊息已填好<span aria-hidden="true">→</span></a></div>'
    + '</div></div></section>\n';
  const BAR = '\n<div class="sv4-bar"><a class="l" href="' + navHref + '">LINE 傳照片評估<span aria-hidden="true">→</span></a><a class="p" href="tel:+886424527411" aria-label="打電話給門市 04-2452-7411">電話</a></div>';
  const HEADLINKS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&amp;family=Noto+Sans+TC:wght@400;500;700;900&amp;display=swap">'
    + '<link rel="stylesheet" href="' + assetBase + 'assets/v4/sxj-shell.css?v=1">' + MARK + '\n';

  const close = ft.end - '</footer>'.length;
  const edits = [
    { at: ft.end, end: ft.end, text: BAR },
    { at: close, end: close, text: WORD },
    { at: ft.start, end: ft.start, text: CTA },
    { at: hd.start, end: hd.end, text: HEADER },
  ].sort((a, b) => b.at - a.at);
  let out = html;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  const he = out.indexOf('</head>');
  out = out.slice(0, he) + HEADLINKS + out.slice(he);
  out = out.replace(/<body([^>]*)>/, (m, a) => (/\bclass="/.test(a)
    ? '<body' + a.replace(/\bclass="([^"]*)"/, (x, c) => 'class="' + c + ' sv4"') + '>'
    : '<body' + a + ' class="sv4">'));
  return { html: out, changed: true };
}

function verifyShell(before, after) {
  const fail = m => { throw new Error(m); };
  const n = (h, re) => (h.match(re) || []).length;
  if (!after.startsWith(before.slice(0, before.indexOf('</head>')))) fail('<head> 原有內容被改動');
  const m0 = part(before, '<main', '</main>');
  if (!m0 || part(after, '<main', '</main>') !== m0) fail('<main> 內容被改動');
  const f0 = part(before, '<footer class="site-footer"', '</footer>');
  const f1 = part(after, '<footer class="site-footer"', '</footer>');
  if (!f0 || !f1 || f1.replace(WORD, '') !== f0) fail('頁尾內容被改動');
  if (n(after, /application\/ld\+json/g) !== n(before, /application\/ld\+json/g)) fail('JSON-LD 數量不同');
  if (n(after, /<h1[\s>]/g) !== n(before, /<h1[\s>]/g)) fail('h1 數量不同');
  if (n(after, /<title[\s>]/g) !== n(before, /<title[\s>]/g)) fail('title 數量不同');
  if (n(after, /class="sv4-head"/g) !== 1 || n(after, /sxj-shell:v4/g) !== 1) fail('外殼沒有剛好套用一次');
  if (n(after, /class="site-header"/g) !== 0) fail('舊頁首還在');
  return true;
}
// ==== CLI ====

const argv = process.argv.slice(2);
const root = argv.includes('--site-root') ? argv[argv.indexOf('--site-root') + 1] : '.';
const dry = argv.includes('--dry-run');
const LEGACY_LINE = 'https://line.me/ti/p/4m-rA6hxf6';
const OFFICIAL_LINE = 'https://line.me/R/ti/p/%40454foyks';
const strict = argv.includes('--strict');
const planned = [];
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'assets', 'content-calendar', 'scripts']);

if (!existsSync(join(root, 'assets/v4/sxj-shell.css'))) {
  console.log('::warning::assets/v4/sxj-shell.css not found — v4 shell skipped');
  process.exit(strict ? 1 : 0);
}
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) yield* walk(p); }
    else if (name.endsWith('.html')) yield p;
  }
}
let applied = 0, already = 0, other = 0, failed = 0, routed = 0;
for (const file of walk(root)) {
  const rel = relative(root, file).split(sep).join('/');
  const raw = readFileSync(file, 'utf8');
  const before = raw.split(LEGACY_LINE).join(OFFICIAL_LINE);
  if (before !== raw) routed++;
  const r = shellPage(before);
  if (!r.changed) {
    if (r.reason === 'already') already++; else other++;
    if (before !== raw) planned.push({file, html: before});
    continue;
  }
  try { verifyShell(before, r.html); }
  catch (e) { failed++; console.log('::warning::v4 shell skipped ' + rel + ': ' + e.message); continue; }
  planned.push({file, html: r.html});
  applied++;
}
if (strict && failed) { console.error('::error::v4 shell validation failed; no page was written'); process.exit(1); }
if (!dry) for (const item of planned) writeFileSync(item.file, item.html);
console.log(`::notice::v4 shell${dry ? ' (dry run)' : ''}: ${applied} pages updated, ${already} already shelled, ${other} not old-template (v4 pages, 404, redirects), ${failed} skipped by checks, ${routed} official LINE routes normalized`);
if (applied + already < 100) console.log('::warning::v4 shell covered fewer than 100 pages — the page template may have changed');
