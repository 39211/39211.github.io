import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { InvalidImageError, contentTypeForExtension, validateImage } from '../../src/util/image.js';
import { ingestNotification } from '../../src/worker/phone-ingest.js';
import { Db } from '../../src/storage/db.js';
import { PhoneIngestSchema } from '../../src/config/schema.js';
import { createLogger } from '../../src/logger.js';
import { Writable } from 'node:stream';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import { FAKE_JPEG, FAKE_PNG, JPEG_EMPTY_SOF, JPEG_HEADER_ONLY, PNG_BOMB_HEADER, TINY_JPEG, TRUNCATED_JPEG, tinyPng } from '../../fixtures/images.js';

/**
 * 回歸（P1）：舊版只檢查 magic bytes，驗證報告用 204 bytes 的假 JPEG
 * （FF D8 FF E0 + 垃圾）就通過檢查並寫進 captures。
 */
describe('validateImage', () => {
  it('接受真正可解碼的 JPEG，回報實際尺寸與 MIME', () => {
    expect(validateImage(TINY_JPEG)).toEqual({ format: 'jpeg', width: 8, height: 8, extension: '.jpg', contentType: 'image/jpeg' });
  });

  it('接受真正可解碼的 PNG，且不會被謊報成 JPEG', () => {
    expect(validateImage(tinyPng(16, 9))).toEqual({ format: 'png', width: 16, height: 9, extension: '.png', contentType: 'image/png' });
  });

  it('只有 JPEG magic bytes 的假圖被拒絕（驗證報告的重現樣本）', () => {
    expect(FAKE_JPEG.length).toBe(204);
    expect(FAKE_JPEG.subarray(0, 4).toString('hex')).toBe('ffd8ffe0');
    expect(() => validateImage(FAKE_JPEG)).toThrow(InvalidImageError);
  });

  it('只有 PNG magic bytes 的假圖被拒絕', () => {
    expect(() => validateImage(FAKE_PNG)).toThrow(InvalidImageError);
  });

  it('截斷的 JPEG 被拒絕', () => {
    expect(() => validateImage(TRUNCATED_JPEG)).toThrow(InvalidImageError);
  });

  it('太短、空白與非圖片資料被拒絕', () => {
    expect(() => validateImage(Buffer.alloc(0))).toThrow(InvalidImageError);
    expect(() => validateImage(Buffer.from('not an image'))).toThrow(InvalidImageError);
    expect(() => validateImage(Buffer.from('<html><body>login</body></html>'))).toThrow(InvalidImageError);
  });

  it('像素數與邊長上限可設定（解壓炸彈防護）', () => {
    expect(() => validateImage(tinyPng(64, 64), { maxPixels: 100 })).toThrow(InvalidImageError);
    expect(() => validateImage(tinyPng(64, 64), { maxWidth: 32 })).toThrow(InvalidImageError);
    expect(() => validateImage(tinyPng(64, 64), { maxHeight: 32 })).toThrow(InvalidImageError);
    expect(validateImage(tinyPng(64, 64), { maxPixels: 100_000 }).width).toBe(64);
  });

  it('副檔名與 Content-Type 一一對應，未知副檔名回 null', () => {
    expect(contentTypeForExtension('.jpg')).toBe('image/jpeg');
    expect(contentTypeForExtension('.JPG')).toBe('image/jpeg');
    expect(contentTypeForExtension('.png')).toBe('image/png');
    expect(contentTypeForExtension('.gif')).toBeNull();
    expect(contentTypeForExtension('')).toBeNull();
  });

  it('專案內附的真實截圖樣本全部能通過驗證', () => {
    const dir = path.resolve('docs/samples');
    const files = ['01_new_post_with_image.jpg', '02_edited_post.jpg', '03_group_new_comments_and_reply.jpg', '04_degraded_visual_change.jpg'].filter((f) => existsSync(path.join(dir, f)));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const info = validateImage(readFileSync(path.join(dir, f)));
      expect(info.format).toBe('jpeg');
      expect(info.width).toBeGreaterThan(100);
    }
  });
});

describe('validateImage：解碼前上限與 JPEG 完整性（WO-012）', () => {
  it('PNG_BOMB_HEADER（68 bytes、IHDR 20000×20000）在 100ms 內拒絕，不得進入解碼', () => {
    expect(PNG_BOMB_HEADER.length).toBe(68);
    const t0 = Date.now();
    expect(() => validateImage(PNG_BOMB_HEADER)).toThrow(InvalidImageError);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('JPEG_EMPTY_SOF 與 JPEG_HEADER_ONLY 被拒絕', () => {
    expect(() => validateImage(JPEG_EMPTY_SOF)).toThrow(InvalidImageError);
    expect(() => validateImage(JPEG_HEADER_ONLY)).toThrow(InvalidImageError);
  });

  it('IHDR 宣告與實際解碼尺寸不符 → InvalidImageError', async () => {
    const { PNG } = await import('pngjs');
    const orig = PNG.sync.read;
    PNG.sync.read = (() => ({ width: 99, height: 99, data: Buffer.alloc(0) })) as typeof PNG.sync.read;
    try {
      expect(() => validateImage(tinyPng(8, 8))).toThrow(InvalidImageError);
    } finally {
      PNG.sync.read = orig;
    }
  });

  it('PNG_BOMB_HEADER 走 ingestNotification → 無截圖落地', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fblw-bomb-'));
    const db = new Db(':memory:');
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    try {
      const r = ingestNotification(
        {
          db,
          config: PhoneIngestSchema.parse({ enabled: true }),
          token: 'p'.repeat(32),
          capturesDir: dir,
          timezone: 'Asia/Taipei',
          logger: createLogger({ stream: sink, level: 'error' }),
          now: () => new Date('2026-09-05T00:00:00+08:00'),
        },
        { title: 'A', text: 'bomb', packageName: 'com.facebook.katana' },
        PNG_BOMB_HEADER,
      );
      expect(r).toMatchObject({ status: 'accepted', hasImage: false });
      expect(readdirSync(dir, { recursive: true }).filter((n) => String(n).endsWith('.png') || String(n).endsWith('.jpg'))).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
