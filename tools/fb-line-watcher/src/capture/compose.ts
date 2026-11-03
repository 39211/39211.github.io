import type { BrowserContext, Page } from 'playwright';
import type { RawCapture } from './capture.js';
import { preparePage } from '../browser/page-prep.js';

export interface ComposeInfo {
  title: string;
  lines: string[];
  sourceUrl?: string;
  badge?: string;
}

export interface ComposeOptions {
  jpegQuality: number;
  maxOriginalBytes: number;
  maxPreviewBytes: number;
  previewWidth: number;
}

export interface ComposedImage {
  original: Buffer;
  preview: Buffer;
  width: number;
  height: number;
}

const composePages = new WeakMap<BrowserContext, Page>();

async function getComposePage(context: BrowserContext): Promise<Page> {
  let p = composePages.get(context);
  if (!p || p.isClosed()) {
    p = await context.newPage();
    await preparePage(p);
    composePages.set(context, p);
  }
  return p;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function html(raw: RawCapture, info: ComposeInfo, imgWidthCss: string): string {
  const dataUrl = `data:image/png;base64,${raw.png.toString('base64')}`;
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#f0f2f5;font-family:"Noto Sans TC","Microsoft JhengHei","PingFang TC","WenQuanYi Zen Hei",Arial,sans-serif;}
  .wrap{padding:12px;}
  .bar{background:#1c1e21;color:#fff;border-radius:10px 10px 0 0;padding:10px 14px;font-size:14px;line-height:1.5;}
  .bar .t{font-weight:700;font-size:16px;display:flex;align-items:center;gap:8px}
  .badge{background:#d93025;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.5px}
  .bar .l{opacity:.9;font-size:12.5px;white-space:pre-wrap;word-break:break-all}
  .img{background:#fff;border:1px solid #d0d3d8;border-top:0;border-bottom:0;display:block}
  .img img{display:block;width:${imgWidthCss};height:auto}
  .foot{background:#e4e6eb;color:#333;border-radius:0 0 10px 10px;padding:8px 14px;font-size:11.5px;word-break:break-all;line-height:1.4}
  </style></head><body><div class="wrap">
  <div class="bar"><div class="t">${esc(info.title)}${info.badge ? `<span class="badge">${esc(info.badge)}</span>` : ''}</div><div class="l">${info.lines.map(esc).join('\n')}</div></div>
  <div class="img"><img src="${dataUrl}" alt=""></div>
  <div class="foot">${info.sourceUrl ? `來源：${esc(info.sourceUrl)}<br>` : ''}fb-line-watcher · 截圖為授權帳號畫面所見內容，非 Facebook 官方資料</div>
  </div></body></html>`;
}

async function shoot(page: Page, quality: number): Promise<Buffer> {
  return page.screenshot({ type: 'jpeg', quality, fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css' });
}

/**
 * 把原始截圖與系統資訊條組合成一張 JPEG（原圖）與一張縮圖（LINE 預覽），
 * 並確保檔案大小符合 LINE 限制（原圖 ≤10MB、預覽 ≤1MB）。
 */
export async function composeEvidence(context: BrowserContext, raw: RawCapture, info: ComposeInfo, opts: ComposeOptions): Promise<ComposedImage> {
  const page = await getComposePage(context);
  const width = Math.min(Math.max(raw.width + 24, 360), 1600);
  await page.setViewportSize({ width, height: 600 });
  await page.setContent(html(raw, info, `${raw.width}px`), { waitUntil: 'load' });
  let quality = opts.jpegQuality;
  let original = await shoot(page, quality);
  while (original.length > opts.maxOriginalBytes && quality > 35) {
    quality -= 15;
    original = await shoot(page, quality);
  }
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  await page.setViewportSize({ width: opts.previewWidth, height: 400 });
  await page.setContent(html(raw, info, '100%'), { waitUntil: 'load' });
  let pq = 68;
  let preview = await shoot(page, pq);
  while (preview.length > opts.maxPreviewBytes && pq > 25) {
    pq -= 15;
    preview = await shoot(page, pq);
  }
  if (preview.length > opts.maxPreviewBytes) {
    preview = await page.screenshot({ type: 'jpeg', quality: 40, clip: { x: 0, y: 0, width: opts.previewWidth, height: 1600 }, animations: 'disabled', caret: 'hide', scale: 'css' });
  }
  await page.setContent('<!doctype html><html><body></body></html>').catch(() => undefined);
  return { original, preview, width, height: fullHeight };
}
