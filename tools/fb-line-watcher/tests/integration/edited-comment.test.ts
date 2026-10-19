import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, sleep, type Harness } from './harness.js';
import { listAllPendingGroups, listRecentEvents, upsertPendingGroup } from '../../src/storage/repo.js';
import { flushDueGroups } from '../../src/worker/scheduler.js';

describe('留言編輯必須送出第二則（WO-006）', () => {
  let h: Harness;
  let postId: number;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['group'] });
    const state = await h.fixture.control<{ posts: { id: number }[] }>('group', 'state');
    postId = state.posts[0]!.id;
    await h.cycle();
  });
  afterAll(async () => {
    await h.close();
  });

  it('新留言送出一則；同一批再 flush 不重送', async () => {
    await h.fixture.control('group', 'add-comment', { postId, author: '客人', text: '你們幾點開門？' });
    const s = await h.cycle();
    expect(s.results[0]?.stats?.newComments).toBe(1);
    expect(h.line.accepted).toHaveLength(1);
    expect(h.line.accepted[0]!.body.messages![0]!.text).toContain('你們幾點開門');
    const n = flushDueGroups(h.app);
    expect(n).toBe(0);
    expect(h.line.accepted).toHaveLength(1);
  });

  it('該留言被編輯 → 必須送出第二則，內容含編輯後文字', async () => {
    const state = await h.fixture.control<{ posts: { id: number; comments: { id: number; text: string }[] }[] }>('group', 'state');
    const comment = state.posts[0]!.comments.find((c) => c.text.includes('你們幾點開門'))!;
    await h.fixture.control('group', 'edit-comment', { postId, commentId: comment.id, text: '你們幾點開門？（補充：週日呢）' });
    const s = await h.cycle();
    expect(s.results[0]?.stats?.editedComments).toBe(1);
    expect(h.line.accepted).toHaveLength(2);
    expect(h.line.accepted[1]!.body.messages![0]!.text).toContain('週日');
    const types = listRecentEvents(h.app.db, 5).map((e) => e.event_type);
    expect(types.filter((t) => t === 'NEW_COMMENTS').length).toBeGreaterThanOrEqual(2);
  });

  it('同一則留言連續編輯三次 → 收到三則，內容各自不同', async () => {
    const before = h.line.accepted.length;
    const state = await h.fixture.control<{ posts: { id: number; comments: { id: number; text: string }[] }[] }>('group', 'state');
    const comment = state.posts[0]!.comments.find((c) => c.text.includes('你們幾點開門'))!;
    for (const text of ['編輯第二次：週六呢', '編輯第三次：晚上呢', '編輯第四次：中午呢']) {
      await h.fixture.control('group', 'edit-comment', { postId, commentId: comment.id, text });
      const s = await h.cycle();
      expect(s.results[0]?.stats?.editedComments).toBe(1);
    }
    expect(h.line.accepted.length).toBe(before + 3);
    const texts = h.line.accepted.slice(before).map((a) => a.body.messages![0]!.text!);
    expect(texts.some((t) => t.includes('週六'))).toBe(true);
    expect(texts.some((t) => t.includes('晚上'))).toBe(true);
    expect(texts.some((t) => t.includes('中午'))).toBe(true);
  });

  it('enqueueEvent 回傳 false 時 flushedGroups 不遞增，且 pending group 被刪除', async () => {
    const ev = listRecentEvents(h.app.db, 1)[0]!;
    const now = '2000-01-01T00:00:00+08:00';
    upsertPendingGroup(h.app.db, {
      group_key: `${ev.target_key}|${ev.entity_key}|COMMENTS|replay`,
      target_key: ev.target_key,
      root_post_key: ev.entity_key ?? 'x',
      hold_until: now,
      created_at: now,
      updated_at: now,
      payload_json: ev.payload_json,
      screenshot_path: ev.screenshot_path,
      preview_path: ev.preview_path,
    });
    // 必須用「同一把 event key」才能撞到 INSERT OR IGNORE。
    // 直接再 flush 一次剛剛那則 payload：若 key 含內容雜湊，這把 key 已存在。
    const beforeAccepted = h.line.accepted.length;
    const n = flushDueGroups(h.app);
    expect(n).toBe(0);
    expect(listAllPendingGroups(h.app.db).every((g) => !g.group_key.endsWith('|replay'))).toBe(true);
    expect(h.line.accepted.length).toBe(beforeAccepted);
  });
});

describe('debounce 期間編輯必須更新 pending 內容', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['group'], configOverrides: { comment_debounce_seconds: 2 } });
    await h.cycle();
  });
  afterAll(async () => {
    await h.close();
  });

  it('先留言再立刻編輯：合併後只送一則，文字是編輯後版本', async () => {
    const state = await h.fixture.control<{ posts: { id: number }[] }>('group', 'state');
    const postId = state.posts[0]!.id;
    const cid = await h.fixture.control<{ id: number }>('group', 'add-comment', { postId, author: '客人', text: '原文留言' });
    let s = await h.cycle();
    expect(s.results[0]?.groupsUpdated).toBe(1);
    expect(h.line.accepted).toHaveLength(0);
    await h.fixture.control('group', 'edit-comment', { postId, commentId: cid.id, text: '原文留言（已補充電話，其實不要寫電話）' });
    s = await h.cycle();
    expect(listAllPendingGroups(h.app.db)).toHaveLength(1);
    await sleep(2200);
    s = await h.cycle();
    expect(s.flushedGroups).toBe(1);
    expect(h.line.accepted).toHaveLength(1);
    expect(h.line.accepted[0]!.body.messages![0]!.text).toContain('已補充');
  });
});
