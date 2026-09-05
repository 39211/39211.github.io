import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { setupHarness, type Harness } from './harness.js';
import { LocalHttpPublisher } from '../../src/publish/local-http.js';
import { cleanupExpiredImages } from '../../src/publish/publisher.js';
import { toIsoWithOffset } from '../../src/util/time.js';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

describe('圖片發布：本機 HTTP 發布器 + LINE 圖片訊息', () => {
  let h: Harness;
  let port: number;
  beforeAll(async () => {
    port = await freePort();
    h = await setupHarness({ targets: ['page'], publisher: 'local_http', publicPort: port, configOverrides: { images: { publisher: 'local_http', retention_hours: 1, local_http: { port } } } });
    await h.app.publisher.start?.();
    await h.cycle();
  });
  afterAll(async () => {
    await h.close();
  });

  it('新貼文通知附帶原圖與預覽圖 URL，檔案可由 HTTP 取得且不列目錄', async () => {
    await h.fixture.control('page', 'add-post', { text: '要附圖的貼文', images: 2 });
    const s = await h.cycle();
    expect(s.deliveries.sent).toBe(1);
    const msgs = h.line.accepted[0]!.body.messages!;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.type).toBe('image');
    expect(msgs[1]!.originalContentUrl).toMatch(/^https:\/\/img\.example\.test\/[a-f0-9]{32}\.jpg$/);
    expect(msgs[1]!.previewImageUrl).toMatch(/^https:\/\/img\.example\.test\/[a-f0-9]{32}_p\.jpg$/);
    const name = msgs[1]!.originalContentUrl!.split('/').pop()!;
    const pname = msgs[1]!.previewImageUrl!.split('/').pop()!;
    const publisher = h.app.publisher as LocalHttpPublisher;
    const r = await fetch(`http://127.0.0.1:${publisher.port}/${name}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.length).toBeGreaterThan(5000);
    expect(buf.length).toBeLessThan(9_500_000);
    expect(buf.subarray(0, 2).toString('hex')).toBe('ffd8'); // JPEG
    const pr = await fetch(`http://127.0.0.1:${publisher.port}/${pname}`);
    expect(pr.status).toBe(200);
    expect(Number(pr.headers.get('content-length'))).toBeLessThan(950_000);
    expect((await fetch(`http://127.0.0.1:${publisher.port}/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${publisher.port}/..%2Fwatcher.sqlite`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${publisher.port}/${'0'.repeat(32)}.jpg`)).status).toBe(404);
  });

  it('到期後公開圖片會被刪除，本機證據圖保留', async () => {
    const publicDir = path.join(h.app.dataDir, 'public');
    expect(readdirSync(publicDir).length).toBe(2);
    h.clock.offsetMs = 2 * 3600 * 1000;
    const nowIso = toIsoWithOffset(h.clock.now(), h.config.timezone);
    const deleted = await cleanupExpiredImages(h.app.db, h.app.publisher, nowIso, h.app.logger);
    expect(deleted).toBe(2);
    expect(readdirSync(publicDir).length).toBe(0);
    const ev = h.app.db.get<{ screenshot_path: string }>('SELECT screenshot_path FROM events ORDER BY created_at DESC LIMIT 1')!;
    expect(existsSync(ev.screenshot_path)).toBe(true);
    h.clock.offsetMs = 0;
  });
});
