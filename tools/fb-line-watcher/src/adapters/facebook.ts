import type { Page } from 'playwright';
import type { TargetConfig } from '../config/schema.js';
import { mergeCatalog, withGroupSort, type SelectorCatalog } from './catalog.js';
import { extractInPage } from './dom-extract.js';
import { expandPosts, type ExpandStats } from './expand.js';
import type { ExtractResult } from './types.js';
import { installStabilizers, scrollToLoadPosts, waitForSurface } from '../browser/stabilize.js';
import { classifySurface, type SurfaceHealth } from '../browser/session-health.js';

export const MARK_ATTR = 'data-fblw-id';

export interface SurfaceScan {
  health: SurfaceHealth;
  extract?: ExtractResult;
  expand?: ExpandStats;
  navigatedUrl: string;
  timings: { navigateMs: number; expandMs: number; extractMs: number };
}

/**
 * 粉專與社團共用的 adapter：兩者畫面結構相同（feed → article → nested article），
 * 差別只在網址排序參數與診斷文字。
 */
export class FacebookSurfaceAdapter {
  readonly catalog: SelectorCatalog;

  constructor(readonly target: TargetConfig) {
    this.catalog = mergeCatalog(target.adapter_overrides);
  }

  get surfaceType(): 'facebook_page' | 'facebook_group' {
    return this.target.type;
  }

  navigationUrl(): string {
    return this.target.type === 'facebook_group' ? withGroupSort(this.target.url, this.target.preferred_sort, this.catalog) : this.target.url;
  }

  async navigate(page: Page, opts: { timeoutMs: number; quietMs: number }): Promise<{ health: SurfaceHealth; url: string }> {
    const url = this.navigationUrl();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    await installStabilizers(page, this.catalog);
    await waitForSurface(page, this.catalog, { timeoutMs: Math.min(opts.timeoutMs, 30000), quietMs: opts.quietMs });
    let health = await classifySurface(page, this.catalog);
    if (health.status === 'EMPTY') {
      // 可能還在載入，再給一次短暫機會
      await waitForSurface(page, this.catalog, { timeoutMs: 6000, quietMs: opts.quietMs, settleMs: 1500 });
      health = await classifySurface(page, this.catalog);
    }
    return { health, url };
  }

  async scan(page: Page, opts: { timeoutMs: number; quietMs: number; scrollWaitMs?: number }): Promise<SurfaceScan> {
    const t0 = Date.now();
    const { health, url } = await this.navigate(page, opts);
    const navigateMs = Date.now() - t0;
    if (health.status !== 'READY') {
      return { health, navigatedUrl: url, timings: { navigateMs, expandMs: 0, extractMs: 0 } };
    }
    await scrollToLoadPosts(page, this.catalog, { wantPosts: this.target.scan_latest_posts, maxScrolls: this.target.max_scrolls, waitMs: opts.scrollWaitMs ?? 1200 });
    const t1 = Date.now();
    const expand = await expandPosts(page, this.catalog, this.target);
    await installStabilizers(page, this.catalog);
    const expandMs = Date.now() - t1;
    const t2 = Date.now();
    const extract = await page.evaluate(extractInPage, {
      catalog: this.catalog,
      markAttr: MARK_ATTR,
      maxPosts: this.target.scan_latest_posts,
      skipSponsored: this.target.skip_sponsored,
    });
    const extractMs = Date.now() - t2;
    return { health, extract, expand, navigatedUrl: url, timings: { navigateMs, expandMs, extractMs } };
  }
}
