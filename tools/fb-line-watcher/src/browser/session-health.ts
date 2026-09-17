import type { Page } from 'playwright';
import type { SelectorCatalog } from '../adapters/catalog.js';
import { ensureNameShim } from './page-prep.js';

export type SurfaceStatus = 'READY' | 'LOGIN_REQUIRED' | 'CHECKPOINT' | 'PERMISSION_DENIED' | 'EMPTY' | 'NETWORK_ERROR';

export interface SurfaceHealth {
  status: SurfaceStatus;
  url: string;
  title: string;
  articleCount: number;
  feedFound: boolean;
  markers: string[];
}

/**
 * 判斷目前頁面是正常內容、登入頁、安全檢查、權限不足或空白。
 * 只讀取畫面資訊，不嘗試任何自動突破。
 */
export async function classifySurface(page: Page, catalog: SelectorCatalog): Promise<SurfaceHealth> {
  try {
    await ensureNameShim(page);
    return await page.evaluate(
      (c) => {
        const markers: string[] = [];
        const url = location.href;
        const title = document.title;
        const text = (document.body?.innerText ?? '').slice(0, 30000);
        const test = (patterns: string[], subject: string, tag: string): boolean => {
          for (const p of patterns) {
            if (new RegExp(p, 'i').test(subject)) {
              markers.push(`${tag}:${p}`);
              return true;
            }
          }
          return false;
        };
        const roots = c.feedSelectors.map((s) => document.querySelector(s)).filter((x): x is Element => x !== null);
        const feedFound = roots.length > 0;
        const scope = roots[0] ?? document.querySelector(c.mainSelectors[0] ?? 'body') ?? document.body;
        const articles = Array.from(scope.querySelectorAll(c.articleSelector)).filter((a) => !a.parentElement?.closest(c.articleSelector));
        const articleCount = articles.length;

        const checkpointUrl = test(c.checkpointUrlPatterns, url, 'checkpoint-url');
        const checkpointText = test(c.checkpointTextPatterns, text, 'checkpoint-text');
        const loginUrl = test(c.loginUrlPatterns, url, 'login-url');
        const loginSel = c.loginSelectors.some((s) => {
          const hit = document.querySelector(s) !== null;
          if (hit) markers.push(`login-selector:${s}`);
          return hit;
        });
        const loginText = test(c.loginTextPatterns, text, 'login-text');
        const permText = test(c.permissionTextPatterns, text, 'permission-text');
        const joinBtn = Array.from(document.querySelectorAll('[role="button"], a[role="link"]')).some((b) => {
          const t = (b.textContent ?? '').trim();
          return c.joinGroupButtonPatterns.some((p) => new RegExp(p, 'i').test(t));
        });
        if (joinBtn) markers.push('join-group-button');

        let status: SurfaceStatus;
        if (checkpointUrl || (checkpointText && articleCount === 0)) status = 'CHECKPOINT';
        else if (loginUrl || loginSel || (loginText && articleCount === 0)) status = 'LOGIN_REQUIRED';
        else if (articleCount === 0 && (permText || joinBtn)) status = 'PERMISSION_DENIED';
        else if (articleCount === 0 && !feedFound) status = 'EMPTY';
        else status = 'READY';
        return { status, url, title, articleCount, feedFound, markers };
      },
      {
        feedSelectors: catalog.feedSelectors,
        mainSelectors: catalog.mainSelectors,
        articleSelector: catalog.articleSelector,
        checkpointUrlPatterns: catalog.checkpointUrlPatterns,
        checkpointTextPatterns: catalog.checkpointTextPatterns,
        loginUrlPatterns: catalog.loginUrlPatterns,
        loginSelectors: catalog.loginSelectors,
        loginTextPatterns: catalog.loginTextPatterns,
        permissionTextPatterns: catalog.permissionTextPatterns,
        joinGroupButtonPatterns: catalog.joinGroupButtonPatterns,
      },
    );
  } catch (e) {
    return { status: 'NETWORK_ERROR', url: page.url(), title: '', articleCount: 0, feedFound: false, markers: [`evaluate-failed:${e instanceof Error ? e.message : String(e)}`] };
  }
}

/** 是否已有 Facebook 登入 cookie（只檢查存在與否，不讀取值） */
export async function hasFacebookLoginCookie(page: Page): Promise<boolean> {
  try {
    const cookies = await page.context().cookies(['https://www.facebook.com']);
    return cookies.some((c) => c.name === 'c_user' && c.value.length > 0);
  } catch {
    return false;
  }
}
