import type { Page } from 'playwright';
import type { SelectorCatalog } from '../adapters/catalog.js';
import { sleep } from '../util/time.js';
import { ensureNameShim } from './page-prep.js';

/** 注入 CSS 關閉動畫、影片；每次導航後都要重做 */
export async function installStabilizers(page: Page, catalog: SelectorCatalog): Promise<void> {
  await ensureNameShim(page);
  try {
    await page.addStyleTag({ content: catalog.stabilizeCss });
  } catch {
    /* 頁面可能仍在導航中 */
  }
  try {
    await page.evaluate(() => {
      for (const v of Array.from(document.querySelectorAll('video'))) {
        try {
          v.pause();
          v.autoplay = false;
        } catch {
          /* ignore */
        }
      }
    });
  } catch {
    /* ignore */
  }
}

export interface WaitOptions {
  timeoutMs: number;
  quietMs: number;
  /** 頁面已 load 完成、且連續這麼久都沒出現內容或阻擋標記時，提早結束等待（預設 3000） */
  settleMs?: number;
}

/**
 * 等待「主要內容可見」或「登入／限制頁面可辨識」，再等固定 quiet period。
 * 不能只依賴 networkidle（Facebook 幾乎永遠不會 idle）。
 */
export async function waitForSurface(page: Page, catalog: SelectorCatalog, opts: WaitOptions): Promise<'content' | 'blocked' | 'unknown' | 'timeout'> {
  const deadline = Date.now() + opts.timeoutMs;
  const settleMs = opts.settleMs ?? 3000;
  let loadedAt: number | null = null;
  let result: 'content' | 'blocked' | 'unknown' | 'timeout' = 'timeout';
  while (Date.now() < deadline) {
    const state = await page
      .evaluate(
        (c) => {
          const hasArticle = document.querySelector(c.articleSelector) !== null;
          const hasFeed = c.feedSelectors.some((s) => document.querySelector(s) !== null);
          const login = c.loginSelectors.some((s) => document.querySelector(s) !== null);
          const text = (document.body?.innerText ?? '').slice(0, 20000);
          const blockedText = [...c.loginTextPatterns, ...c.checkpointTextPatterns, ...c.permissionTextPatterns].some((p) => new RegExp(p, 'i').test(text));
          const url = location.href;
          const blockedUrl = [...c.loginUrlPatterns, ...c.checkpointUrlPatterns].some((p) => new RegExp(p, 'i').test(url));
          if (hasArticle || hasFeed) return 'content';
          if (login || blockedText || blockedUrl) return 'blocked';
          return document.readyState === 'complete' ? 'loaded' : 'pending';
        },
        {
          articleSelector: catalog.articleSelector,
          feedSelectors: catalog.feedSelectors,
          loginSelectors: catalog.loginSelectors,
          loginTextPatterns: catalog.loginTextPatterns,
          checkpointTextPatterns: catalog.checkpointTextPatterns,
          permissionTextPatterns: catalog.permissionTextPatterns,
          loginUrlPatterns: catalog.loginUrlPatterns,
          checkpointUrlPatterns: catalog.checkpointUrlPatterns,
        },
      )
      .catch(() => 'pending' as const);
    if (state === 'content' || state === 'blocked') {
      result = state;
      break;
    }
    if (state === 'loaded') {
      loadedAt ??= Date.now();
      if (Date.now() - loadedAt >= settleMs) {
        result = 'unknown';
        break;
      }
    } else {
      loadedAt = null;
    }
    await sleep(500);
  }
  await sleep(opts.quietMs);
  return result;
}

export interface ScrollOptions {
  wantPosts: number;
  maxScrolls: number;
  waitMs: number;
}

/** 往下捲動觸發 lazy-load，直到看到足夠貼文或達到捲動上限；最後捲回頂端 */
export async function scrollToLoadPosts(page: Page, catalog: SelectorCatalog, opts: ScrollOptions): Promise<number> {
  const count = async (): Promise<number> =>
    page.evaluate(
      (c) => {
        const roots = c.feedSelectors.map((s) => document.querySelector(s)).filter((x): x is Element => x !== null);
        const scope = roots[0] ?? document.querySelector(c.mainSelectors[0] ?? 'body') ?? document.body;
        const all = Array.from(scope.querySelectorAll(c.articleSelector));
        return all.filter((a) => !a.parentElement?.closest(c.articleSelector)).length;
      },
      { feedSelectors: catalog.feedSelectors, mainSelectors: catalog.mainSelectors, articleSelector: catalog.articleSelector },
    );
  let n = await count();
  for (let i = 0; i < opts.maxScrolls && n < opts.wantPosts; i++) {
    await page.mouse.wheel(0, 1600).catch(() => undefined);
    await page.evaluate(() => window.scrollBy(0, 1600)).catch(() => undefined);
    await sleep(opts.waitMs);
    const next = await count();
    if (next === n) {
      // 再試一次較大的捲動，仍無新內容就停止
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
      await sleep(opts.waitMs);
      const again = await count();
      if (again === n) break;
      n = again;
    } else {
      n = next;
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await sleep(300);
  return n;
}
