import type { Page } from 'playwright';
import { ensureNameShim } from '../browser/page-prep.js';

export interface CaptureOptions {
  markAttr: string;
  /** 要截圖的貼文容器 mark id */
  postMarkId: string;
  /** 要加框標記為 NEW 的留言／回覆 mark id */
  highlightMarkIds: string[];
  /** 截圖時暫時隱藏的元素（頂端導覽、聊天浮窗） */
  hideSelectors: string[];
  /** 可選：截圖前對符合的文字做模糊（正規表達式來源） */
  redactPatterns?: string[];
  timeoutMs?: number;
}

export interface RawCapture {
  png: Buffer;
  width: number;
  height: number;
  redactionApplied: number;
  redactionFailed: boolean;
}

const STYLE_ID = 'fblw-capture-style';
const REDACT_ATTR = 'data-fblw-redact';

function buildCss(opts: CaptureOptions): string {
  const hide = opts.hideSelectors.length ? `${opts.hideSelectors.join(', ')} { visibility: hidden !important; }` : '';
  const hl = opts.highlightMarkIds
    .map(
      (id) => `[${opts.markAttr}="${id}"] {
  outline: 3px solid #d93025 !important; outline-offset: 3px !important; border-radius: 10px !important;
  box-shadow: 0 0 0 7px rgba(217,48,37,0.13) !important; position: relative !important;
}
[${opts.markAttr}="${id}"]::after {
  content: "NEW"; position: absolute; top: -11px; right: 10px; z-index: 2147483000;
  background: #d93025; color: #fff; font: 700 11px/1 Arial, "Noto Sans TC", sans-serif; letter-spacing: .5px;
  padding: 3px 7px; border-radius: 4px; pointer-events: none;
}`,
    )
    .join('\n');
  return `${hide}\n${hl}\n[${REDACT_ATTR}] { filter: blur(6px) !important; }`;
}

/**
 * 對指定貼文容器截圖（含新增留言的紅框標記）。
 * 所有樣式與遮罩都是暫時性的，截圖後立即還原。
 */
export async function captureEntity(page: Page, opts: CaptureOptions): Promise<RawCapture> {
  const css = buildCss(opts);
  let redactionApplied = 0;
  let redactionFailed = false;
  await ensureNameShim(page);
  await page.evaluate(
    ({ css, id }) => {
      document.getElementById(id)?.remove();
      const st = document.createElement('style');
      st.id = id;
      st.textContent = css;
      document.head.appendChild(st);
    },
    { css, id: STYLE_ID },
  );
  try {
    if (opts.redactPatterns && opts.redactPatterns.length) {
      try {
        redactionApplied = await page.evaluate(
          ({ attr, mark, patterns, redactAttr }) => {
            const root = document.querySelector(`[${attr}="${mark}"]`);
            if (!root) return 0;
            const regs = patterns.map((p) => new RegExp(p, 'g'));
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const nodes: Text[] = [];
            let n: Node | null;
            while ((n = walker.nextNode())) nodes.push(n as Text);
            let count = 0;
            for (const t of nodes) {
              const text = t.nodeValue ?? '';
              const hits: [number, number][] = [];
              for (const r of regs) {
                r.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = r.exec(text))) {
                  hits.push([m.index, m.index + m[0].length]);
                  if (m[0].length === 0) r.lastIndex++;
                }
              }
              if (!hits.length) continue;
              hits.sort((a, b) => a[0] - b[0]);
              const frag = document.createDocumentFragment();
              let pos = 0;
              for (const [s, e] of hits) {
                if (s < pos) continue;
                if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)));
                const span = document.createElement('span');
                span.setAttribute(redactAttr, '1');
                span.textContent = text.slice(s, e);
                frag.appendChild(span);
                pos = e;
                count++;
              }
              if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
              t.parentNode?.replaceChild(frag, t);
            }
            return count;
          },
          { attr: opts.markAttr, mark: opts.postMarkId, patterns: opts.redactPatterns, redactAttr: REDACT_ATTR },
        );
      } catch {
        redactionFailed = true;
      }
    }
    const locator = page.locator(`[${opts.markAttr}="${opts.postMarkId}"]`).first();
    await locator.scrollIntoViewIfNeeded({ timeout: opts.timeoutMs ?? 15000 }).catch(() => undefined);
    const png = await locator.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', scale: 'css', timeout: opts.timeoutMs ?? 20000 });
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    return { png, width, height, redactionApplied, redactionFailed };
  } finally {
    await page
      .evaluate(
        ({ id, redactAttr }) => {
          document.getElementById(id)?.remove();
          for (const span of Array.from(document.querySelectorAll(`[${redactAttr}]`))) {
            span.replaceWith(document.createTextNode(span.textContent ?? ''));
          }
        },
        { id: STYLE_ID, redactAttr: REDACT_ATTR },
      )
      .catch(() => undefined);
  }
}

/** 對整個可視區域截圖（視覺降級模式使用） */
export async function captureViewport(page: Page, hideSelectors: string[]): Promise<RawCapture> {
  const css = hideSelectors.length ? `${hideSelectors.join(', ')} { visibility: hidden !important; }` : '';
  await ensureNameShim(page);
  await page.evaluate(
    ({ css, id }) => {
      document.getElementById(id)?.remove();
      const st = document.createElement('style');
      st.id = id;
      st.textContent = css;
      document.head.appendChild(st);
    },
    { css, id: STYLE_ID },
  );
  try {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', scale: 'css', fullPage: false });
    return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20), redactionApplied: 0, redactionFailed: false };
  } finally {
    await page.evaluate((id) => document.getElementById(id)?.remove(), STYLE_ID).catch(() => undefined);
  }
}
