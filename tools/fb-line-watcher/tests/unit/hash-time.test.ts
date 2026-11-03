import { describe, expect, it } from 'vitest';
import { sha256Hex, uuidFromKey } from '../../src/util/hash.js';
import { toHuman, toIsoWithOffset, toLocalDate } from '../../src/util/time.js';
import { backoffMs, withTimeout } from '../../src/util/retry.js';
import { matchesAuthorRule } from '../../src/util/text.js';

describe('hash utils', () => {
  it('uuidFromKey 決定性且符合 UUID v4 格式', () => {
    const a = uuidFromKey('event|dest');
    expect(a).toBe(uuidFromKey('event|dest'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromKey('other')).not.toBe(a);
  });
  it('sha256Hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('time utils', () => {
  it('Asia/Taipei ISO 含時差', () => {
    const d = new Date('2026-09-03T02:32:45Z');
    expect(toIsoWithOffset(d, 'Asia/Taipei')).toBe('2026-09-03T10:32:45+08:00');
    expect(toHuman(d, 'Asia/Taipei')).toBe('2026-09-03 10:32:45');
    expect(toLocalDate(new Date('2026-09-03T17:00:00Z'), 'Asia/Taipei')).toBe('2026-09-04');
  });
});

describe('retry utils', () => {
  it('backoff 有上限', () => {
    const s = [5, 30, 120];
    expect(backoffMs(1, s)).toBe(5);
    expect(backoffMs(3, s)).toBe(120);
    expect(backoffMs(4, s)).toBeNull();
  });
  it('withTimeout 逾時會拒絕', async () => {
    await expect(withTimeout(new Promise((r) => setTimeout(r, 200)), 20, 'x')).rejects.toThrow(/timeout/);
  });
});

describe('matchesAuthorRule', () => {
  it('純文字精確比對與正規表達式', () => {
    expect(matchesAuthorRule('林大明', '林大明 ')).toBe(true);
    expect(matchesAuthorRule('林大明', '林')).toBe(false);
    expect(matchesAuthorRule('林大明', '/^林/')).toBe(true);
    expect(matchesAuthorRule(undefined, '林大明')).toBe(false);
  });
});
