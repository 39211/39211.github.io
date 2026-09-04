import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { InvalidImageError, contentTypeForExtension, validateImage } from '../../src/util/image.js';
import { FAKE_JPEG, FAKE_PNG, TINY_JPEG, TRUNCATED_JPEG, tinyPng } from '../../fixtures/images.js';

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
