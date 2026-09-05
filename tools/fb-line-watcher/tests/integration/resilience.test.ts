import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { setupHarness, saveSample, sleep, type Harness } from './harness.js';
import { countEntities, getTarget, listOpenAlerts, listRecentEvents, listAllPendingGroups } from '../../src/storage/repo.js';
import { acquireSingleInstanceLock, LockHeldError } from '../../src/worker/lock.js';

describe('故障處理：登入失效、載入中、結構失效降級、LINE 失敗、重啟、雙實例', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['page'], configOverrides: { comment_debounce_seconds: 3 } });
    await h.cycle(); // baseline
  });
  afterAll(async () => {
    await h.close();
  });

  it('登入頁：發一次 LOGIN_REQUIRED 警報、冷卻期間不重複、恢復後不誤報且警報解除', async () => {
    await h.fixture.control('page', 'mode', { mode: 'login' });
    let s = await h.cycle();
    expect(s.results[0]?.status).toBe('LOGIN_REQUIRED');
    expect(h.line.accepted).toHaveLength(1);
    expect(h.line.accepted[0]!.body.messages![0]!.text).toContain('npm run login');
    s = await h.cycle();
    expect(s.results[0]?.status).toBe('LOGIN_REQUIRED');
    expect(h.line.accepted).toHaveLength(1);
    expect(listOpenAlerts(h.app.db).some((a) => a.alert_key === 'target:page:LOGIN_REQUIRED')).toBe(true);
    await h.fixture.control('page', 'mode', { mode: 'normal' });
    s = await h.cycle();
    expect(s.results[0]?.status).toBe('READY');
    expect(s.results[0]?.eventsCreated).toBe(0);
    expect(h.line.accepted).toHaveLength(1);
    expect(listOpenAlerts(h.app.db).some((a) => a.alert_key === 'target:page:LOGIN_REQUIRED')).toBe(false);
  });

  it('安全檢查頁與權限不足頁各自分類並警報', async () => {
    await h.fixture.control('page', 'mode', { mode: 'checkpoint' });
    let s = await h.cycle();
    expect(s.results[0]?.status).toBe('CHECKPOINT');
    await h.fixture.control('page', 'mode', { mode: 'permission' });
    s = await h.cycle();
    expect(s.results[0]?.status).toBe('PERMISSION_DENIED');
    expect(h.line.accepted).toHaveLength(3);
    await h.fixture.control('page', 'mode', { mode: 'normal' });
    s = await h.cycle();
    expect(s.results[0]?.status).toBe('READY');
  });

  it('載入中骨架畫面：不更新 baseline、不通知、不算真正故障', async () => {
    const before = countEntities(h.app.db, 'page');
    await h.fixture.control('page', 'mode', { mode: 'skeleton' });
    const s = await h.cycle();
    expect(['DEGRADED', 'NETWORK_ERROR']).toContain(s.results[0]?.status);
    expect(countEntities(h.app.db, 'page')).toBe(before);
    expect(h.line.accepted).toHaveLength(3);
    await h.fixture.control('page', 'mode', { mode: 'normal' });
    const s2 = await h.cycle();
    expect(s2.results[0]?.status).toBe('READY');
    expect(s2.results[0]?.eventsCreated).toBe(0);
  });

  it('role/aria 全部消失 → 連續 2 次後降級為視覺模式並警報 → 畫面變化以雙重取樣通知 → 恢復後 resync 不洗版', async () => {
    await h.fixture.control('page', 'mode', { mode: 'noroles' });
    let s = await h.cycle();
    expect(s.results[0]?.status).toBe('DEGRADED');
    expect(getTarget(h.app.db, 'page')?.extractor_failures).toBe(1);
    s = await h.cycle();
    expect(s.results[0]?.status).toBe('DEGRADED');
    expect(s.results[0]?.mode).toBe('DEGRADED_VISUAL_MODE');
    expect(getTarget(h.app.db, 'page')?.detection_mode).toBe('DEGRADED_VISUAL_MODE');
    expect(h.line.accepted).toHaveLength(4);
    expect(h.line.accepted[3]!.body.messages![0]!.text).toContain('視覺降級模式');
    // 視覺 baseline 已建立；同畫面不通知
    s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(0);
    // 畫面出現新內容：第一次取樣 pending，第二次確認
    await h.fixture.control('page', 'add-post', { text: '降級期間新增的貼文，畫面明顯改變。', images: 1 });
    s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(0);
    s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(1);
    expect(h.line.accepted).toHaveLength(5);
    const vtext = h.line.accepted[4]!.body.messages![0]!.text!;
    expect(vtext).toContain('DEGRADED_VISUAL_MODE');
    expect(vtext).toContain('UNKNOWN_VISUAL_CHANGE');
    saveSample('04_degraded_visual_change.jpg', listRecentEvents(h.app.db, 1)[0]?.screenshot_path);
    // 再巡邏一次不重複
    s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(0);
    // 結構恢復 → resync，不把降級期間的貼文當新事件
    await h.fixture.control('page', 'mode', { mode: 'normal' });
    s = await h.cycle();
    expect(s.results[0]?.status).toBe('READY');
    expect(s.results[0]?.mode).toBe('STRUCTURED');
    expect(s.results[0]?.baselineMode).toBe(true);
    expect(s.results[0]?.eventsCreated).toBe(0);
    expect(getTarget(h.app.db, 'page')?.detection_mode).toBe('STRUCTURED');
    // 恢復通知（INFO）一則
    expect(h.line.accepted).toHaveLength(6);
    expect(h.line.accepted[5]!.body.messages![0]!.text).toContain('已恢復');
    // 之後的新貼文正常通知
    await h.fixture.control('page', 'add-post', { text: '恢復後的新貼文' });
    s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(1);
    expect(h.line.accepted).toHaveLength(7);
  });

  it('LINE 500 兩次後成功：三次嘗試同一 retry key，只接受一次，事件 SENT', async () => {
    h.line.failNext(500, 2);
    await h.fixture.control('page', 'add-post', { text: 'LINE 暫時故障期間的貼文' });
    const before = h.line.accepted.length;
    const attemptsBefore = h.line.attempts.length;
    let s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(1);
    expect(s.deliveries.retried).toBe(1);
    expect(h.line.accepted).toHaveLength(before);
    await sleep(1100);
    let d = await h.deliver();
    expect(d.retried).toBe(1);
    await sleep(1100);
    d = await h.deliver();
    expect(d.sent).toBe(1);
    expect(h.line.accepted).toHaveLength(before + 1);
    const keys = h.line.attempts.slice(attemptsBefore).map((a) => a.retryKey);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    s = await h.cycle();
    expect(s.deliveries.processed).toBe(0);
  });

  it('重啟後：已送出的不重送，等待中的留言合併群組仍會送出', async () => {
    const state = await h.fixture.control<{ posts: { id: number }[] }>('page', 'state');
    await h.fixture.control('page', 'add-comment', { postId: state.posts[state.posts.length - 1]!.id, author: '李阿姨', text: '重啟前的留言' });
    let s = await h.cycle();
    expect(s.results[0]?.groupsUpdated).toBe(1);
    expect(listAllPendingGroups(h.app.db)).toHaveLength(1);
    const before = h.line.accepted.length;
    await h.restart();
    expect(listAllPendingGroups(h.app.db)).toHaveLength(1);
    await sleep(3100);
    s = await h.cycle();
    expect(s.results[0]?.eventsCreated).toBe(0);
    expect(s.flushedGroups).toBe(1);
    expect(h.line.accepted).toHaveLength(before + 1);
    expect(h.line.accepted[before]!.body.messages![0]!.text).toContain('重啟前的留言');
    s = await h.cycle();
    expect(s.deliveries.processed).toBe(0);
    expect(h.line.accepted).toHaveLength(before + 1);
  });

  it('第二個實例無法取得鎖', () => {
    const lockPath = path.join(h.app.dataDir, 'watcher.lock');
    const a = acquireSingleInstanceLock(lockPath);
    expect(() => acquireSingleInstanceLock(lockPath, { pid: process.pid + 1, isAlive: () => true })).toThrow(LockHeldError);
    a.release();
  });
});
