import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 刪除目錄底下 mtime 早於 cutoff 的檔案，回傳刪除數量；空的子目錄也一併清掉 */
export function removeFilesOlderThan(dir: string, cutoff: Date, opts: { recursive?: boolean } = {}): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (opts.recursive) {
        removed += removeFilesOlderThan(full, cutoff, opts);
        try {
          if (readdirSync(full).length === 0) rmdirSync(full);
        } catch {
          /* ignore */
        }
      }
      continue;
    }
    if (st.mtime < cutoff) {
      try {
        unlinkSync(full);
        removed++;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}
