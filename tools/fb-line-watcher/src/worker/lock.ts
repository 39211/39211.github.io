import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../util/fs.js';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class LockHeldError extends Error {
  constructor(readonly pid: number, readonly lockPath: string) {
    super(`另一個 watcher（PID ${pid}）正在執行，本實例退出。若確定沒有其他實例，請刪除 ${lockPath}。`);
  }
}

/** 單實例鎖：避免兩個 watcher 同時運行造成重複發送 */
export function acquireSingleInstanceLock(lockPath: string, opts: { isAlive?: (pid: number) => boolean; pid?: number } = {}): { release(): void } {
  ensureDir(path.dirname(lockPath));
  const alive = opts.isAlive ?? isAlive;
  const myPid = opts.pid ?? process.pid;
  if (existsSync(lockPath)) {
    let other = NaN;
    try {
      other = Number(JSON.parse(readFileSync(lockPath, 'utf8')).pid);
    } catch {
      other = NaN;
    }
    if (Number.isFinite(other) && other !== myPid && alive(other)) throw new LockHeldError(other, lockPath);
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
  writeFileSync(lockPath, JSON.stringify({ pid: myPid, startedAt: new Date().toISOString() }), { flag: 'wx' });
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      const cur = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number };
      if (cur.pid === myPid) unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  };
  process.once('exit', release);
  return { release };
}
