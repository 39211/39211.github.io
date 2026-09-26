/** 有上限的指數退避排程（毫秒）。attempt 從 1 開始。 */
export function backoffMs(attempt: number, schedule: number[]): number | null {
  if (attempt < 1) return schedule[0] ?? null;
  if (attempt > schedule.length) return null;
  return schedule[attempt - 1] ?? null;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超過 ${ms} ms 未完成（timeout）`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
