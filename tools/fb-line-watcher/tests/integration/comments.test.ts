import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { setupHarness, saveSample, sleep, type Harness } from './harness.js';
import { listAllPendingGroups, listRecentEvents } from '../../src/storage/repo.js';

describe('社團：留言／回覆偵測與合併通知', () => {
  let h: Harness;
  let postId: number;
  let firstCommentId: number;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['group'], configOverrides: { comment_debounce_seconds: 2 } });
    const state = await h.fixture.control<{ posts: { id: number; comments: { id: number }[] }[] }>('group', 'state');
    postId = state.posts[0]!.id;
    firstCommentId = state.posts[0]!.comments[0]!.id;
  });
  afterAll(async () => {
    await h.close();
  });

  it('baseline：社團以最新貼文排序、留言排序切換為所有留言、回覆已展開', async () => {
    const s = await h.cycle();
    const r = s.results[0]!;
    expect(r.status).toBe('READY');
    expect(r.baselineMode).toBe(true);
    expect(r.scan?.posts).toBe(3);
    expect(r.scan?.comments).toBe(9);
    expect(r.scan?.expand?.sortSwitched).toBe(true);
    const health = h.app.db.get<{ diagnostics_json: string }>('SELECT diagnostics_json FROM extractor_health ORDER BY id DESC LIMIT 1')!;
    const diag = JSON.parse(health.diagnostics_json) as { sortLabel?: string; url: string };
    expect(diag.url).toContain('sorting_setting=CHRONOLOGICAL');
    expect(diag.sortLabel).toBe('最新貼文');
    expect(h.line.accepted).toHaveLength(0);
  });

  it('新增 2 則留言（其中 1 則藏在「查看更多留言」）與 1 則回覆 → 等待合併後只發一則，截圖存在', async () => {
    await h.fixture.control('group', 'add-comment', { postId, author: '林大明', text: '群主公告：這週六下午聚會，記得帶鞋來！電話 0912-345-678' });
    await h.fixture.control('group', 'add-comment', { postId, author: '陳美玲', text: '收到，我會帶兩雙', hidden: true });
    await h.fixture.control('group', 'add-reply', { postId, commentId: firstCommentId, author: '林大明', text: '回覆：營業時間 10:00–20:00' });
    let s = await h.cycle();
    expect(s.results[0]?.stats?.newComments).toBe(2);
    expect(s.results[0]?.stats?.newReplies).toBe(1);
    expect(s.results[0]?.groupsUpdated).toBe(1);
    expect(s.results[0]?.scan?.expand?.commentExpanderClicks).toBeGreaterThanOrEqual(1);
    expect(h.line.accepted).toHaveLength(0);
    const groups = listAllPendingGroups(h.app.db);
    expect(groups).toHaveLength(1);
    expect(existsSync(groups[0]!.screenshot_path!)).toBe(true);
    await sleep(2200);
    s = await h.cycle();
    expect(s.flushedGroups).toBe(1);
    expect(s.results[0]?.eventsCreated).toBe(0);
    expect(h.line.accepted).toHaveLength(1);
    const text = h.line.accepted[0]!.body.messages![0]!.text!;
    expect(text).toContain('【Facebook 社團有新對話】');
    expect(text).toContain('新增留言 2 則、回覆 1 則');
    expect(text).toContain('林大明');
    expect(text).not.toContain('0912-345-678'); // 電話遮罩
    expect(text).toContain('[電話已遮蔽]');
    expect(text).toContain('完整性：COMPLETE_VISIBLE_SET');
    const ev = listRecentEvents(h.app.db, 1)[0]!;
    expect(ev.event_type).toBe('NEW_COMMENTS');
    saveSample('03_group_new_comments_and_reply.jpg', ev.screenshot_path);
  });

  it('debounce 期間陸續出現的留言合併成同一則通知', async () => {
    await h.fixture.control('group', 'add-comment', { postId, author: '王志豪', text: '第一則追加' });
    let s = await h.cycle();
    expect(s.results[0]?.groupsUpdated).toBe(1);
    await h.fixture.control('group', 'add-comment', { postId, author: '王志豪', text: '第二則追加' });
    await h.fixture.control('group', 'add-comment', { postId, author: '林大明', text: '第三則追加' });
    s = await h.cycle();
    expect(s.results[0]?.groupsUpdated).toBe(1);
    expect(listAllPendingGroups(h.app.db)).toHaveLength(1);
    expect(h.line.accepted).toHaveLength(1);
    await sleep(2200);
    s = await h.cycle();
    expect(s.flushedGroups).toBe(1);
    expect(h.line.accepted).toHaveLength(2);
    expect(h.line.accepted[1]!.body.messages![0]!.text).toContain('新增留言 3 則');
  });

  it('重複巡邏不再通知同樣的留言', async () => {
    for (let i = 0; i < 3; i++) {
      const s = await h.cycle();
      expect(s.results[0]?.groupsUpdated).toBe(0);
    }
    expect(h.line.accepted).toHaveLength(2);
  });
});

describe('社團：只通知群主（notify_authors）', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['group'], targetOverrides: { notify_authors: ['林大明'] } });
  });
  afterAll(async () => {
    await h.close();
  });
  it('路人的留言不通知、群主的留言通知；新貼文同樣受限', async () => {
    await h.cycle();
    const state = await h.fixture.control<{ posts: { id: number }[] }>('group', 'state');
    const postId = state.posts[1]!.id;
    await h.fixture.control('group', 'add-comment', { postId, author: '路人甲', text: '路人留言' });
    await h.fixture.control('group', 'add-post', { author: '路人乙', text: '路人貼文' });
    let s = await h.cycle();
    expect(s.results[0]?.stats?.suppressed).toBe(2);
    expect(s.results[0]?.eventsCreated).toBe(0);
    expect(s.results[0]?.groupsUpdated).toBe(0);
    expect(h.line.accepted).toHaveLength(0);
    await h.fixture.control('group', 'add-comment', { postId, author: '林大明', text: '群主說話了' });
    await h.fixture.control('group', 'add-post', { author: '林大明', text: '群主貼文' });
    s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(1);
    expect(s.flushedGroups).toBe(1);
    expect(h.line.accepted).toHaveLength(2);
    const texts = h.line.accepted.map((a) => a.body.messages![0]!.text!);
    expect(texts.some((t) => t.includes('群主貼文'))).toBe(true);
    expect(texts.some((t) => t.includes('群主說話了'))).toBe(true);
  });
});
