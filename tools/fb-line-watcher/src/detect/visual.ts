import { PNG } from 'pngjs';
import type { VisualBaselineRow } from '../storage/repo.js';

const W = 17;
const H = 16;

/** 由 PNG 計算 256-bit dHash（16x16 相鄰像素亮度比較），回傳 64 個 hex 字元 */
export function dhashFromPng(buf: Buffer): string {
  const png = PNG.sync.read(buf);
  const gray = downscaleGray(png.data, png.width, png.height, W, H);
  const bits: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = gray[y * W + x] ?? 0;
      const b = gray[y * W + x + 1] ?? 0;
      bits.push(a > b ? 1 : 0);
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const v = ((bits[i] ?? 0) << 3) | ((bits[i + 1] ?? 0) << 2) | ((bits[i + 2] ?? 0) << 1) | (bits[i + 3] ?? 0);
    hex += v.toString(16);
  }
  return hex;
}

function downscaleGray(data: Buffer, w: number, h: number, tw: number, th: number): Float64Array {
  const out = new Float64Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          n++;
        }
      }
      out[ty * tw + tx] = n ? sum / n : 0;
    }
  }
  return out;
}

export function hammingDistance(aHex: string, bHex: string): number {
  const n = Math.min(aHex.length, bHex.length);
  let d = Math.abs(aHex.length - bHex.length) * 4;
  for (let i = 0; i < n; i++) {
    let x = parseInt(aHex[i] ?? '0', 16) ^ parseInt(bHex[i] ?? '0', 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export type VisualDecision =
  | { action: 'INIT' }
  | { action: 'NONE'; distance: number }
  | { action: 'DROP_PENDING'; distance: number }
  | { action: 'PENDING'; distance: number; replacePending: boolean }
  | { action: 'CONFIRMED'; distance: number; pendingDistance: number };

export interface VisualDecisionOptions {
  /** 與 baseline 差異超過此值才算有變化 */
  threshold: number;
  /** 第二次取樣至少要在 pending 建立後多少毫秒 */
  confirmAfterMs: number;
  /** 兩次新樣本之間允許的差異（畫面已穩定） */
  similarTolerance: number;
}

/**
 * 視覺降級模式的雙重取樣判定：
 * 1. 與 baseline 差異不大 → 無事（若有 pending 則丟棄，屬短暫變動）
 * 2. 差異大且沒有 pending → 記為 pending
 * 3. 差異大且已有 pending：兩次新圖彼此相近且已過確認時間 → CONFIRMED；否則更新 pending 繼續等
 */
export function decideVisual(baseline: VisualBaselineRow | undefined, currentHash: string, nowMs: number, opts: VisualDecisionOptions): VisualDecision {
  if (!baseline) return { action: 'INIT' };
  const distance = hammingDistance(baseline.dhash, currentHash);
  if (distance <= opts.threshold) {
    return baseline.pending_dhash ? { action: 'DROP_PENDING', distance } : { action: 'NONE', distance };
  }
  if (!baseline.pending_dhash || !baseline.pending_since) return { action: 'PENDING', distance, replacePending: true };
  const pendingDistance = hammingDistance(baseline.pending_dhash, currentHash);
  const elapsed = nowMs - Date.parse(baseline.pending_since);
  if (pendingDistance <= opts.similarTolerance) {
    if (elapsed >= opts.confirmAfterMs) return { action: 'CONFIRMED', distance, pendingDistance };
    return { action: 'PENDING', distance, replacePending: false };
  }
  return { action: 'PENDING', distance, replacePending: true };
}
