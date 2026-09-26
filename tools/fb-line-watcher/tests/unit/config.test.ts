import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfigObject, validateSecrets } from '../../src/config/load.js';
import { mergeCatalog, withGroupSort, DEFAULT_CATALOG } from '../../src/adapters/catalog.js';

const minimal = { targets: [{ key: 'a', name: 'A', type: 'facebook_page', url: 'https://www.facebook.com/somepage' }] };

describe('config schema', () => {
  it('最小設定會補齊預設值', () => {
    const c = parseConfigObject(minimal);
    expect(c.poll_interval_seconds).toBe(180);
    expect(c.browser.viewport.width).toBe(1440);
    expect(c.images.publisher).toBe('none');
    expect(c.targets[0]?.scan_latest_posts).toBe(8);
    expect(c.targets[0]?.notify_event_types).toHaveLength(4);
    expect(c.line.retry_schedule_seconds.length).toBeGreaterThan(2);
  });
  it('錯誤設定 fail fast，訊息含路徑', () => {
    expect(() => parseConfigObject({ targets: [] })).toThrow(ConfigError);
    expect(() => parseConfigObject({ targets: [{ key: 'a', name: 'A', type: 'facebook_group', url: 'https://www.facebook.com/notgroup' }] })).toThrow(/groups/);
    expect(() => parseConfigObject({ targets: [{ key: 'a', name: 'A', type: 'facebook_page', url: 'https://example.com/x' }] })).toThrow(/facebook\.com/);
    expect(() => parseConfigObject({ targets: [minimal.targets[0], minimal.targets[0]] })).toThrow(/重複/);
    expect(() => parseConfigObject({ ...minimal, poll_interval_seconds: 1 })).toThrow(/poll_interval_seconds/);
  });
  it('缺少 LINE 秘密時列出環境變數名稱', () => {
    const c = parseConfigObject(minimal);
    expect(() => validateSecrets(c, {}, { requireLine: true })).toThrow(/LINE_CHANNEL_ACCESS_TOKEN[\s\S]*LINE_DESTINATION_ID/);
    expect(() => validateSecrets(c, { lineAccessToken: 't', lineDestinationId: 'Uabc' }, { requireLine: true })).toThrow(/C 開頭/);
    expect(() => validateSecrets(c, { lineAccessToken: 't', lineDestinationId: `C${'0'.repeat(32)}` }, { requireLine: true })).not.toThrow();
  });
  // 回歸（P2）：/facebook\.com$/ 沒有 hostname 邊界，notfacebook.com 會被當成 Facebook
  it('facebook 網域檢查有主機名邊界，不接受相似網域', () => {
    const t = (url: string): unknown => parseConfigObject({ targets: [{ key: 'a', name: 'A', type: 'facebook_page', url }] });
    for (const ok of ['https://www.facebook.com/somepage', 'https://facebook.com/somepage', 'https://m.facebook.com/somepage', 'https://web.facebook.com/somepage']) {
      expect(() => t(ok)).not.toThrow();
    }
    for (const bad of [
      'https://notfacebook.com/somepage',
      'https://evilfacebook.com/somepage',
      'https://facebook.com.evil.tld/somepage',
      'https://facebook.co/somepage',
      'https://xfacebook.com/somepage',
      'https://evil.tld/www.facebook.com/somepage',
    ]) {
      expect(() => t(bad), bad).toThrow(/facebook\.com/);
    }
  });

  it('社團網址同樣要在真正的 facebook.com 底下', () => {
    expect(() => parseConfigObject({ targets: [{ key: 'a', name: 'A', type: 'facebook_group', url: 'https://notfacebook.com/groups/123' }] })).toThrow(/facebook\.com/);
    expect(() => parseConfigObject({ targets: [{ key: 'a', name: 'A', type: 'facebook_group', url: 'https://www.facebook.com/groups/123' }] })).not.toThrow();
  });

  it('圖片主機需 https', () => {
    const c = parseConfigObject({ ...minimal, images: { publisher: 'local_http' } });
    expect(() => validateSecrets(c, { publicBaseUrl: 'http://x' }, { requireImages: true })).toThrow(/https/);
  });
});

describe('selector catalog', () => {
  it('可覆寫欄位並拒絕未知欄位', () => {
    const m = mergeCatalog({ seeMorePatterns: ['^更多$'] });
    expect(m.seeMorePatterns).toEqual(['^更多$']);
    expect(m.articleSelector).toBe(DEFAULT_CATALOG.articleSelector);
    expect(() => mergeCatalog({ nope: 1 })).toThrow(/未知欄位/);
    expect(() => mergeCatalog({ seeMorePatterns: 'x' })).toThrow(/型別/);
  });
  it('社團網址加上排序參數', () => {
    expect(withGroupSort('https://www.facebook.com/groups/123', 'newest', DEFAULT_CATALOG)).toBe('https://www.facebook.com/groups/123?sorting_setting=CHRONOLOGICAL');
    expect(withGroupSort('https://www.facebook.com/groups/123', 'default', DEFAULT_CATALOG)).toBe('https://www.facebook.com/groups/123');
  });
});
