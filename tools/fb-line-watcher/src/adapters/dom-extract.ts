import type { ExtractArg, ExtractResult, RawComment, RawMedia, RawPost } from './types.js';

/**
 * 在瀏覽器頁面內執行的抽取函式。
 *
 * 重要：這個函式會被 Playwright 序列化後送進頁面執行，因此不能引用任何模組層級的變數或 import，
 * 所有輔助函式都必須定義在函式內部。
 */
export function extractInPage(arg: ExtractArg): ExtractResult {
  const c = arg.catalog;
  const MARK = arg.markAttr;
  const notes: string[] = [];

  const re = (p: string): RegExp => new RegExp(p, 'i');
  const anyMatch = (patterns: string[], s: string | null | undefined): boolean => !!s && patterns.some((p) => re(p).test(s));
  const normWs = (s: string | null | undefined): string => (s ?? '').replace(/​|‌|‍|﻿/g, '').replace(/\s+/g, ' ').trim();
  const lines = (s: string | null | undefined): string[] =>
    (s ?? '')
      .split(/\r?\n/)
      .map((l) => normWs(l))
      .filter((l) => l.length > 0);

  const roots = c.feedSelectors.map((s) => document.querySelector(s)).filter((x): x is Element => x !== null);
  const feedFound = roots.length > 0;
  const scope: Element = roots[0] ?? c.mainSelectors.map((s) => document.querySelector(s)).find((x): x is Element => x !== null) ?? document.body;
  const allArticles = Array.from(scope.querySelectorAll<HTMLElement>(c.articleSelector));
  const topLevel = allArticles.filter((a) => !a.parentElement?.closest(c.articleSelector));

  // 目前的貼文排序標籤（診斷用）
  let sortLabel: string | undefined;
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('[role="button"], [role="combobox"]'))) {
    const t = normWs(b.textContent);
    if (/^(最新貼文|最相關|熱門貼文|Most relevant|New posts|Newest|Top posts|Recent activity|最近動態)$/i.test(t)) {
      sortLabel = t;
      break;
    }
  }

  /** el 是否位於 root 的「自有區域」（不在巢狀 article 裡） */
  const inOwnRegion = (el: Element, root: Element): boolean => el.closest(c.articleSelector) === root;

  const normalizePermalink = (href: string, kind: 'post' | 'comment'): string | undefined => {
    try {
      const u = new URL(href, location.origin);
      if (!/facebook\.com$|^localhost$|^127\.0\.0\.1$/i.test(u.hostname)) return undefined;
      const keep = kind === 'post' ? ['story_fbid', 'id', 'fbid', 'set', 'v'] : ['story_fbid', 'id', 'fbid', 'v', 'comment_id', 'reply_comment_id'];
      const params = new URLSearchParams();
      for (const k of keep) {
        const v = u.searchParams.get(k);
        if (v) params.set(k, v);
      }
      const q = params.toString();
      const host = /facebook\.com$/i.test(u.hostname) ? 'www.facebook.com' : u.host;
      return `${u.protocol}//${host}${u.pathname.replace(/\/$/, '')}${q ? `?${q}` : ''}`;
    } catch {
      return undefined;
    }
  };

  const mediaFingerprint = (src: string): string => {
    try {
      const u = new URL(src, location.origin);
      const file = u.pathname.split('/').filter(Boolean).pop() ?? u.pathname;
      const base = file.replace(/\.[a-z0-9]+$/i, '');
      const m = /(\d{5,}_\d+_\d+)/.exec(base);
      return m?.[1] ?? `${u.hostname}${u.pathname}`;
    } catch {
      return src.slice(0, 200);
    }
  };

  const extractMedia = (root: Element): RawMedia[] => {
    const out: RawMedia[] = [];
    const seen = new Set<string>();
    for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
      if (!inOwnRegion(img, root)) continue;
      const src = img.currentSrc || img.src || '';
      if (!src || anyMatch(c.mediaSrcIgnorePatterns, src)) continue;
      const w = img.naturalWidth || img.width || img.getBoundingClientRect().width;
      const h = img.naturalHeight || img.height || img.getBoundingClientRect().height;
      if (w < c.avatarMaxSize || h < c.avatarMaxSize) continue;
      const a = img.closest('a');
      const href = a?.getAttribute('href') ?? undefined;
      // 頭像通常是圓形連到個人檔案；貼文圖片連到 /photo
      const isProfileLink = !!href && /\/(user|profile\.php|people)\//.test(href) && !anyMatch(c.mediaHrefPatterns, href);
      if (isProfileLink) continue;
      const fp = mediaFingerprint(src);
      if (seen.has(fp)) continue;
      seen.add(fp);
      out.push({ type: 'image', alt: normWs(img.alt) || undefined, fingerprint: fp, href: href ?? undefined, width: Math.round(w), height: Math.round(h) });
    }
    for (const v of Array.from(root.querySelectorAll<HTMLVideoElement>('video'))) {
      if (!inOwnRegion(v, root)) continue;
      const poster = v.poster || v.currentSrc || v.src || 'video';
      const fp = `video:${mediaFingerprint(poster)}`;
      if (seen.has(fp)) continue;
      seen.add(fp);
      out.push({ type: 'video', fingerprint: fp });
    }
    for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="l.facebook.com/l.php"], a[href^="http"]:not([href*="facebook.com"])'))) {
      if (!inOwnRegion(a, root)) continue;
      let target = a.getAttribute('href') ?? '';
      try {
        const u = new URL(target, location.origin);
        const inner = u.searchParams.get('u');
        if (inner) target = inner;
        const tu = new URL(target);
        const fp = `link:${tu.hostname}${tu.pathname}`.slice(0, 200);
        if (seen.has(fp)) continue;
        seen.add(fp);
        out.push({ type: 'link', fingerprint: fp, href: `${tu.protocol}//${tu.hostname}${tu.pathname}` });
      } catch {
        /* ignore */
      }
    }
    return out;
  };

  const findTime = (root: Element, exclude: Element | null): { label?: string; title?: string; el?: Element } => {
    for (const a of Array.from(root.querySelectorAll<HTMLElement>('a[aria-label], abbr[title], abbr[aria-label]'))) {
      if (!inOwnRegion(a, root) || (exclude && exclude.contains(a))) continue;
      const label = a.getAttribute('aria-label') ?? a.getAttribute('title') ?? '';
      if (anyMatch(c.timeAriaLabelPatterns, label)) {
        return { title: normWs(label), label: normWs(a.textContent) || undefined, el: a };
      }
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('a, span, abbr'))) {
      if (!inOwnRegion(el, root) || (exclude && exclude.contains(el))) continue;
      if (el.children.length > 1) continue;
      const t = normWs(el.textContent);
      if (t.length > 0 && t.length <= 40 && anyMatch(c.timeTextPatterns, t)) {
        const link = el.closest('a');
        return { label: t, title: normWs(link?.getAttribute('aria-label') ?? el.getAttribute('title') ?? '') || undefined, el: link ?? el };
      }
    }
    return {};
  };

  const isInteractiveOrChrome = (el: Element, root: Element): boolean => {
    let cur: Element | null = el;
    while (cur && cur !== root) {
      const role = cur.getAttribute('role');
      if (role === 'button' || role === 'toolbar' || role === 'textbox' || role === 'menu' || role === 'form') return true;
      const tag = cur.tagName.toLowerCase();
      if (tag === 'form' || tag === 'button' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5') return true;
      if ((cur as HTMLElement).isContentEditable) return true;
      cur = cur.parentElement;
    }
    return false;
  };

  const collectText = (root: Element, opts: { excludeEls: (Element | null | undefined)[]; excludeMessage?: boolean }): string => {
    const excl = opts.excludeEls.filter((x): x is Element => !!x);
    // 1) 官方 message 容器
    const msgEls = c.messageSelectors.flatMap((s) => Array.from(root.querySelectorAll<HTMLElement>(s))).filter((el) => inOwnRegion(el, root));
    if (msgEls.length > 0 && !opts.excludeMessage) {
      const parts: string[] = [];
      for (const el of msgEls) parts.push(...lines(el.innerText));
      return dedupeLines(parts).join('\n');
    }
    // 2) fallback：自有區域中的 dir=auto 文字節點
    const parts: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('div[dir="auto"], span[dir="auto"], p'))) {
      if (!inOwnRegion(el, root)) continue;
      if (excl.some((x) => x.contains(el) || el.contains(x))) continue;
      if (isInteractiveOrChrome(el, root)) continue;
      if (el.querySelector('div[dir="auto"], span[dir="auto"], p')) continue; // 只取葉節點，避免重複
      if (el.closest('a') && normWs(el.textContent).length < 40) continue; // 名稱／時間連結
      parts.push(...lines(el.innerText));
    }
    return dedupeLines(parts).join('\n');
  };

  const dedupeLines = (arr: string[]): string[] => {
    const out: string[] = [];
    for (const l of arr) {
      if (out.length && out[out.length - 1] === l) continue;
      if (anyMatch(c.uiNoisePatterns, l)) continue;
      out.push(l);
    }
    return out;
  };

  const findAuthor = (root: Element, exclude: (Element | undefined)[]): { name?: string; el?: Element } => {
    const labelledBy = root.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const el = document.getElementById(id);
        if (el && root.contains(el)) {
          const t = normWs(el.textContent).split(/\s+[·›>]\s+|\s*›\s*/)[0] ?? '';
          if (t && t.length <= 80) return { name: t, el };
        }
      }
    }
    for (const h of Array.from(root.querySelectorAll<HTMLElement>('h2, h3, h4, h5'))) {
      if (!inOwnRegion(h, root)) continue;
      const a = h.querySelector('a');
      const t = normWs((a ?? h).textContent).split(/\s+[·›>]\s+|\s*›\s*/)[0] ?? '';
      if (t && t.length <= 80) return { name: t, el: h };
    }
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('strong, a[role="link"] > span, a[role="link"]'))) {
      if (!inOwnRegion(s, root)) continue;
      if (exclude.some((x) => x && (x.contains(s) || s.contains(x)))) continue;
      const t = normWs(s.textContent);
      if (t && t.length <= 60 && !anyMatch(c.timeTextPatterns, t) && !anyMatch(c.uiNoisePatterns, t)) return { name: t, el: s };
    }
    return {};
  };

  const findPermalink = (root: Element, patterns: string[], kind: 'post' | 'comment', exclude?: Element | null): string | undefined => {
    for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (!inOwnRegion(a, root)) continue;
      if (exclude && exclude.contains(a)) continue;
      const href = a.getAttribute('href') ?? '';
      if (anyMatch(patterns, href)) {
        const n = normalizePermalink(href, kind);
        if (n) return n;
      }
    }
    return undefined;
  };

  const countExpanders = (root: Element): number => {
    let n = 0;
    for (const b of Array.from(root.querySelectorAll<HTMLElement>('[role="button"]'))) {
      const t = normWs(b.textContent);
      if (anyMatch(c.viewMoreCommentsPatterns, t) || anyMatch(c.viewRepliesPatterns, t) || anyMatch(c.seeMorePatterns, t)) n++;
    }
    return n;
  };

  const extractComment = (cm: HTMLElement, post: HTMLElement, idx: number, byEl: Map<Element, string>, firstCommentLeft: number | null): RawComment => {
    const markId = `c${idx}`;
    cm.setAttribute(MARK, markId);
    byEl.set(cm, markId);
    const flags: string[] = [];
    let depth = 0;
    let cur: Element | null = cm.parentElement;
    let parentArticle: Element | null = null;
    while (cur && cur !== post) {
      if (cur.matches(c.articleSelector)) {
        depth++;
        if (!parentArticle) parentArticle = cur;
      }
      cur = cur.parentElement;
    }
    depth += 1;
    const ariaLabel = normWs(cm.getAttribute('aria-label') ?? '') || undefined;
    const permalink = findPermalink(cm, c.commentPermalinkPatterns, 'comment');
    const time = findTime(cm, null);
    const author = findAuthor(cm, [time.el]);
    const text = collectText(cm, { excludeEls: [author.el, time.el] });
    const media = extractMedia(cm);
    const left = cm.getBoundingClientRect().left;
    const indented = firstCommentLeft !== null && left - firstCommentLeft >= 24;
    const isReply =
      depth >= 2 ||
      (!!permalink && anyMatch(c.replyPermalinkPatterns, permalink)) ||
      (!!ariaLabel && anyMatch(c.replyAriaLabelPatterns, ariaLabel) && !anyMatch(['留言', 'Comment by'], ariaLabel)) ||
      indented;
    let parentMarkId: string | null = parentArticle ? (byEl.get(parentArticle) ?? null) : null;
    if (isReply && !parentMarkId) {
      // 找 DOM 順序上最近的前一則非回覆留言
      const prev = Array.from(byEl.entries()).reverse().find(([el]) => el !== cm && el.compareDocumentPosition(cm) & Node.DOCUMENT_POSITION_FOLLOWING && el.getBoundingClientRect().left < left);
      parentMarkId = prev?.[1] ?? null;
    }
    let confidence = 0.4;
    if (author.name) confidence += 0.2;
    else flags.push('no-author');
    if (text || media.length) confidence += 0.2;
    else flags.push('no-content');
    if (permalink) confidence += 0.2;
    else flags.push('no-permalink');
    return {
      markId,
      parentMarkId,
      depth,
      isReply,
      permalink,
      author: author.name,
      timeLabel: time.label,
      timeTitle: time.title,
      ariaLabel,
      text: text.slice(0, c.textLimit),
      media,
      confidence: Math.min(1, confidence),
      flags,
    };
  };

  const extractPost = (art: HTMLElement, index: number): RawPost => {
    const markId = `p${index}`;
    art.setAttribute(MARK, markId);
    const flags: string[] = [];
    const nested = Array.from(art.querySelectorAll<HTMLElement>(c.articleSelector));
    const permalink = findPermalink(art, c.permalinkHrefPatterns, 'post');
    const time = findTime(art, null);
    const author = findAuthor(art, [time.el]);
    const text = collectText(art, { excludeEls: [author.el, time.el] });
    const media = extractMedia(art);
    const ownText = lines(
      Array.from(art.querySelectorAll<HTMLElement>('span, div'))
        .filter((el) => inOwnRegion(el, art) && el.children.length === 0)
        .map((el) => el.textContent ?? '')
        .join('\n'),
    );
    const headerText = ownText.slice(0, 12).join('\n');
    const edited = anyMatch(c.editedPatterns, headerText);
    const sponsored = ownText.slice(0, 15).some((l) => anyMatch(c.sponsoredPatterns, l));
    const visibleCommentCountText = ownText.find((l) => /^[\d,.]+[萬KM]?\s*(則留言|comments?)$/i.test(l) || /^(\d+)\s*則留言$/.test(l));
    const reactionText = ownText.find((l) => /^全部心情[:：]?\s*[\d,.]+[萬KM]?$/.test(l) || /^[\d,.]+[萬KM]?\s*(reactions?|個人|人)$/i.test(l));

    const byEl = new Map<Element, string>();
    const comments: RawComment[] = [];
    let firstLeft: number | null = null;
    nested.forEach((cm, i) => {
      if (firstLeft === null) firstLeft = cm.getBoundingClientRect().left;
      comments.push(extractComment(cm, art, i, byEl, firstLeft));
    });

    let confidence = 0.3;
    if (permalink) confidence += 0.25;
    else flags.push('no-permalink');
    if (author.name) confidence += 0.2;
    else flags.push('no-author');
    if (time.label || time.title) confidence += 0.1;
    else flags.push('no-time');
    if (text || media.length) confidence += 0.15;
    else flags.push('no-content');

    return {
      markId,
      index,
      permalink,
      author: author.name,
      timeLabel: time.label,
      timeTitle: time.title,
      edited,
      sponsored,
      text: text.slice(0, c.textLimit),
      media,
      comments,
      visibleCommentCountText,
      reactionText,
      remainingExpanders: countExpanders(art),
      confidence: Math.min(1, confidence),
      flags,
    };
  };

  const posts: RawPost[] = [];
  let index = 0;
  for (const art of topLevel) {
    if (posts.length >= arg.maxPosts) break;
    try {
      const p = extractPost(art, index++);
      if (p.sponsored && arg.skipSponsored) {
        notes.push(`skip-sponsored:${p.markId}`);
        continue;
      }
      posts.push(p);
    } catch (e) {
      notes.push(`post-error:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!feedFound) notes.push('feed-not-found');
  return {
    posts,
    diagnostics: {
      url: location.href,
      title: document.title,
      feedFound,
      topLevelArticles: topLevel.length,
      nestedArticles: allArticles.length - topLevel.length,
      sortLabel,
      notes,
    },
  };
}
