/** 字串截斷（以 code point 計），超過時加 … */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** 使用者設定的作者比對：純文字（去頭尾空白後完全相等）或 /regex/flags */
export function matchesAuthorRule(author: string | undefined, rule: string): boolean {
  if (!author) return false;
  const m = /^\/(.+)\/([a-z]*)$/i.exec(rule.trim());
  if (m) {
    try {
      return new RegExp(m[1] ?? '', m[2] ?? '').test(author);
    } catch {
      return false;
    }
  }
  return author.trim() === rule.trim();
}
