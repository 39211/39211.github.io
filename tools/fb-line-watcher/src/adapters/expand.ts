import type { Page } from 'playwright';
import type { SelectorCatalog } from './catalog.js';
import type { TargetConfig } from '../config/schema.js';
import { sleep } from '../util/time.js';

export interface ExpandStats {
  seeMoreClicks: number;
  commentExpanderClicks: number;
  sortSwitched: boolean;
  limitReached: boolean;
  rounds: number;
}

interface ClickArg {
  articleSelector: string;
  feedSelectors: string[];
  mainSelectors: string[];
  patterns: string[];
  maxPosts: number;
  maxClicks: number;
  perPostLimit: number;
  perPostCounts: Record<string, number>;
}

/** 在頁面內點擊符合文字的按鈕（限最新 N 篇貼文範圍內），回傳點擊數與每篇累計 */
function clickButtonsInPage(arg: ClickArg): { clicked: number; perPostCounts: Record<string, number>; remaining: number } {
  const re = (p: string): RegExp => new RegExp(p, 'i');
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const roots = arg.feedSelectors.map((s) => document.querySelector(s)).filter((x): x is Element => x !== null);
  const scope: Element = roots[0] ?? arg.mainSelectors.map((s) => document.querySelector(s)).find((x): x is Element => x !== null) ?? document.body;
  const topLevel = Array.from(scope.querySelectorAll<HTMLElement>(arg.articleSelector)).filter((a) => !a.parentElement?.closest(arg.articleSelector)).slice(0, arg.maxPosts);
  let clicked = 0;
  let remaining = 0;
  topLevel.forEach((post, i) => {
    const key = String(i);
    for (const b of Array.from(post.querySelectorAll<HTMLElement>('[role="button"]'))) {
      const t = norm(b.textContent);
      if (!t || !arg.patterns.some((p) => re(p).test(t))) continue;
      const used = arg.perPostCounts[key] ?? 0;
      if (used >= arg.perPostLimit || clicked >= arg.maxClicks) {
        remaining++;
        continue;
      }
      try {
        b.click();
        clicked++;
        arg.perPostCounts[key] = used + 1;
      } catch {
        /* ignore */
      }
    }
  });
  return { clicked, perPostCounts: arg.perPostCounts, remaining };
}

interface SortArg {
  articleSelector: string;
  feedSelectors: string[];
  mainSelectors: string[];
  buttonPatterns: string[];
  maxPosts: number;
}

function clickCommentSortButtons(arg: SortArg): number {
  const re = (p: string): RegExp => new RegExp(p, 'i');
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const roots = arg.feedSelectors.map((s) => document.querySelector(s)).filter((x): x is Element => x !== null);
  const scope: Element = roots[0] ?? arg.mainSelectors.map((s) => document.querySelector(s)).find((x): x is Element => x !== null) ?? document.body;
  const topLevel = Array.from(scope.querySelectorAll<HTMLElement>(arg.articleSelector)).filter((a) => !a.parentElement?.closest(arg.articleSelector)).slice(0, arg.maxPosts);
  let clicked = 0;
  for (const post of topLevel) {
    const btn = Array.from(post.querySelectorAll<HTMLElement>('[role="button"]')).find((b) => arg.buttonPatterns.some((p) => re(p).test(norm(b.textContent))));
    if (btn) {
      btn.click();
      clicked++;
      break; // 一次只開一個選單
    }
  }
  return clicked;
}

function clickMenuItem(patterns: string[]): boolean {
  const re = (p: string): RegExp => new RegExp(p, 'i');
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="option"]'));
  const hit = items.find((it) => patterns.some((p) => re(p).test(norm(it.textContent))));
  if (hit) {
    hit.click();
    return true;
  }
  // 沒找到就關閉選單
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return false;
}

/**
 * 展開最新 N 篇貼文的「查看更多」、留言排序、「查看更多留言」與「查看回覆」。
 * 每篇貼文的展開次數有上限，避免無限迴圈。
 */
export async function expandPosts(page: Page, catalog: SelectorCatalog, target: TargetConfig, opts: { waitMs?: number; maxRounds?: number } = {}): Promise<ExpandStats> {
  const waitMs = opts.waitMs ?? 700;
  const maxRounds = opts.maxRounds ?? 8;
  const stats: ExpandStats = { seeMoreClicks: 0, commentExpanderClicks: 0, sortSwitched: false, limitReached: false, rounds: 0 };
  const base = {
    articleSelector: catalog.articleSelector,
    feedSelectors: catalog.feedSelectors,
    mainSelectors: catalog.mainSelectors,
    maxPosts: target.scan_latest_posts,
  };

  // 1) 貼文全文
  if (target.expand_see_more) {
    let counts: Record<string, number> = {};
    for (let r = 0; r < 3; r++) {
      const res = await page.evaluate(clickButtonsInPage, { ...base, patterns: catalog.seeMorePatterns, maxClicks: 40, perPostLimit: 3, perPostCounts: counts }).catch(() => ({ clicked: 0, perPostCounts: counts, remaining: 0 }));
      counts = res.perPostCounts;
      stats.seeMoreClicks += res.clicked;
      if (res.clicked === 0) break;
      await sleep(waitMs);
    }
  }

  if (!target.detect_comments || target.max_comment_expansions_per_post === 0) return stats;

  // 2) 留言排序（盡力而為，只針對第一篇可切換的貼文開一次選單，失敗不影響後續）
  if (target.preferred_comment_sort !== 'none') {
    try {
      const opened = await page.evaluate(clickCommentSortButtons, { ...base, buttonPatterns: catalog.commentSortButtonPatterns });
      if (opened > 0) {
        await sleep(600);
        const patterns = target.preferred_comment_sort === 'all' ? catalog.commentSortMenuItemPatterns.all : catalog.commentSortMenuItemPatterns.newest;
        stats.sortSwitched = await page.evaluate(clickMenuItem, patterns);
        await sleep(waitMs);
      }
    } catch {
      /* ignore */
    }
  }

  // 3) 更多留言與回覆
  let counts: Record<string, number> = {};
  const patterns = [...catalog.viewMoreCommentsPatterns, ...(target.detect_replies ? catalog.viewRepliesPatterns : [])];
  for (let r = 0; r < maxRounds; r++) {
    stats.rounds++;
    const res = await page
      .evaluate(clickButtonsInPage, { ...base, patterns, maxClicks: 25, perPostLimit: target.max_comment_expansions_per_post, perPostCounts: counts })
      .catch(() => ({ clicked: 0, perPostCounts: counts, remaining: 0 }));
    counts = res.perPostCounts;
    stats.commentExpanderClicks += res.clicked;
    if (res.remaining > 0 && res.clicked === 0) stats.limitReached = true;
    if (res.clicked === 0) break;
    await sleep(waitMs);
  }
  return stats;
}
