import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Db } from '../../src/storage/db.js';
import { createLogger, clearSecretsForTest, registerSecret } from '../../src/logger.js';
import { PhoneIngestSchema } from '../../src/config/schema.js';
import { deriveItemKey, ingestNotification, normalizeNotificationText, startPhoneIngestServer, type PhoneIngestDeps, type PhoneIngestHandle } from '../../src/worker/phone-ingest.js';

const TOKEN = 'p'.repeat(32);
const lines: string[] = [];
const sink = new Writable({
  write(c, _e, cb) {
    lines.push(c.toString());
    cb();
  },
});

// 最小的合法 JPEG 標頭，讓伺服器把 body 認成圖片
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x41)]);

let db: Db;
let dir: string;
let now: Date;
let deps: PhoneIngestDeps;
let accepted: string[];

function makeDeps(over: Record<string, unknown> = {}): PhoneIngestDeps {
  accepted = [];
  return {
    db,
    config: PhoneIngestSchema.parse({ enabled: true, ...over }),
    token: TOKEN,
    capturesDir: dir,
    timezone: 'Asia/Taipei',
    logger: createLogger({ stream: sink, level: 'debug' }),
    now: () => now,
    onAccepted: (k) => accepted.push(k),
  };
}

beforeEach(() => {
  lines.length = 0;
  clearSecretsForTest();
  registerSecret(TOKEN);
  db = new Db(':memory:');
  dir = mkdtempSync(path.join(os.tmpdir(), 'fblw-phone-'));
  now = new Date('2026-09-04T10:00:00+08:00');
  deps = makeDeps();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('通知文字正規化與識別碼', () => {
  it('去除零寬字元、合併空白、保留換行結構，且不動中文全形標點', () => {
    expect(normalizeNotificationText('  林大明\u200b 說：  這週六   聚會 \n\n  記得帶鞋  ')).toBe('林大明 說： 這週六 聚會\n記得帶鞋');
  });
  it('全形與半形標點視為同一則通知（比對時才做 NFKC）', () => {
    expect(deriveItemKey({ title: 'A', text: '公告：聚會' })).toBe(deriveItemKey({ title: 'A', text: '公告:聚會' }));
  });
  it('相同內容得到相同識別碼，內容或標題不同則不同', () => {
    const a = { title: '林大明', text: '聚會', packageName: 'com.facebook.katana' };
    expect(deriveItemKey(a)).toBe(deriveItemKey({ ...a, text: ' 聚會 ' }));
    expect(deriveItemKey(a)).not.toBe(deriveItemKey({ ...a, text: '取消' }));
    expect(deriveItemKey(a)).not.toBe(deriveItemKey({ ...a, title: '陳美玲' }));
  });
  it('手機端提供 clientKey 時以它為準', () => {
    const k = deriveItemKey({ text: 'x', clientKey: 'abc' });
    expect(k).toBe(deriveItemKey({ text: '完全不同的內容', clientKey: 'abc' }));
  });
});

describe('ingestNotification', () => {
  it('接受一般通知並寫入資料庫', () => {
    const r = ingestNotification(deps, { title: '林大明', text: '群主公告：這週六聚會', packageName: 'com.facebook.katana' }, null);
    expect(r.status).toBe('accepted');
    expect(accepted).toHaveLength(1);
    const row = db.get<{ title: string; body_text: string; batched: number }>('SELECT title, body_text, batched FROM phone_notifications');
    expect(row).toMatchObject({ title: '林大明', body_text: '群主公告：這週六聚會', batched: 0 });
  });

  it('去重視窗內的相同通知不重複處理，超過視窗後可再次處理', () => {
    const n = { title: '林大明', text: '公告', packageName: 'com.facebook.katana' };
    expect(ingestNotification(deps, n, null).status).toBe('accepted');
    expect(ingestNotification(deps, n, null).status).toBe('duplicate');
    now = new Date(now.getTime() + 601_000); // 預設視窗 600 秒
    expect(ingestNotification(deps, n, null).status).toBe('accepted');
  });

  it('只通知指定發話者：其他人被過濾但不入庫', () => {
    deps = makeDeps({ notify_authors: ['林大明'] });
    expect(ingestNotification(deps, { title: '路人甲', text: '哈囉', packageName: 'com.facebook.katana' }, null)).toMatchObject({ status: 'filtered', reason: 'author_not_in_allowlist' });
    expect(ingestNotification(deps, { title: '林大明', text: '公告', packageName: 'com.facebook.katana' }, null).status).toBe('accepted');
    expect(db.get<{ c: number }>('SELECT COUNT(*) c FROM phone_notifications')?.c).toBe(1);
  });

  it('支援正規表達式的發話者比對與黑名單', () => {
    deps = makeDeps({ notify_authors: ['/^林/'] });
    expect(ingestNotification(deps, { title: '林大明', text: 'a' }, null).status).toBe('accepted');
    expect(ingestNotification(deps, { title: '陳美玲', text: 'b' }, null).status).toBe('filtered');
    deps = makeDeps({ ignore_authors: ['廣告'] });
    expect(ingestNotification(deps, { title: '廣告小編', text: 'c' }, null)).toMatchObject({ status: 'filtered', reason: 'author_ignored' });
  });

  it('內文關鍵字過濾', () => {
    deps = makeDeps({ require_text_match: ['聚會', '/公告/'] });
    expect(ingestNotification(deps, { title: 'A', text: '今天天氣真好' }, null)).toMatchObject({ status: 'filtered', reason: 'text_no_match' });
    expect(ingestNotification(deps, { title: 'A', text: '這週六聚會' }, null).status).toBe('accepted');
  });

  it('只接受允許的 Android 套件', () => {
    expect(ingestNotification(deps, { title: 'A', text: 'x', packageName: 'com.whatsapp' }, null)).toMatchObject({ status: 'filtered', reason: 'package_not_allowed:com.whatsapp' });
    expect(ingestNotification(deps, { title: 'A', text: 'x', packageName: 'com.facebook.lite' }, null).status).toBe('accepted');
  });

  it('空通知被拒絕', () => {
    expect(ingestNotification(deps, { text: '   ' }, null)).toMatchObject({ status: 'rejected', reason: 'empty_notification' });
  });

  it('附帶截圖時存檔並記錄路徑', () => {
    const r = ingestNotification(deps, { title: '林大明', text: '有圖' }, JPEG);
    expect(r).toMatchObject({ status: 'accepted', hasImage: true });
    const row = db.get<{ image_path: string }>('SELECT image_path FROM phone_notifications')!;
    expect(existsSync(row.image_path)).toBe(true);
    expect(readFileSync(row.image_path).subarray(0, 2).toString('hex')).toBe('ffd8');
  });
});

describe('HTTP 介面', () => {
  let server: PhoneIngestHandle;
  afterEach(async () => {
    await server?.close();
  });

  it('token 錯誤回 401 且不入庫；正確時以 query 參數帶入欄位', async () => {
    server = await startPhoneIngestServer({ ...deps, port: 0, bind: '127.0.0.1' });
    const base = `http://127.0.0.1:${server.port}/phone/notify`;
    expect((await fetch(`${base}?token=wrong&text=x`, { method: 'POST' })).status).toBe(401);
    expect(db.get<{ c: number }>('SELECT COUNT(*) c FROM phone_notifications')?.c).toBe(0);

    const url = `${base}?token=${TOKEN}&title=${encodeURIComponent('林大明')}&text=${encodeURIComponent('群主公告：這週六聚會，記得帶鞋')}&pkg=com.facebook.katana`;
    const res = await fetch(url, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('accepted');
    const row = db.get<{ title: string; body_text: string }>('SELECT title, body_text FROM phone_notifications')!;
    expect(row.title).toBe('林大明');
    expect(row.body_text).toContain('記得帶鞋');
  });

  it('body 是 JPEG 時當作截圖，非圖片 body 則忽略', async () => {
    server = await startPhoneIngestServer({ ...deps, port: 0, bind: '127.0.0.1' });
    const base = `http://127.0.0.1:${server.port}/phone/notify?token=${TOKEN}`;
    await fetch(`${base}&text=${encodeURIComponent('有圖')}`, { method: 'POST', body: JPEG });
    await fetch(`${base}&text=${encodeURIComponent('沒圖')}`, { method: 'POST', body: 'not an image' });
    const rows = db.all<{ body_text: string; image_path: string | null }>('SELECT body_text, image_path FROM phone_notifications ORDER BY body_text');
    expect(rows.find((r) => r.body_text === '有圖')?.image_path).toBeTruthy();
    expect(rows.find((r) => r.body_text === '沒圖')?.image_path).toBeNull();
  });

  it('超過大小上限回 413', async () => {
    server = await startPhoneIngestServer({ ...makeDeps({ max_image_bytes: 2048 }), port: 0, bind: '127.0.0.1' });
    const big = Buffer.concat([JPEG, Buffer.alloc(4096, 0x42)]);
    const res = await fetch(`http://127.0.0.1:${server.port}/phone/notify?token=${TOKEN}&text=big`, { method: 'POST', body: big });
    expect(res.status).toBe(413);
    expect(db.get<{ c: number }>('SELECT COUNT(*) c FROM phone_notifications')?.c).toBe(0);
  });

  it('/health 不需 token；token 不會出現在日誌', async () => {
    server = await startPhoneIngestServer({ ...deps, port: 0, bind: '127.0.0.1' });
    const h = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(h.status).toBe(200);
    expect(await h.text()).toContain('phone ingest');
    await fetch(`http://127.0.0.1:${server.port}/phone/notify?token=${TOKEN}&text=hello`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 50));
    expect(lines.join('')).not.toContain(TOKEN);
  });
});

describe('設定驗證', () => {
  it('沒有 target 又沒開 phone_ingest 時 fail fast，開了就允許無瀏覽器運作', async () => {
    const { parseConfigObject } = await import('../../src/config/load.js');
    expect(() => parseConfigObject({ targets: [] })).toThrow(/phone_ingest\.enabled/);
    const c = parseConfigObject({ targets: [], phone_ingest: { enabled: true } });
    expect(c.targets).toHaveLength(0);
    expect(c.phone_ingest.port).toBe(8800);
    expect(c.phone_ingest.allowed_packages).toContain('com.facebook.katana');
  });
});
