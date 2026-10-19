import { PNG } from 'pngjs';

export type ImageFormat = 'jpeg' | 'png';

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  extension: '.jpg' | '.png';
  contentType: 'image/jpeg' | 'image/png';
}

export class InvalidImageError extends Error {}

export interface ValidateOptions {
  /** 最大像素數（寬 × 高），防止解壓縮炸彈 */
  maxPixels?: number;
  maxWidth?: number;
  maxHeight?: number;
}

const DEFAULTS: Required<ValidateOptions> = { maxPixels: 40_000_000, maxWidth: 20_000, maxHeight: 20_000 };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 只看開頭幾個 magic bytes 不足以判斷是不是有效圖片——一段垃圾資料前面加上
 * FF D8 FF E0 就會被當成 JPEG。這裡改成走真正的結構驗證：
 *
 * - PNG：先從 IHDR 讀尺寸並通過上限檢查，才呼叫 pngjs 解碼
 * - JPEG：逐段走 marker，SOF 段落長度必須自洽，必須走到 SOS 且其後有 entropy 資料
 *
 * 驗證失敗一律丟 InvalidImageError，呼叫端不得把資料寫進 captures。
 */
export function validateImage(buf: Buffer, opts: ValidateOptions = {}): ImageInfo {
  const o = { ...DEFAULTS, ...opts };
  if (buf.length < 16) throw new InvalidImageError('資料太短，不可能是有效圖片');

  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) {
    const ihdr = readPngIhdr(buf);
    checkSize(ihdr.width, ihdr.height, o);
    let png: PNG;
    try {
      png = PNG.sync.read(buf);
    } catch (e) {
      throw new InvalidImageError(`PNG 解碼失敗：${e instanceof Error ? e.message : String(e)}`);
    }
    if (png.width !== ihdr.width || png.height !== ihdr.height) {
      throw new InvalidImageError(`PNG 解碼尺寸與 IHDR 不符：${png.width}x${png.height} vs ${ihdr.width}x${ihdr.height}`);
    }
    return { format: 'png', width: png.width, height: png.height, extension: '.png', contentType: 'image/png' };
  }

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const { width, height } = parseJpeg(buf);
    checkSize(width, height, o);
    return { format: 'jpeg', width, height, extension: '.jpg', contentType: 'image/jpeg' };
  }

  throw new InvalidImageError('不是 JPEG 或 PNG');
}

/** PNG 簽名 8 bytes + length 4 + type 4 + width 4 + height 4 = 24 bytes 才能讀 IHDR 尺寸 */
function readPngIhdr(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24) throw new InvalidImageError('PNG IHDR 不完整');
  const type = buf.subarray(12, 16).toString('ascii');
  if (type !== 'IHDR') throw new InvalidImageError('PNG 第一個 chunk 不是 IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) throw new InvalidImageError(`PNG 尺寸不合法：${width}x${height}`);
  return { width, height };
}

function checkSize(width: number, height: number, o: Required<ValidateOptions>): void {
  if (width <= 0 || height <= 0) throw new InvalidImageError(`圖片尺寸不合法：${width}x${height}`);
  if (width > o.maxWidth || height > o.maxHeight) throw new InvalidImageError(`圖片尺寸超過上限：${width}x${height}`);
  if (width * height > o.maxPixels) throw new InvalidImageError(`圖片像素數超過上限：${width * height}`);
}

/** 走 JPEG 的 marker 段落；必須同時看到 SOF 與 SOS＋entropy，才回傳尺寸 */
function parseJpeg(buf: Buffer): { width: number; height: number } {
  let offset = 2; // 跳過 SOI
  let width = 0;
  let height = 0;
  let sawSof = false;
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) throw new InvalidImageError(`JPEG 結構錯誤：位移 ${offset} 不是 marker 起始`);
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) throw new InvalidImageError('JPEG 在 marker 中途結束');
    const marker = buf[offset]!;
    offset++;

    if (marker === 0xd9) {
      throw new InvalidImageError(sawSof ? 'JPEG 在 SOS／影像資料之前就結束' : 'JPEG 在取得尺寸前就結束');
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (offset + 2 > buf.length) throw new InvalidImageError('JPEG 段落長度欄位越界');
    const length = buf.readUInt16BE(offset);
    if (length < 2) throw new InvalidImageError(`JPEG 段落長度不合法：${length}`);
    if (offset + length > buf.length) throw new InvalidImageError('JPEG 段落長度超過檔案大小');

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOF 至少 8 bytes：length(2) + precision(1) + height(2) + width(2) + components(1)
      if (length < 8) throw new InvalidImageError(`JPEG SOF 段落長度不合法：${length}`);
      height = buf.readUInt16BE(offset + 3);
      width = buf.readUInt16BE(offset + 5);
      sawSof = true;
    } else if (marker === 0xda) {
      if (!sawSof) throw new InvalidImageError('JPEG 在 SOF 之前就出現 SOS');
      const entropyStart = offset + length;
      if (entropyStart >= buf.length) throw new InvalidImageError('JPEG 沒有影像資料');
      return { width, height };
    }
    offset += length;
  }
  if (sawSof) throw new InvalidImageError('JPEG 有 SOF 但沒有 SOS／影像資料');
  throw new InvalidImageError('JPEG 讀完仍未找到 SOF 段落');
}

/** 由副檔名推得 Content-Type；未知副檔名回 null，呼叫端應拒絕提供 */
export function contentTypeForExtension(ext: string): 'image/jpeg' | 'image/png' | null {
  const e = ext.toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  return null;
}
