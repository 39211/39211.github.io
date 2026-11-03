import { describe, expect, it } from 'vitest';
import { normalizeText, redactPii, textPrefix } from '../../src/extract/normalize.js';
import { DEFAULT_CATALOG } from '../../src/adapters/catalog.js';

describe('normalizeText', () => {
  const noise = DEFAULT_CATALOG.uiNoisePatterns;
  it('移除 UI 文案、相對時間與反應數，並合併空白', () => {
    const raw = '  今天　天氣很好 \n\n讚\n回覆\n3 分鐘\n全部心情：12\n15 則留言\n查看更多\n第二行   內容\n第二行   內容';
    expect(normalizeText(raw, noise)).toBe('今天 天氣很好\n第二行 內容');
  });
  it('NFKC 正規化全形字元', () => {
    expect(normalizeText('ＡＢＣ１２３', noise)).toBe('ABC123');
  });
  it('「查看更多」差異不影響結果', () => {
    const a = normalizeText('很長的內文…\n查看更多', noise);
    const b = normalizeText('很長的內文…', noise);
    expect(a).toBe(b);
  });
});

describe('redactPii', () => {
  it('遮蔽台灣手機、市話與 email', () => {
    const s = '請洽 0912-345-678 或 04-2345-6789，信箱 test.user+1@example.com.tw';
    const r = redactPii(s, { phone: true, email: true });
    expect(r).not.toMatch(/0912/);
    expect(r).not.toMatch(/2345-6789/);
    expect(r).not.toMatch(/example\.com/);
    expect(r).toContain('[電話已遮蔽]');
    expect(r).toContain('[email 已遮蔽]');
  });
  it('關閉時不變', () => {
    expect(redactPii('0912-345-678', { phone: false, email: false })).toBe('0912-345-678');
  });
});

describe('textPrefix', () => {
  it('以字元數截斷並加上省略號', () => {
    expect(textPrefix('一二三四五六', 3)).toBe('一二三…');
    expect(textPrefix('短', 3)).toBe('短');
  });
});
