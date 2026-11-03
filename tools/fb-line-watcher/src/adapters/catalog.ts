/**
 * Selector Catalog：所有用來辨識 Facebook 畫面的 role／aria／文字／URL 規則都集中在這裡，
 * 並且可以由 targets.yaml 的 adapter_overrides 逐欄覆寫。
 *
 * 原則（依優先順序）：role／accessible name → aria-label → 可見文字（zh-TW + 英文 fallback）
 * → permalink URL pattern → 相對 DOM 結構。絕不依賴 Facebook 隨機產生的 class name。
 *
 * 所有 *Patterns 欄位都是「正規表達式來源字串」，會在瀏覽器內以 new RegExp(p, 'i') 建立。
 */
export interface SelectorCatalog {
  version: string;
  feedSelectors: string[];
  mainSelectors: string[];
  articleSelector: string;
  postPosinsetAttr: string;
  permalinkHrefPatterns: string[];
  commentPermalinkPatterns: string[];
  replyPermalinkPatterns: string[];
  commentAriaLabelPatterns: string[];
  replyAriaLabelPatterns: string[];
  messageSelectors: string[];
  timeAriaLabelPatterns: string[];
  timeTextPatterns: string[];
  editedPatterns: string[];
  sponsoredPatterns: string[];
  seeMorePatterns: string[];
  viewMoreCommentsPatterns: string[];
  viewRepliesPatterns: string[];
  commentSortButtonPatterns: string[];
  commentSortMenuItemPatterns: { all: string[]; newest: string[] };
  uiNoisePatterns: string[];
  avatarMaxSize: number;
  mediaHrefPatterns: string[];
  mediaSrcIgnorePatterns: string[];
  loginUrlPatterns: string[];
  loginSelectors: string[];
  loginTextPatterns: string[];
  checkpointUrlPatterns: string[];
  checkpointTextPatterns: string[];
  permissionTextPatterns: string[];
  joinGroupButtonPatterns: string[];
  hideForCaptureSelectors: string[];
  stabilizeCss: string;
  groupSortParam: { newest: string; recent_activity: string };
  textLimit: number;
}

export const ADAPTER_VERSION = 'fb-web-2026.09-v1';

export const DEFAULT_CATALOG: SelectorCatalog = {
  version: ADAPTER_VERSION,
  feedSelectors: ['div[role="feed"]'],
  mainSelectors: ['div[role="main"]', 'main'],
  articleSelector: 'div[role="article"]',
  postPosinsetAttr: 'aria-posinset',
  permalinkHrefPatterns: [
    '/posts/[A-Za-z0-9]',
    '/permalink/\\d+',
    '/permalink\\.php\\?story_fbid=',
    '/story\\.php\\?story_fbid=',
    '/groups/[^/]+/posts/\\d+',
    '/photo/?\\?fbid=\\d+',
    '/photo\\.php\\?fbid=\\d+',
    '/photos/[a-z.]+/\\d+',
    '/videos/\\d+',
    '/reel/\\d+',
    '/watch/?\\?v=\\d+',
  ],
  commentPermalinkPatterns: ['[?&]comment_id=\\d+'],
  replyPermalinkPatterns: ['[?&]reply_comment_id=\\d+'],
  commentAriaLabelPatterns: ['留言', 'Comment by', '回覆', 'Reply by'],
  replyAriaLabelPatterns: ['回覆', 'Reply by'],
  messageSelectors: [
    'div[data-ad-preview="message"]',
    'div[data-ad-comet-preview="message"]',
    'div[data-ad-rendering-role="story_message"]',
  ],
  timeAriaLabelPatterns: ['\\d{4}\\s*年', '\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日', '(上午|下午)\\s*\\d{1,2}:\\d{2}', '\\d{1,2}:\\d{2}\\s*(AM|PM)', '^[A-Z][a-z]+ \\d{1,2}, \\d{4}'],
  timeTextPatterns: [
    '^\\d+\\s*(秒|分鐘|小時|天|週|年)$',
    '^\\d+\\s*(秒|分鐘|小時|天|週|年)前?$',
    '^\\d+\\s*(s|m|h|d|w|y)$',
    '^\\d+ (second|minute|hour|day|week|year)s? ago$',
    '^(剛剛|Just now)$',
    '^(昨天|Yesterday)',
    '^\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日',
    '^\\d{4}\\s*年\\s*\\d{1,2}\\s*月',
    '^[A-Z][a-z]+ \\d{1,2}(, \\d{4})?( at .*)?$',
  ],
  editedPatterns: ['已編輯', '編輯過', '\\bEdited\\b'],
  sponsoredPatterns: ['^贊助$', '^Sponsored$', '贊助內容'],
  seeMorePatterns: ['^查看更多$', '^顯示更多$', '^See more$', '^See More$', '^更多$'],
  viewMoreCommentsPatterns: [
    '查看更多留言',
    '查看其他留言',
    '查看先前留言',
    '查看更多則留言',
    '查看全部\\s*\\d*\\s*則留言',
    'View more comments',
    'View previous comments',
    'View \\d+ more comments?',
    'View all \\d+ comments',
  ],
  viewRepliesPatterns: [
    '^查看(全部)?\\s*\\d+\\s*則回覆$',
    '^查看\\s*\\d+\\s*則回覆$',
    '^查看回覆$',
    '^查看更多回覆$',
    '^\\d+\\s*則回覆$',
    '^View (all )?\\d+ repl(y|ies)$',
    '^\\d+ repl(y|ies)$',
    '^View more replies$',
    '^Show \\d+ repl(y|ies)$',
  ],
  commentSortButtonPatterns: ['^最相關$', '^最新$', '^所有留言$', '^Most relevant$', '^Newest$', '^All comments$', '^Top comments$'],
  commentSortMenuItemPatterns: {
    all: ['所有留言', 'All comments'],
    newest: ['最新', 'Newest'],
  },
  uiNoisePatterns: [
    '^(讚|回覆|分享|留言|追蹤|Like|Reply|Share|Comment|Follow|Send|傳送)$',
    '^(查看更多|顯示更多|See more|See More|更多)$',
    '^(查看翻譯|See translation|隱藏翻譯|Hide translation)$',
    '^(已編輯|編輯過|Edited)$',
    '^\\d+\\s*(秒|分鐘|小時|天|週|年)前?$',
    '^\\d+\\s*[smhdwy]$',
    '^·$',
    '^全部心情[:：]?\\s*[\\d,.]+[萬KM]?$',
    '^[\\d,.]+[萬KM]?\\s*(則留言|次分享|人|comments?|shares?|views?)$',
  ],
  avatarMaxSize: 60,
  mediaHrefPatterns: ['/photo', '/photos/', '/videos/', '/reel/', '/watch'],
  mediaSrcIgnorePatterns: ['emoji', '/rsrc\\.php/', 'static\\.xx\\.fbcdn\\.net/rsrc', 'data:image/svg'],
  loginUrlPatterns: ['/login', 'login\\.php', '/recover', '/confirmemail', '/two_step_verification', '/device-based/'],
  loginSelectors: ['input[name="pass"]', 'form[action*="login"]', '#login_form', 'input[name="email"][type="text"]'],
  loginTextPatterns: ['登入 Facebook', 'Log in to Facebook', 'Log into Facebook', '登入或註冊 Facebook', '你必須登入才能繼續'],
  checkpointUrlPatterns: ['/checkpoint', '/two_factor', '/auth_platform/codeentry'],
  checkpointTextPatterns: ['安全檢查', 'Security Check', '驗證你的身分', 'Confirm your identity', '確認你的身分', '你的帳號已被鎖定', 'Your account has been locked', '我們暫時停用了你的帳號', '輸入登入驗證碼', 'Enter login code', '請完成此安全驗證'],
  permissionTextPatterns: ['此內容目前無法顯示', "This content isn't available", '這個頁面不存在', "This page isn't available", '你目前無法查看此內容', '此社團為私密社團', 'private group', '你必須加入社團才能', '加入社團以查看'],
  joinGroupButtonPatterns: ['^加入社團$', '^Join group$', '^Join Group$'],
  hideForCaptureSelectors: [
    '[role="banner"]',
    'div[aria-label="聊天室"]',
    'div[aria-label="Chats"]',
    'div[aria-label*="Messenger"]',
    'div[aria-label="新訊息"]',
    'div[aria-label="New message"]',
    'div[role="complementary"]',
  ],
  stabilizeCss: `
*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
video { visibility: hidden !important; }
`,
  groupSortParam: { newest: 'sorting_setting=CHRONOLOGICAL', recent_activity: 'sorting_setting=RECENT_ACTIVITY' },
  textLimit: 4000,
};

/** 以 YAML adapter_overrides 淺層覆寫 catalog；陣列欄位整個取代。 */
export function mergeCatalog(overrides?: Record<string, unknown>): SelectorCatalog {
  if (!overrides) return { ...DEFAULT_CATALOG };
  const merged: Record<string, unknown> = { ...DEFAULT_CATALOG };
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in DEFAULT_CATALOG)) throw new Error(`adapter_overrides 有未知欄位：${k}`);
    const cur = (DEFAULT_CATALOG as unknown as Record<string, unknown>)[k];
    if (k === 'commentSortMenuItemPatterns' || k === 'groupSortParam') {
      merged[k] = { ...(cur as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else if (Array.isArray(cur) !== Array.isArray(v) || typeof cur !== typeof v) {
      throw new Error(`adapter_overrides.${k} 型別不符，應為 ${Array.isArray(cur) ? 'array' : typeof cur}`);
    } else {
      merged[k] = v;
    }
  }
  return merged as unknown as SelectorCatalog;
}

/** 把 group 網址加上排序參數 */
export function withGroupSort(url: string, sort: 'newest' | 'recent_activity' | 'default', catalog: SelectorCatalog): string {
  if (sort === 'default') return url;
  const param = catalog.groupSortParam[sort];
  if (!param) return url;
  const u = new URL(url);
  const [k, v] = param.split('=');
  if (k && v) u.searchParams.set(k, v);
  return u.toString();
}
