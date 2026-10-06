/**
 * 文字正規化：NFKC、移除零寬字元、合併空白、逐行去除純 UI 文案。
 * 反應數、留言數、相對時間不會進入 content hash（由 uiNoisePatterns 過濾）。
 */
export function normalizeText(raw: string, noisePatterns: string[]): string {
  const regs = noisePatterns.map((p) => new RegExp(p, 'i'));
  const out: string[] = [];
  for (const line of raw.normalize('NFKC').split(/\r?\n/)) {
    const l = line
      .replace(/[​-‍﻿⁠]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!l) continue;
    if (regs.some((r) => r.test(l))) continue;
    if (out.length && out[out.length - 1] === l) continue;
    out.push(l);
  }
  return out.join('\n');
}

export function textPrefix(text: string, n: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= n ? flat : `${chars.slice(0, n).join('')}…`;
}

export interface RedactOptions {
  phone: boolean;
  email: boolean;
}

/** 台灣手機／市話與 Email 的文字遮罩（用於 LINE 文字摘要） */
export function redactPii(text: string, opts: RedactOptions): string {
  let s = text;
  if (opts.email) s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email 已遮蔽]');
  if (opts.phone) {
    s = s.replace(/(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g, '[電話已遮蔽]');
    s = s.replace(/\b0[2-8][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[電話已遮蔽]');
    s = s.replace(/\b0800[-\s]?\d{3}[-\s]?\d{3}\b/g, '[電話已遮蔽]');
  }
  return s;
}

export const PII_REGEX_SOURCES = {
  phone: ['(?:\\+?886[-\\s]?|0)9\\d{2}[-\\s]?\\d{3}[-\\s]?\\d{3}', '\\b0[2-8][-\\s]?\\d{3,4}[-\\s]?\\d{4}\\b'],
  email: ['[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+'],
};
