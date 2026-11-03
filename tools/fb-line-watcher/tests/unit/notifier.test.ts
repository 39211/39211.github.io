import { describe, expect, it, beforeEach } from 'vitest';
import { Db } from '../../src/storage/db.js';
import { parseConfigObject } from '../../src/config/load.js';
import { createLogger } from '../../src/logger.js';
import { Writable } from 'node:stream';
import { LineClient } from '../../src/line/client.js';
import { enqueueEvent, formatEventText, processDeliveries, raiseAlert, type NotifierDeps } from '../../src/line/notifier.js';
import { NonePublisher } from '../../src/publish/publisher.js';
import { getEvent, listEventsByStatus, countEvents } from '../../src/storage/repo.js';
import type { PostEventPayload } from '../../src/events.js';

const sink = new Writable({ write: (_c, _e, cb) => cb() });
const config = parseConfigObject({
  max_notifications_per_day: 2,
  line: { retry_schedule_seconds: [1, 1, 1] },
  targets: [{ key: 'a', name: '粉專', type: 'facebook_page', url: 'https://www.facebook.com/a' }],
});

interface FakeFetch {
  fetch: typeof fetch;
  calls: { url: string; headers: Record<string, string>; body: unknown }[];
  queue: { status: number; body?: string; headers?: Record<string, string> }[];
}

function fakeFetch(): FakeFetch {
  const f: FakeFetch = { calls: [], queue: [], fetch: (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    f.calls.push({ url: String(url), headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = f.queue.shift() ?? { status: 200, body: '{}' };
    return new Response(next.body ?? '{}', { status: next.status, headers: next.headers });
  }) as typeof fetch };
  return f;
}

function payload(text = '內容'): PostEventPayload {
  return { kind: 'NEW_POST', targetKey: 'a', targetName: '粉專', targetType: 'facebook_page', author: '店家', text, mediaSummary: '無', imageCount: 0, sourceUrl: 'https://www.facebook.com/a', confidence: 1, lowConfidence: false, completeness: 'COMPLETE_VISIBLE_SET', detectedAt: '2026-09-03T10:00:00+08:00' };
}

let db: Db;
let ff: FakeFetch;
let deps: NotifierDeps;
let nowMs: number;

beforeEach(() => {
  db = new Db(':memory:');
  ff = fakeFetch();
  nowMs = Date.parse('2026-09-03T10:00:00+08:00');
  deps = {
    db,
    config,
    logger: createLogger({ stream: sink, level: 'silent' }),
    clock: { now: () => new Date(nowMs) },
    destinationId: `C${'1'.repeat(32)}`,
    client: new LineClient({ accessToken: 'token-abcdef', baseUrl: 'https://line.test', fetchImpl: ff.fetch }),
    publisher: new NonePublisher(),
  };
});

describe('notifier', () => {
  it('同一事件只送一次，重跑不重送，且帶固定 retry key', async () => {
    enqueueEvent(deps, { eventKey: 'e1', targetKey: 'a', entityKey: null, detectionMode: 'STRUCTURED', payload: payload(), screenshotPath: null, previewPath: null });
    enqueueEvent(deps, { eventKey: 'e1', targetKey: 'a', entityKey: null, detectionMode: 'STRUCTURED', payload: payload(), screenshotPath: null, previewPath: null });
    let s = await processDeliveries(deps);
    expect(s.sent).toBe(1);
    s = await processDeliveries(deps);
    expect(s.processed).toBe(0);
    expect(ff.calls).toHaveLength(1);
    expect(ff.calls[0]?.headers['X-Line-Retry-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(ff.calls[0]?.headers.Authorization).toBe('Bearer token-abcdef');
    expect((ff.calls[0]?.body as { to: string }).to).toBe(deps.destinationId);
    expect(getEvent(db, 'e1')?.status).toBe('SENT');
  });

  it('500 兩次後成功：三次嘗試同一 retry key，事件只 SENT 一次', async () => {
    ff.queue.push({ status: 500, body: '{"message":"boom"}' }, { status: 502 });
    enqueueEvent(deps, { eventKey: 'e2', targetKey: 'a', entityKey: null, detectionMode: 'STRUCTURED', payload: payload(), screenshotPath: null, previewPath: null });
    let s = await processDeliveries(deps);
    expect(s.retried).toBe(1);
    s = await processDeliveries(deps); // 未到重試時間
    expect(s.processed).toBe(0);
    nowMs += 1100;
    s = await processDeliveries(deps);
    expect(s.retried).toBe(1);
    nowMs += 1100;
    s = await processDeliveries(deps);
    expect(s.sent).toBe(1);
    expect(ff.calls).toHaveLength(3);
    expect(new Set(ff.calls.map((c) => c.headers['X-Line-Retry-Key'])).size).toBe(1);
    expect(getEvent(db, 'e2')?.status).toBe('SENT');
  });

  it('409（retry key 已接受）視為成功', async () => {
    ff.queue.push({ status: 409, body: '{"message":"dup"}' });
    enqueueEvent(deps, { eventKey: 'e3', targetKey: 'a', entityKey: null, detectionMode: 'STRUCTURED', payload: payload(), screenshotPath: null, previewPath: null });
    const s = await processDeliveries(deps);
    expect(s.sent).toBe(1);
  });

  it('重試用盡進 dead-letter 並產生一則系統警報事件', async () => {
    ff.queue.push({ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    enqueueEvent(deps, { eventKey: 'e4', targetKey: 'a', entityKey: null, detectionMode: 'STRUCTURED', payload: payload(), screenshotPath: null, previewPath: null });
    for (let i = 0; i < 4; i++) {
      await processDeliveries(deps);
      nowMs += 1100;
    }
    expect(getEvent(db, 'e4')?.status).toBe('DEAD_LETTER');
    const alerts = listEventsByStatus(db, 'PENDING').filter((e) => e.event_type === 'SYSTEM_ALERT');
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0]!.payload_json).message).toMatch(/重試次數用盡/);
  });

  it('401 永久失敗立即 dead-letter，警報含 token 提示；警報本身可送出', async () => {
    ff.queue.push({ status: 401, body: '{"message":"Authentication failed"}' });
    enqueueEvent(deps, { eventKey: 'e5', targetKey: 'a', entityKey: null, detectionMode: 'STRUCTURED', payload: payload(), screenshotPath: null, previewPath: null });
    let s = await processDeliveries(deps);
    expect(s.dead).toBe(1);
    expect(getEvent(db, 'e5')?.status).toBe('DEAD_LETTER');
    s = await processDeliveries(deps);
    expect(s.sent).toBe(1); // SYSTEM_ALERT
    const alertBody = ff.calls[1]?.body as { messages: { text: string }[] };
    expect(alertBody.messages[0]?.text).toMatch(/LINE_CHANNEL_ACCESS_TOKEN/);
  });

  it('每日額度用完後內容事件被抑制、只發一次警報，系統事件不受限', async () => {
    for (const k of ['b1', 'b2', 'b3', 'b4']) enqueueEvent(deps, { eventKey: k, targetKey: 'a', entityKey: null, detectionMode: 'STRUCTURED', payload: payload(k), screenshotPath: null, previewPath: null });
    let s = await processDeliveries(deps);
    expect(s.sent).toBe(2);
    expect(s.suppressed).toBe(2);
    expect(getEvent(db, 'b3')?.status).toBe('SUPPRESSED');
    s = await processDeliveries(deps);
    expect(s.sent).toBe(1); // 額度警報
    expect(countEvents(db, { status: 'PENDING' })).toBe(0);
    expect(ff.calls).toHaveLength(3);
  });

  it('同一警報在冷卻時間內只通知一次；解除後再出現會再通知', () => {
    expect(raiseAlert(deps, { alertKey: 'x', severity: 'WARN', message: 'm' })).toBe(true);
    expect(raiseAlert(deps, { alertKey: 'x', severity: 'WARN', message: 'm' })).toBe(false);
    nowMs += config.line.system_alert_cooldown_minutes * 60 * 1000 + 1;
    expect(raiseAlert(deps, { alertKey: 'x', severity: 'WARN', message: 'm' })).toBe(true);
  });

  it('文字摘要會遮蔽電話與 email，且不超過 LINE 上限', () => {
    const text = formatEventText(payload('打 0912-345-678 或 a@b.com 聯絡我'), config);
    expect(text).toContain('【Facebook 新貼文】');
    expect(text).not.toContain('0912-345-678');
    expect(text).not.toContain('a@b.com');
    const long = formatEventText(payload('x'.repeat(9000)), config);
    expect(long.length).toBeLessThanOrEqual(5000);
  });
});
