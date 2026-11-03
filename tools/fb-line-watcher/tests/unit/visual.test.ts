import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { decideVisual, dhashFromPng, hammingDistance } from '../../src/detect/visual.js';
import type { VisualBaselineRow } from '../../src/storage/repo.js';

function image(fn: (x: number, y: number) => number): Buffer {
  const w = 200;
  const h = 120;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const i = (y * w + x) * 4;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  return PNG.sync.write(png);
}

const base = image((x, y) => ((x / 20 + y / 20) | 0) % 2 ? 230 : 40);
const tinyChange = image((x, y) => (x < 30 && y < 12 ? 128 : ((x / 20 + y / 20) | 0) % 2 ? 230 : 40)); // 類似「2 分鐘→3 分鐘」的小區域
const bigChange = image((x, y) => (y > 60 ? 200 - (x % 50) : ((x / 20 + y / 20) | 0) % 2 ? 230 : 40));

describe('dHash', () => {
  it('相同圖片距離 0，小區域變化距離小，大變化距離大', () => {
    const a = dhashFromPng(base);
    expect(a).toHaveLength(64);
    expect(hammingDistance(a, dhashFromPng(base))).toBe(0);
    const small = hammingDistance(a, dhashFromPng(tinyChange));
    const big = hammingDistance(a, dhashFromPng(bigChange));
    expect(small).toBeLessThanOrEqual(10);
    expect(big).toBeGreaterThan(20);
  });
});

describe('decideVisual 雙重取樣', () => {
  const baseline = (over: Partial<VisualBaselineRow> = {}): VisualBaselineRow => ({ target_key: 't', zone: 'viewport', dhash: dhashFromPng(base), image_path: 'x', updated_at: 'now', pending_dhash: null, pending_image_path: null, pending_since: null, ...over });
  const opts = { threshold: 10, confirmAfterMs: 30000, similarTolerance: 6 };
  const bigHash = dhashFromPng(bigChange);
  it('無 baseline → INIT；小變化 → NONE', () => {
    expect(decideVisual(undefined, bigHash, 0, opts).action).toBe('INIT');
    expect(decideVisual(baseline(), dhashFromPng(tinyChange), 0, opts).action).toBe('NONE');
  });
  it('大變化先 PENDING，時間不足時繼續等待，時間到且穩定 → CONFIRMED', () => {
    const t0 = Date.parse('2026-09-03T10:00:00+08:00');
    expect(decideVisual(baseline(), bigHash, t0, opts)).toMatchObject({ action: 'PENDING', replacePending: true });
    const pending = baseline({ pending_dhash: bigHash, pending_since: new Date(t0).toISOString() });
    expect(decideVisual(pending, bigHash, t0 + 5000, opts)).toMatchObject({ action: 'PENDING', replacePending: false });
    expect(decideVisual(pending, bigHash, t0 + 40000, opts).action).toBe('CONFIRMED');
  });
  it('變化消失 → DROP_PENDING；變化仍在改變 → 重設 pending', () => {
    const t0 = 1000;
    const pending = baseline({ pending_dhash: bigHash, pending_since: new Date(t0).toISOString() });
    expect(decideVisual(pending, dhashFromPng(base), t0 + 40000, opts).action).toBe('DROP_PENDING');
    const other = dhashFromPng(image(() => 10));
    expect(decideVisual(pending, other, t0 + 40000, opts)).toMatchObject({ action: 'PENDING', replacePending: true });
  });
});
