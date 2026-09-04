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

/**
 * 只看開頭幾個 magic bytes 不足以判斷是不是有效圖片——一段垃圾資料前面加上
 * FF D8 FF E0 就會被當成 JPEG。這裡改成走真正的結構驗證：
 *
 * - PNG：用 pngjs 實際解碼（會驗 CRC 與 IHDR）
 * - JPEG：逐段走 marker，確認長度欄位不越界、找得到 SOF 取得尺寸、且有影像資料
 *
 * 驗證失敗一律丟 InvalidImageError，呼叫端不得把資料寫進 captures。
 */
export function validateImage(buf: Buffer, opts: ValidateOptions = {}): ImageInfo {
  const o = { ...DEFAULTS, ...opts };
  if (buf.length < 16) throw new InvalidImageError('資料太短，不可能是有效圖片');

  const isPng = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (isPng) {
    let png: PNG;
    try {
      png = PNG.sync.read(buf);
    } catch (e) {
      throw new InvalidImageError(`PNG 解碼失敗：${e instanceof Error ? e.message : String(e)}`);
    }
    checkSize(png.width, png.height, o);
    return { format: 'png', width: png.width, height: png.height, extension: '.png', contentType: 'image/png' };
  }

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const { width, height } = parseJpeg(buf);
    checkSize(width, height, o);
    return { format: 'jpeg', width, height, extension: '.jpg', contentType: 'image/jpeg' };
  }

  throw new InvalidImageError('不是 JPEG 或 PNG');
}

function checkSize(width: number, height: number, o: Required<ValidateOptions>): void {
  if (width <= 0 || height <= 0) throw new InvalidImageError(`圖片尺寸不合法：${width}x${height}`);
  if (width > o.maxWidth || height > o.maxHeight) throw new InvalidImageError(`圖片尺寸超過上限：${width}x${height}`);
  if (width * height > o.maxPixels) throw new InvalidImageError(`圖片像素數超過上限：${width * height}`);
}

/** 走 JPEG 的 marker 段落，回傳 SOF 中的尺寸；結構不合法即丟出 */
function parseJpeg(buf: Buffer): { width: number; height: number } {
  let offset = 2; // 跳過 SOI
  let sawEntropyData = false;
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) throw new InvalidImageError(`JPEG 結構錯誤：位移 ${offset} 不是 marker 起始`);
    // 連續的 0xff 是允許的填充
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) throw new InvalidImageError('JPEG 在 marker 中途結束');
    const marker = buf[offset]!;
    offset++;

    if (marker === 0xd9) {
      // EOI
      if (!sawEntropyData) throw new InvalidImageError('JPEG 沒有影像資料');
      throw new InvalidImageError('JPEG 在取得尺寸前就結束');
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // 無長度欄位

    if (offset + 2 > buf.length) throw new InvalidImageError('JPEG 段落長度欄位越界');
    const length = buf.readUInt16BE(offset);
    if (length < 2) throw new InvalidImageError(`JPEG 段落長度不合法：${length}`);
    if (offset + length > buf.length) throw new InvalidImageError('JPEG 段落長度超過檔案大小');

    // SOF0-SOF15，排除 DHT(c4)、JPG(c8)、DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 7 > buf.length) throw new InvalidImageError('JPEG SOF 段落不完整');
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      return { width, height };
    }
    if (marker === 0xda) {
      // SOS 之後是 entropy-coded 資料，尺寸應該已在先前的 SOF 取得
      sawEntropyData = true;
      throw new InvalidImageError('JPEG 在 SOF 之前就出現 SOS');
    }
    offset += length;
  }
  throw new InvalidImageError('JPEG 讀完仍未找到 SOF 段落');
}

/** 由副檔名推得 Content-Type；未知副檔名回 null，呼叫端應拒絕提供 */
export function contentTypeForExtension(ext: string): 'image/jpeg' | 'image/png' | null {
  const e = ext.toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  return null;
}
