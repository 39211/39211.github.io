import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { setupHarness, saveSample, type Harness } from './harness.js';
import { listRecentEvents, countEntities } from '../../src/storage/repo.js';

describe('粉專：baseline → 新貼文 → 去重 → 編輯', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['page'] });
  });
  afterAll(async () => {
    await h.close();
  });

  it('首次巡邏只建立 baseline，不通知既有的 3 篇貼文與 9 則留言', async () => {
    const s = await h.cycle();
    const r = s.results[0]!;
    expect(r.status).toBe('READY');
    expect(r.baselineMode).toBe(true);
    expect(r.scan?.posts).toBe(3);
    expect(r.scan?.comments).toBe(9);
    expect(r.scan?.avgConfidence).toBeGreaterThanOrEqual(0.95);
    expect(h.line.accepted).toHaveLength(0);
    expect(countEntities(h.app.db, 'page', 'post')).toBe(3);
    expect(countEntities(h.app.db, 'page', 'comment')).toBe(6);
    expect(countEntities(h.app.db, 'page', 'reply')).toBe(3);
  });

  it('無變化時連續巡邏零通知', async () => {
    for (let i = 0; i < 3; i++) {
      const s = await h.cycle();
      expect(s.results[0]?.baselineMode).toBe(false);
      expect(s.results[0]?.eventsCreated).toBe(0);
    }
    expect(h.line.accepted).toHaveLength(0);
  });

  it('新增圖片貼文 → 兩個巡邏週期內一則通知，含截圖與 sidecar', async () => {
    await h.fixture.control('page', 'add-post', { text: '新到貨！本週洗鞋加購除臭只要 99 元，歡迎私訊預約。', images: 1 });
    const s = await h.cycle();
    expect(s.results[0]?.stats?.newPosts).toBe(1);
    expect(s.deliveries.sent).toBe(1);
    expect(h.line.accepted).toHaveLength(1);
    const msgs = h.line.accepted[0]!.body.messages!;
    expect(msgs).toHaveLength(1); // publisher=none → 只有文字
    expect(msgs[0]!.text).toContain('【Facebook 新貼文】');
    expect(msgs[0]!.text).toContain('來源：阿爸洗鞋店');
    expect(msgs[0]!.text).toContain('作者：阿爸洗鞋店');
    expect(msgs[0]!.text).toContain('圖片 1 張');
    expect(msgs[0]!.text).toContain('新到貨');
    expect(msgs[0]!.text).toMatch(/fixture-page\/posts\//);
    const ev = listRecentEvents(h.app.db, 1)[0]!;
    expect(ev.event_type).toBe('NEW_POST');
    expect(ev.status).toBe('SENT');
    expect(existsSync(ev.screenshot_path!)).toBe(true);
    expect(existsSync(ev.preview_path!)).toBe(true);
    const sidecar = JSON.parse(readFileSync(ev.screenshot_path!.replace(/_context\.jpg$/, '.json'), 'utf8'));
    expect(sidecar.eventKey).toBe(ev.event_key);
    expect(sidecar.payload.imageCount).toBe(1);
    saveSample('01_new_post_with_image.jpg', ev.screenshot_path);
  });

  it('同一畫面重新巡邏 20 次不重複通知', async () => {
    for (let i = 0; i < 20; i++) {
      const s = await h.cycle();
      expect(s.results[0]?.eventsCreated).toBe(0);
    }
    expect(h.line.accepted).toHaveLength(1);
  });

  it('相對時間、反應數與貼文排序改變不通知', async () => {
    await h.fixture.control('page', 'tick', { minutes: 7 });
    await h.fixture.control('page', 'bump-reactions', { by: 5 });
    await h.fixture.control('page', 'shuffle');
    const s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(0);
    expect(s.results[0]?.stats?.newPosts).toBe(0);
    expect(s.results[0]?.stats?.editedPosts).toBe(0);
    expect(h.line.accepted).toHaveLength(1);
    await h.fixture.control('page', 'shuffle');
  });

  it('貼文編輯 → EDITED_POST，帶原文摘要', async () => {
    const state = await h.fixture.control<{ posts: { id: number; text: string }[] }>('page', 'state');
    const target = state.posts.find((p) => p.text.includes('新到貨'))!;
    await h.fixture.control('page', 'edit-post', { id: target.id, text: '新到貨！本週洗鞋加購除臭只要 79 元（更正價格），歡迎私訊預約。' });
    const s = await h.cycle();
    expect(s.results[0]?.stats?.editedPosts).toBe(1);
    expect(h.line.accepted).toHaveLength(2);
    const text = h.line.accepted[1]!.body.messages![0]!.text!;
    expect(text).toContain('【Facebook 貼文已編輯】');
    expect(text).toContain('原文摘要');
    expect(text).toContain('79 元');
    saveSample('02_edited_post.jpg', listRecentEvents(h.app.db, 1)[0]?.screenshot_path);
  });

  it('長文會先點「查看更多」再比對，全文進入摘要來源', async () => {
    const long = `${'這是一段很長的公告內容，說明本店中秋連假的營業時間與注意事項。'.repeat(8)}結尾句。`;
    await h.fixture.control('page', 'add-post', { text: long, long: true });
    const s = await h.cycle();
    expect(s.results[0]?.stats?.newPosts).toBe(1);
    expect(s.results[0]?.scan?.expand?.seeMoreClicks).toBeGreaterThanOrEqual(1);
    const ev = listRecentEvents(h.app.db, 1)[0]!;
    const payload = JSON.parse(ev.payload_json) as { text: string };
    expect(payload.text).toContain('結尾句');
    expect(payload.text.length).toBeGreaterThan(200);
    expect(h.line.accepted).toHaveLength(3);
  });

  it('贊助內容被略過', async () => {
    await h.fixture.control('page', 'add-post', { text: '贊助廣告內容', sponsored: true });
    const s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(0);
    expect(h.line.accepted).toHaveLength(3);
  });
});
