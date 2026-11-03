/**
 * 時間工具：所有對外顯示與資料庫時間一律使用設定的時區（預設 Asia/Taipei），
 * 格式為 ISO 8601 含時差，例如 2026-09-03T10:32:45+08:00。
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

interface Parts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  offset: string;
}

function parts(date: Date, timeZone: string): Parts {
  const p = formatter(timeZone).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes): string => p.find((x) => x.type === t)?.value ?? '';
  let offset = get('timeZoneName'); // e.g. GMT+08:00 or GMT
  offset = offset.replace('GMT', '');
  if (offset === '') offset = '+00:00';
  if (/^[+-]\d{2}$/.test(offset)) offset = `${offset}:00`;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    offset,
  };
}

/** ISO 8601 含時差，例如 2026-09-03T10:32:45+08:00 */
export function toIsoWithOffset(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.offset}`;
}

/** 給人看的格式：2026-09-03 10:32:45 */
export function toHuman(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 檔名安全的時間戳：20260903T103245+0800 */
export function toFileStamp(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}${p.offset.replace(':', '')}`;
}

/** 當地日期 YYYY-MM-DD（用於每日額度與資料夾） */
export function toLocalDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 當地小時 0-23 */
export function localHour(date: Date, timeZone: string): number {
  return Number(parts(date, timeZone).hour);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export class Clock {
  constructor(private readonly offsetMs = 0) {}
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
}

/** 測試可注入的時鐘 */
export interface ClockLike {
  now(): Date;
}

export const systemClock: ClockLike = { now: () => new Date() };

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
