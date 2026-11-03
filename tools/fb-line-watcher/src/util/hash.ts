import { createHash, randomBytes } from 'node:crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 由任意字串決定性地產生 UUID（v4 格式），用於 LINE X-Line-Retry-Key */
export function uuidFromKey(key: string): string {
  const h = createHash('sha256').update(key).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // version 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 不可猜測的檔名亂數（32 hex） */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

export function shortHash(input: string, len = 12): string {
  return sha256Hex(input).slice(0, len);
}
