import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { setupHarness, waitFor, type Harness } from './harness.js';
import { startPhoneIngestServer, type PhoneIngestHandle } from '../../src/worker/phone-ingest.js';
import { flushPhoneNotifications } from '../../src/worker/scheduler.js';
import { listRecentEvents } from '../../src/storage/repo.js';
import { TINY_JPEG } from '../../fixtures/images.js';

const TOKEN = 'p'.repeat(32);
const PKG = 'com.facebook.katana';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/**
 * 純手機模式：完全不開瀏覽器、電腦不連 Facebook。
 * 手機把通知 POST 過來，電腦負責去重、合併、發 LINE。
 */
describe('純手機模式（無瀏覽器）', () => {
  let h: Harness;
  let server: PhoneIngestHandle;
  let url: string;

  const post = async (params: Record<string, string>, body?: Buffer): Promise<Response> => {
    const q = new URLSearchParams({ token: TOKEN, pkg: PKG, ...params }).toString();
    return fetch(`${url}?${q}`, { method: 'POST', ...(body ? { body } : {}) });
  };

  beforeAll(async () => {
    h = await setupHarness({
      targets: [],
      configOverrides: { phone_ingest: { enabled: true, debounce_seconds: 0, notify_authors: [], dedup_window_seconds: 600 } },
    });
    server = await startPhoneIngestServer({
      db: h.app.db,
      config: h.app.config.phone_ingest,
      token: TOKEN,
      capturesDir: h.app.capturesDir,
      timezone: h.app.config.timezone,
      logger: h.app.logger,
      now: () => h.app.clock.now(),
      port: 0,
      bind: '127.0.0.1',
    });
    url = `http://127.0.0.1:${server.port}/phone/notify`;
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    await h.close();
  });

  it('設定為零 target 時不會啟動瀏覽器', async () => {
    const s = await h.cycle();
    expect(s.results).toHaveLength(0);
    expect(h.app.browser).toBeUndefined();
  });

  it('一則通知 → 一則 LINE 訊息，內容含發話者與原文', async () => {
    const res = await post({ title: '林大明', text: '群主公告：這週六下午聚會，記得帶鞋來！', pkg: 'com.facebook.katana' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('accepted');
    expect(flushPhoneNotifications(h.app)).toBe(1);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(1);
    const text = h.line.accepted[0]!.body.messages![0]!.text!;
    expect(text).toContain('【Facebook 手機通知】');
    expect(text).toContain('林大明');
    expect(text).toContain('這週六下午聚會');
    expect(text).toContain('群主公告：'); // 全形冒號未被竄改
    expect(text).toContain('手機 Facebook App 通知');
  });

  it('重複送出同一則通知不會再發一次', async () => {
    const before = h.line.accepted.length;
    await post({ title: '林大明', text: '群主公告：這週六下午聚會，記得帶鞋來！', pkg: 'com.facebook.katana' });
    expect(flushPhoneNotifications(h.app)).toBe(0);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before);
  });

  it('多則通知合併成一則 LINE 訊息', async () => {
    const before = h.line.accepted.length;
    await post({ title: '林大明', text: '第一則' });
    await post({ title: '陳美玲', text: '第二則' });
    await post({ title: '王志豪', text: '第三則' });
    expect(flushPhoneNotifications(h.app)).toBe(3);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before + 1);
    const text = h.line.accepted[before]!.body.messages![0]!.text!;
    expect(text).toContain('【Facebook 手機通知 3 則】');
    expect(text).toContain('林大明：第一則');
    expect(text).toContain('陳美玲：第二則');
    expect(text).toContain('王志豪：第三則');
  });

  it('附截圖的通知：圖片存檔並成為事件的截圖', async () => {
    const before = h.line.accepted.length;
    await post({ title: '林大明', text: '這則有附圖' }, TINY_JPEG);
    expect(flushPhoneNotifications(h.app)).toBe(1);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before + 1);
    const ev = listRecentEvents(h.app.db, 1)[0]!;
    expect(ev.event_type).toBe('PHONE_NOTIFICATION');
    expect(ev.detection_mode).toBe('PHONE_NOTIFICATION');
    expect(ev.screenshot_path).toBeTruthy();
    expect(existsSync(ev.screenshot_path!)).toBe(true);
    expect(h.line.accepted[before]!.body.messages![0]!.text).toContain('（附截圖）');
  });

  // ---- 回歸（P0）：去重視窗到期後，同一則通知必須真的再送到 LINE 一次 ----
  it('去重視窗到期後同一則通知會再送一次，視窗內則不會', async () => {
    const body = { title: '林大明', text: '固定內容：明天公休' };
    const before = h.line.accepted.length;

    expect(await (await post(body)).text()).toBe('accepted');
    expect(flushPhoneNotifications(h.app)).toBe(1);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before + 1);

    // 視窗內重送 → duplicate，LINE 不變
    expect(await (await post(body)).text()).toContain('duplicate');
    expect(flushPhoneNotifications(h.app)).toBe(0);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before + 1);

    // 時間推進超過 dedup_window_seconds（600 秒）→ 必須再送一次
    h.clock.offsetMs += 601_000;
    expect(await (await post(body)).text()).toBe('accepted');
    expect(flushPhoneNotifications(h.app)).toBe(1);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before + 2);
    expect(h.line.accepted[before + 1]!.body.messages![0]!.text).toContain('明天公休');

    const sent = h.app.db.all<{ event_key: string }>("SELECT event_key FROM events WHERE payload_json LIKE '%明天公休%'");
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((e) => e.event_key)).size).toBe(2);
  });

  it('重啟後尚未送出的通知仍會送出，已送出的不重送', async () => {
    await post({ title: '林大明', text: '重啟前收到的通知' });
    const before = h.line.accepted.length;
    await h.restart();
    expect(flushPhoneNotifications(h.app)).toBe(1);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before + 1);
    expect(h.line.accepted[before]!.body.messages![0]!.text).toContain('重啟前收到的通知');
    expect(flushPhoneNotifications(h.app)).toBe(0);
    await h.deliver();
    expect(h.line.accepted).toHaveLength(before + 1);
  });

});

describe('純手機模式：只通知群主 + 附圖上傳到 LINE', () => {
  let h: Harness;
  let server: PhoneIngestHandle;
  let url: string;

  beforeAll(async () => {
    const port = await freePort();
    h = await setupHarness({
      targets: [],
      publisher: 'local_http',
      publicPort: port,
      configOverrides: {
        images: { publisher: 'local_http', local_http: { port } },
        phone_ingest: { enabled: true, debounce_seconds: 0, notify_authors: ['林大明'] },
      },
    });
    await h.app.publisher.start?.();
    server = await startPhoneIngestServer({
      db: h.app.db,
      config: h.app.config.phone_ingest,
      token: TOKEN,
      capturesDir: h.app.capturesDir,
      timezone: h.app.config.timezone,
      logger: h.app.logger,
      now: () => h.app.clock.now(),
      port: 0,
      bind: '127.0.0.1',
    });
    url = `http://127.0.0.1:${server.port}/phone/notify`;
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    await h.close();
  });

  it('路人的通知被擋掉，群主的通知附圖送到 LINE', async () => {
    const send = async (title: string, text: string, body?: Buffer): Promise<Response> =>
      fetch(`${url}?${new URLSearchParams({ token: TOKEN, pkg: PKG, title, text }).toString()}`, { method: 'POST', ...(body ? { body } : {}) });

    expect(await (await send('路人甲', '路人留言')).text()).toContain('filtered');
    expect(flushPhoneNotifications(h.app)).toBe(0);
    expect(h.line.accepted).toHaveLength(0);

    expect(await (await send('林大明', '群主說話了', TINY_JPEG)).text()).toBe('accepted');
    expect(flushPhoneNotifications(h.app)).toBe(1);
    await h.deliver();
    await waitFor('LINE 收到附圖訊息', () => h.line.accepted.length === 1);

    const msgs = h.line.accepted[0]!.body.messages!;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.text).toContain('群主說話了');
    expect(msgs[1]!.type).toBe('image');
    expect(msgs[1]!.originalContentUrl).toMatch(/^https:\/\/img\.example\.test\/[a-f0-9]{32}\.jpg$/);
    const r = await fetch(msgs[1]!.originalContentUrl!.replace('https://img.example.test', `http://127.0.0.1:${h.config.images.local_http.port}`));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
  });
});
