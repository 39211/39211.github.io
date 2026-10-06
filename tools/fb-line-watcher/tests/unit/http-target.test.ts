import { describe, expect, it } from 'vitest';
import { parseRequestTarget } from '../../src/util/http-target.js';

describe('parseRequestTarget', () => {
  it('正常 origin-form 回 pathname 與 query', () => {
    const p = parseRequestTarget('/trigger?token=abc&source=phone');
    expect(p).not.toBeNull();
    expect(p!.pathname).toBe('/trigger');
    expect(p!.searchParams.get('token')).toBe('abc');
    expect(p!.searchParams.get('source')).toBe('phone');
  });

  it('空字串與 undefined 當成根路徑，不丟例外', () => {
    expect(parseRequestTarget(undefined)?.pathname).toBe('/');
    expect(parseRequestTarget('')?.pathname).toBe('/');
  });

  it('畸形 target 回 null，不丟例外', () => {
    for (const raw of ['//[', '//]', '//[::1', '//a%ZZ', '/\\', 'http://[']) {
      expect(parseRequestTarget(raw), raw).toBeNull();
    }
  });
});
