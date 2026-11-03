import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, sleep, type Harness } from './harness.js';
import { listRecentEvents } from '../../src/storage/repo.js';
import { parseConfigObject, validateSecrets, ConfigError } from '../../src/config/load.js';
import { ConfigSchema } from '../../src/config/schema.js';

describe('對抗：假 FB／假 LINE 功能矩陣與邊界', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['page', 'group'] });
    await h.cycle();
  });
  afterAll(async () => {
    await h.close();
  });

  it('新貼文／編輯／留言／回覆：涵蓋事件各送一次，安靜重跑 0 誤報', async () => {
    const before = h.line.accepted.length;
    await h.fixture.control('page', 'add-post', { text: '矩陣：新貼文 👟', images: 1 });
    let s = await h.cycle();
    expect(s.results.find((r) => r.targetKey === 'page')?.stats?.newPosts).toBe(1);
    expect(h.line.accepted.length).toBe(before + 1);
    expect(h.line.accepted.at(-1)!.body.messages![0]!.text).toContain('新貼文');

    const state = await h.fixture.control<{ posts: { id: number; text: string }[] }>('page', 'state');
    const target = state.posts.find((p) => p.text.includes('矩陣：新貼文'))!;
    await h.fixture.control('page', 'edit-post', { id: target.id, text: '矩陣：新貼文 👟（已更正）' });
    s = await h.cycle();
    expect(s.results.find((r) => r.targetKey === 'page')?.stats?.editedPosts).toBe(1);
    expect(h.line.accepted.length).toBe(before + 2);
    expect(h.line.accepted.at(-1)!.body.messages![0]!.text).toContain('已編輯');

    const cid = await h.fixture.control<{ id: number }>('page', 'add-comment', { postId: target.id, author: '陳美玲', text: '矩陣留言 👍' });
    s = await h.cycle();
    expect(s.results.find((r) => r.targetKey === 'page')?.stats?.newComments).toBe(1);
    expect(h.line.accepted.length).toBe(before + 3);

    await h.fixture.control('page', 'add-reply', { postId: target.id, commentId: cid.id, author: '王志豪', text: '矩陣回覆 ✨' });
    s = await h.cycle();
    expect(s.results.find((r) => r.targetKey === 'page')?.stats?.newReplies).toBe(1);
    expect(h.line.accepted.length).toBe(before + 4);

    const quiet = await h.cycle();
    expect(quiet.results.every((r) => r.eventsCreated === 0 && r.groupsUpdated === 0)).toBe(true);
    expect(h.line.accepted.length).toBe(before + 4);
  });

  it('unicode／emoji／零寬字元不會誤報或漏報', async () => {
    const before = h.line.accepted.length;
    await h.fixture.control('page', 'add-post', { text: '中秋連假公告 🥮✨「全形：逗號，」cafe\u200b\u200b店' });
    const s = await h.cycle();
    expect(s.results.find((r) => r.targetKey === 'page')?.stats?.newPosts).toBe(1);
    expect(h.line.accepted.length).toBe(before + 1);
    const text = h.line.accepted.at(-1)!.body.messages![0]!.text!;
    expect(text).toContain('🥮');
    const again = await h.cycle();
    expect(again.results.find((r) => r.targetKey === 'page')?.eventsCreated).toBe(0);
    expect(h.line.accepted.length).toBe(before + 1);
  });

  it('快速連續編輯同一則貼文：每一次編輯都要送到，最後一次文字要在最後一則', async () => {
    const before = h.line.accepted.length;
    await h.fixture.control('page', 'add-post', { text: '風暴原文 v0' });
    await h.cycle();
    const state = await h.fixture.control<{ posts: { id: number; text: string }[] }>('page', 'state');
    const id = state.posts.find((p) => p.text.includes('風暴原文'))!.id;
    for (const v of ['v1', 'v2', 'v3']) {
      await h.fixture.control('page', 'edit-post', { id, text: `風暴原文 ${v}` });
      const s = await h.cycle();
      expect(s.results.find((r) => r.targetKey === 'page')?.stats?.editedPosts).toBe(1);
    }
    expect(h.line.accepted.length).toBe(before + 4);
    expect(h.line.accepted.at(-1)!.body.messages![0]!.text).toContain('v3');
  });

  it('LINE 429 之後必須重試成功，不漏報、不重複接受', async () => {
    const before = h.line.accepted.length;
    const attemptsBefore = h.line.attempts.length;
    h.line.failNext(429, 1);
    await h.fixture.control('page', 'add-post', { text: '429 測試貼文' });
    const s = await h.cycle();
    expect(s.results.find((r) => r.targetKey === 'page')?.eventsCreated).toBe(1);
    expect(h.line.accepted.length).toBe(before);
    await sleep(1100);
    const d = await h.deliver();
    expect(d.sent).toBe(1);
    expect(h.line.accepted.length).toBe(before + 1);
    const keys = h.line.attempts.slice(attemptsBefore).map((a) => a.retryKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('publisher=none：只傳文字，截圖仍留本機', async () => {
    expect(h.app.publisher.name).toBe('none');
    await h.fixture.control('page', 'add-post', { text: 'none 發布器貼文', images: 1 });
    await h.cycle();
    const msgs = h.line.accepted.at(-1)!.body.messages!;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.type).toBe('text');
    expect(msgs[0]!.originalContentUrl).toBeUndefined();
    const ev = listRecentEvents(h.app.db, 1)[0]!;
    expect(ev.screenshot_path).toBeTruthy();
  });

  it('時鐘快轉／回撥數小時：既有畫面 0 誤報', async () => {
    const before = h.line.accepted.length;
    h.clock.offsetMs = 3 * 3600 * 1000;
    let s = await h.cycle();
    expect(s.results.every((r) => r.eventsCreated === 0 && r.groupsUpdated === 0)).toBe(true);
    h.clock.offsetMs = -2 * 3600 * 1000;
    s = await h.cycle();
    expect(s.results.every((r) => r.eventsCreated === 0 && r.groupsUpdated === 0)).toBe(true);
    h.clock.offsetMs = 0;
    s = await h.cycle();
    expect(s.results.every((r) => r.eventsCreated === 0 && r.groupsUpdated === 0)).toBe(true);
    expect(h.line.accepted.length).toBe(before);
  });

  it('大量留言：能抓到的都去重；超出展開上限的視為已知限制而非誤報', async () => {
    const state = await h.fixture.control<{ posts: { id: number }[] }>('page', 'state');
    const postId = state.posts[0]!.id;
    const before = h.line.accepted.length;
    for (let i = 0; i < 20; i++) {
      await h.fixture.control('page', 'add-comment', { postId, author: '路人', text: `大量留言 ${i}` });
    }
    const s = await h.cycle();
    const page = s.results.find((r) => r.targetKey === 'page')!;
    expect((page.stats?.newComments ?? 0) + (page.groupsUpdated ?? 0)).toBeGreaterThan(0);
    const quiet = await h.cycle();
    expect(quiet.results.find((r) => r.targetKey === 'page')?.eventsCreated).toBe(0);
    expect(h.line.accepted.length).toBeGreaterThanOrEqual(before);
  });
});

describe('對抗：空 feed 不得當成抽取失敗', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['page'], seedPosts: 0 });
  });
  afterAll(async () => {
    await h.close();
  });

  it('首次巡邏：feed 在、貼文 0 → 建立空 baseline，不降級、不警報、不通知', async () => {
    const s = await h.cycle();
    const r = s.results[0]!;
    expect(r.status).toBe('READY');
    expect(r.mode).not.toBe('DEGRADED_VISUAL_MODE');
    expect(r.eventsCreated).toBe(0);
    expect(h.line.accepted).toHaveLength(0);
    const again = await h.cycle();
    expect(again.results[0]?.status).toBe('READY');
    expect(again.results[0]?.eventsCreated).toBe(0);
    expect(h.line.accepted).toHaveLength(0);
  });

  it('空 baseline 之後出現的第一則貼文要通知（不能被當成首次 baseline 吃掉）', async () => {
    await h.fixture.control('page', 'add-post', { text: '空頁之後的第一則' });
    const s = await h.cycle();
    expect(s.results[0]?.stats?.newPosts).toBe(1);
    expect(h.line.accepted).toHaveLength(1);
    expect(h.line.accepted[0]!.body.messages![0]!.text).toContain('空頁之後的第一則');
  });
});

describe('對抗：空 DOM 不得當新貼文', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['page'] });
    await h.cycle();
  });
  afterAll(async () => {
    await h.close();
  });

  it('空白 HTML：不產生內容事件；恢復後不把舊貼文當新的', async () => {
    const before = h.line.accepted.length;
    await h.fixture.control('page', 'mode', { mode: 'blank' });
    const first = await h.cycle();
    expect(first.results[0]?.eventsCreated).toBe(0);
    expect(['DEGRADED', 'EMPTY', 'NETWORK_ERROR', 'READY']).toContain(first.results[0]?.status);
    const second = await h.cycle();
    expect(second.results[0]?.eventsCreated).toBe(0);
    const content = h.line.accepted.slice(before).filter((a) => {
      const t = a.body.messages?.[0]?.text ?? '';
      return t.includes('新貼文') || t.includes('已編輯') || t.includes('新留言');
    });
    expect(content).toHaveLength(0);
    await h.fixture.control('page', 'mode', { mode: 'normal' });
    const back = await h.cycle();
    expect(back.results[0]?.eventsCreated).toBe(0);
    expect(h.line.accepted.slice(before).filter((a) => (a.body.messages?.[0]?.text ?? '').includes('新貼文'))).toHaveLength(0);
  });
});

describe('對抗：設定 fail-closed', () => {
  const targets = [{ key: 'a', name: 'A', type: 'facebook_page' as const, url: 'https://www.facebook.com/a' }];

  it('trigger.enabled=true 但沒有 token → watch 路徑必須拒絕啟動', () => {
    const c = parseConfigObject({ targets, trigger: { enabled: true } });
    expect(() => validateSecrets(c, {}, { requireTrigger: true })).toThrow(/TRIGGER_TOKEN|trigger/);
    expect(() => validateSecrets(c, { triggerToken: 'short' }, { requireTrigger: true })).toThrow(/太短/);
    expect(() => validateSecrets(c, { triggerToken: 't'.repeat(16) }, { requireTrigger: true })).not.toThrow();
  });

  it('images.publisher 非 none 時拒絕非 https 公開網址', () => {
    const c = parseConfigObject({ targets, images: { publisher: 'local_http' } });
    expect(() => validateSecrets(c, { publicBaseUrl: 'http://127.0.0.1:8787' }, { requireImages: true })).toThrow(/https/);
    expect(() => validateSecrets(c, { publicBaseUrl: 'https://img.example.test' }, { requireImages: true })).not.toThrow();
  });

  it('https 公開網址語法通過、http 與空值拒絕（運行期壞掉的 HTTPS 主機無法在假模式證明）', () => {
    const c = parseConfigObject({ targets, images: { publisher: 'local_http' } });
    expect(() => validateSecrets(c, { publicBaseUrl: 'https://127.0.0.1:1/not-a-real-image-host' }, { requireImages: true })).not.toThrow();
    expect(() => validateSecrets(c, { publicBaseUrl: '' }, { requireImages: true })).toThrow(/https|PUBLIC_BASE_URL|環境/);
  });

  it('壞掉的 target URL 必須是 ConfigError，不得逸出 TypeError', () => {
    for (const url of ['not a url', '', 'http://', 'https://']) {
      const raw = { targets: [{ key: 'a', name: 'A', type: 'facebook_page', url }] };
      let safeThrew = false;
      try {
        const r = ConfigSchema.safeParse(raw);
        expect(r.success).toBe(false);
      } catch {
        safeThrew = true;
      }
      expect(safeThrew, url).toBe(false);
      expect(() => parseConfigObject(raw)).toThrow(ConfigError);
    }
  });
});
