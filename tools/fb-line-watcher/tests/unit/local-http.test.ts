import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { Writable } from 'node:stream';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalHttpPublisher, safeDecodeRequestName } from '../../src/publish/local-http.js';
import { createLogger } from '../../src/logger.js';
import { TINY_JPEG, tinyPng } from '../../fixtures/images.js';

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

let dir: string;
let pub: LocalHttpPublisher;

/** 用 node:http 直接送出原始 request target，fetch() 會先幫我們把畸形路徑正規化掉 */
function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string; contentType?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: rawPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, contentType: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'fblw-http-'));
  pub = new LocalHttpPublisher({ publicDir: dir, port: 0, bind: '127.0.0.1', publicBaseUrl: 'https://img.example.test', logger: createLogger({ stream: sink, level: 'error' }) });
  await pub.start();
});

afterEach(async () => {
  await pub.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('safeDecodeRequestName', () => {
  it('畸形百分比序列回 null 而不是丟例外', () => {
    // 驗證報告的重現路徑
    expect(safeDecodeRequestName('/%E0%A4%A')).toBeNull();
    expect(safeDecodeRequestName('/%')).toBeNull();
    expect(safeDecodeRequestName('/%zz')).toBeNull();
    expect(safeDecodeRequestName('/%C0%80%')).toBeNull();
  });
  it('正常路徑去掉前導斜線與 query', () => {
    expect(safeDecodeRequestName('/abc.jpg?x=1')).toBe('abc.jpg');
    expect(safeDecodeRequestName('///abc.jpg')).toBe('abc.jpg');
    expect(safeDecodeRequestName(undefined)).toBe('');
  });
});

/**
 * 回歸（P0）：舊版直接呼叫 decodeURIComponent，URIError 從 request callback 逸出，
 * 整個 watcher 程序會以 exit code 1 結束——任何連得到這個 port 的裝置都能讓服務停擺。
 */
describe('本機圖片伺服器：畸形請求不能讓程序結束', () => {
  it('畸形百分比路徑回 400，且不會產生 uncaughtException', async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown): void => {
      uncaught.push(e);
    };
    process.on('uncaughtException', onUncaught);
    try {
      for (const p of ['/%E0%A4%A', '/%', '/%zz', '/%C0%80%', '/%FF%FE%']) {
        expect((await rawGet(pub.port, p)).status).toBe(400);
      }
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      process.off('uncaughtException', onUncaught);
    }
    expect(uncaught).toEqual([]);
  });

  it('畸形請求之後伺服器仍然正常提供圖片', async () => {
    await rawGet(pub.port, '/%E0%A4%A');
    const img = await pub.publish(TINY_JPEG, TINY_JPEG, { expiresAtIso: null, originalExtension: '.jpg', previewExtension: '.jpg' });
    const name = new URL(img!.originalUrl).pathname.slice(1);
    const res = await rawGet(pub.port, `/${name}`);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('image/jpeg');
  });

  it('不存在的檔案回 404、非 GET/HEAD 回 405、目錄穿越回 404', async () => {
    expect((await rawGet(pub.port, `/${'a'.repeat(32)}.jpg`)).status).toBe(404);
    expect((await rawGet(pub.port, '/../../etc/passwd')).status).toBe(404);
    expect((await rawGet(pub.port, '/%2e%2e%2fetc%2fpasswd')).status).toBe(404);
    expect((await rawGet(pub.port, '/')).status).toBe(404);
    const res = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: pub.port, method: 'POST', path: '/x.jpg' }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(res).toBe(405);
  });
});

/**
 * 回歸（P1）：PNG 過去被存成 .jpg 且一律宣告 image/jpeg。
 */
describe('本機圖片伺服器：副檔名與 Content-Type 必須一致', () => {
  it('PNG 以 .png 發布並回 image/png，JPEG 回 image/jpeg', async () => {
    const png = tinyPng();
    const img = await pub.publish(png, png, { expiresAtIso: null, originalExtension: '.png', previewExtension: '.png' });
    expect(img!.originalUrl).toMatch(/\.png$/);
    expect(img!.previewUrl).toMatch(/_p\.png$/);
    for (const url of [img!.originalUrl, img!.previewUrl]) {
      const res = await rawGet(pub.port, `/${new URL(url).pathname.slice(1)}`);
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('image/png');
    }
    const jpg = await pub.publish(TINY_JPEG, TINY_JPEG, { expiresAtIso: null, originalExtension: '.jpg', previewExtension: '.jpg' });
    expect((await rawGet(pub.port, `/${new URL(jpg!.originalUrl).pathname.slice(1)}`)).contentType).toBe('image/jpeg');
  });

  it('原圖與預覽圖可以是不同格式', async () => {
    const img = await pub.publish(tinyPng(), TINY_JPEG, { expiresAtIso: null, originalExtension: '.png', previewExtension: '.jpg' });
    expect((await rawGet(pub.port, `/${new URL(img!.originalUrl).pathname.slice(1)}`)).contentType).toBe('image/png');
    expect((await rawGet(pub.port, `/${new URL(img!.previewUrl).pathname.slice(1)}`)).contentType).toBe('image/jpeg');
    expect(readdirSync(dir)).toHaveLength(2);
  });
});
