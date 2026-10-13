import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupHarness, type Harness } from './harness.js';
import { listRecentEvents } from '../../src/storage/repo.js';

/**
 * 故障注入（P0）：偵測狀態不可以在事件持久化之前就前移。
 *
 * 舊版 applyDiff 在同一個 transaction 就把 known / content hash 設成「已處理」，
 * 呼叫端之後才截圖；截圖失敗時 catch 只發系統警報，下一輪看到相同內容也不會再建立事件，
 * 這則貼文／留言就永遠漏報了。
 *
 * 這裡直接把 captureEntity 換成會丟例外的版本，驗證：
 *   1. 該輪不會建立事件、不會提交狀態
 *   2. 下一輪自動補送
 *   3. 補送只送一次（不會每輪重複轟炸 LINE）
 */
const faults = vi.hoisted(() => ({ captureFails: false }));

vi.mock('../../src/capture/capture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/capture/capture.js')>();
  return {
    ...actual,
    captureEntity: async (...args: Parameters<typeof actual.captureEntity>) => {
      if (faults.captureFails) throw new Error('注入故障：截圖失敗');
      return actual.captureEntity(...args);
    },
  };
});

/** 只數「內容通知」，避免把截圖失敗的系統警報也算進去 */
function lineHits(h: Harness, needle: string): number {
  return h.line.accepted.filter((a) => (a.body.messages ?? []).some((m) => typeof m.text === 'string' && m.text.includes(needle))).length;
}

function alertHits(h: Harness, needle: string): number {
  return h.line.accepted.filter((a) => (a.body.messages ?? []).some((m) => typeof m.text === 'string' && m.text.includes('系統') && m.text.includes(needle))).length;
}

/** 注入截圖故障跑一輪，結束後自動恢復 */
async function cycleWithCaptureFailure(h: Harness): Promise<Awaited<ReturnType<Harness['cycle']>>> {
  faults.captureFails = true;
  try {
    return await h.cycle();
  } finally {
    faults.captureFails = false;
  }
}

describe('截圖失敗時的補送語意', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['page'], configOverrides: { comment_debounce_seconds: 0, capture_failure_fallback_threshold: 99 } });
    await h.cycle(); // baseline
  }, 180_000);
  afterAll(async () => {
    await h.close();
  });

  it('新貼文截圖失敗 → 該輪不送，下一輪補送且只送一次', async () => {
    const TEXT = '截圖會失敗的新貼文';
    await h.fixture.control('page', 'add-post', { text: TEXT });

    const failed = await cycleWithCaptureFailure(h);
    expect(failed.results[0]?.stats?.newPosts).toBe(1);
    expect(failed.results[0]?.eventsCreated).toBe(0);
    expect(lineHits(h, TEXT)).toBe(0);
    expect(h.app.db.get<{ c: number }>(`SELECT COUNT(*) c FROM events WHERE event_type = 'NEW_POST' AND payload_json LIKE '%${TEXT}%'`)?.c).toBe(0);
    // 操作者要被告知，而且訊息要說明下一輪會自動補送
    expect(alertHits(h, '截圖失敗')).toBeGreaterThanOrEqual(1);

    // 下一輪必須補送
    const recovered = await h.cycle();
    expect(recovered.results[0]?.stats?.redetected).toBe(1);
    expect(recovered.results[0]?.eventsCreated).toBe(1);
    expect(lineHits(h, TEXT)).toBe(1);
    const ev = listRecentEvents(h.app.db, 1)[0]!;
    expect(ev.event_type).toBe('NEW_POST');
    expect(ev.screenshot_path).toBeTruthy();

    // 再跑兩輪不能重複送
    for (let i = 0; i < 2; i++) {
      const s = await h.cycle();
      expect(s.results[0]?.eventsCreated).toBe(0);
    }
    expect(lineHits(h, TEXT)).toBe(1);
    expect(h.app.db.get<{ c: number }>(`SELECT COUNT(*) c FROM events WHERE event_type = 'NEW_POST' AND payload_json LIKE '%${TEXT}%'`)?.c).toBe(1);
  }, 180_000);

  it('貼文編輯截圖失敗 → 下一輪補送且只送一次，仍帶得到原文', async () => {
    const state = await h.fixture.control<{ posts: { id: number; text: string }[] }>('page', 'state');
    const target = state.posts.find((p) => p.text.includes('截圖會失敗的新貼文'))!;
    const TEXT = '已更正內容';
    await h.fixture.control('page', 'edit-post', { id: target.id, text: `截圖會失敗的新貼文（${TEXT}）` });

    const failed = await cycleWithCaptureFailure(h);
    expect(failed.results[0]?.stats?.editedPosts).toBe(1);
    expect(failed.results[0]?.eventsCreated).toBe(0);
    expect(lineHits(h, TEXT)).toBe(0);

    const recovered = await h.cycle();
    expect(recovered.results[0]?.stats?.editedPosts).toBe(1);
    expect(recovered.results[0]?.eventsCreated).toBe(1);
    expect(lineHits(h, TEXT)).toBe(1);
    const text = h.line.accepted.at(-1)!.body.messages![0]!.text!;
    expect(text).toContain('【Facebook 貼文已編輯】');
    expect(text).toContain(TEXT);
    expect(text).toContain('原文摘要');

    for (let i = 0; i < 2; i++) expect((await h.cycle()).results[0]?.eventsCreated).toBe(0);
    expect(lineHits(h, TEXT)).toBe(1);
  }, 180_000);

  it('留言截圖失敗 → 下一輪補送且只送一次', async () => {
    const state = await h.fixture.control<{ posts: { id: number; text: string }[] }>('page', 'state');
    const target = state.posts.find((p) => p.text.includes('已更正內容'))!;
    const TEXT = '這則留言的截圖會失敗';
    await h.fixture.control('page', 'add-comment', { postId: target.id, author: '陳美玲', text: TEXT });

    const failed = await cycleWithCaptureFailure(h);
    expect(failed.results[0]?.stats?.newComments).toBe(1);
    expect(failed.results[0]?.groupsUpdated).toBe(0);
    expect(h.app.db.get<{ c: number }>('SELECT COUNT(*) c FROM pending_groups')?.c).toBe(0);
    expect(lineHits(h, TEXT)).toBe(0);

    const recovered = await h.cycle();
    expect(recovered.results[0]?.stats?.newComments).toBe(1);
    expect(recovered.results[0]?.groupsUpdated).toBe(1);
    expect(lineHits(h, TEXT)).toBe(1);
    const text = h.line.accepted.at(-1)!.body.messages![0]!.text!;
    expect(text).toContain(TEXT);
    expect(text).toContain('陳美玲');

    for (let i = 0; i < 2; i++) expect((await h.cycle()).results[0]?.groupsUpdated).toBe(0);
    expect(lineHits(h, TEXT)).toBe(1);
  }, 180_000);
});

describe('連續截圖失敗超過門檻改送純文字', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ targets: ['page'], configOverrides: { comment_debounce_seconds: 0, capture_failure_fallback_threshold: 2 } });
    await h.cycle();
  }, 180_000);
  afterAll(async () => {
    await h.close();
  });

  it('連續失敗達門檻時送出沒有截圖的事件，之後不再重複', async () => {
    const TEXT = '永遠截不到圖的貼文';
    await h.fixture.control('page', 'add-post', { text: TEXT });

    // 第 1 次失敗：不送，等下一輪
    expect((await cycleWithCaptureFailure(h)).results[0]?.eventsCreated).toBe(0);
    expect(lineHits(h, TEXT)).toBe(0);

    // 第 2 次失敗達門檻：改送純文字
    expect((await cycleWithCaptureFailure(h)).results[0]?.eventsCreated).toBe(1);
    await h.deliver();
    expect(lineHits(h, TEXT)).toBe(1);
    const ev = h.app.db.get<{ event_type: string; screenshot_path: string | null }>(
      `SELECT event_type, screenshot_path FROM events WHERE event_type = 'NEW_POST' AND payload_json LIKE '%${TEXT}%'`,
    )!;
    expect(ev.event_type).toBe('NEW_POST');
    expect(ev.screenshot_path).toBeNull();
    expect(alertHits(h, '已改用純文字通知')).toBeGreaterThanOrEqual(1);

    // 已提交，後續巡邏不再重送
    for (let i = 0; i < 2; i++) await h.cycle();
    expect(h.app.db.get<{ c: number }>(`SELECT COUNT(*) c FROM events WHERE event_type = 'NEW_POST' AND payload_json LIKE '%${TEXT}%'`)?.c).toBe(1);
    expect(lineHits(h, TEXT)).toBe(1);
  }, 180_000);
});
