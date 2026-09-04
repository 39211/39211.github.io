import { PNG } from 'pngjs';

/**
 * 真正可解碼的 8x8 baseline JPEG（Chromium 產生後移除 ICC profile，288 bytes）。
 * 測試不能用「只有 FF D8 FF 開頭」的假圖，那正是驗證報告抓到的漏洞。
 */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABcQAQADAAAAAAAAAAAAAAAAAAAWY6H/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8ATq7QAf/Z',
  'base64',
);

/** 真正可解碼的 PNG */
export function tinyPng(width = 8, height = 8): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height * 4; i += 4) {
    png.data[i] = 0xc8;
    png.data[i + 1] = 0x50;
    png.data[i + 2] = 0x3c;
    png.data[i + 3] = 0xff;
  }
  return PNG.sync.write(png);
}

/** 驗證報告的重現樣本：204 bytes，只有 JPEG magic bytes，其餘是垃圾 */
export const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x41)]);

/** 只有 PNG magic bytes，後面不是合法 chunk */
export const FAKE_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 0x42)]);

/** 合法開頭但中途截斷的 JPEG */
export const TRUNCATED_JPEG = TINY_JPEG.subarray(0, 120);
