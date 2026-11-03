export interface LinePushResult {
  ok: boolean;
  status: number;
  retryable: boolean;
  duplicate: boolean;
  body: string;
  retryAfterMs?: number;
}

export interface LineClientOptions {
  accessToken: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 極簡 LINE Messaging API client（只用到 push 與 bot info）。
 * 使用 X-Line-Retry-Key 讓重試冪等：同一個 key 24 小時內重送會得到 409，視為已成功。
 */
export class LineClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: LineClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.line.me').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async push(to: string, messages: unknown[], retryKey: string): Promise<LinePushResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v2/bot/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.accessToken}`,
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({ to, messages }),
        signal: ctrl.signal,
      });
      const body = await res.text().catch(() => '');
      if (res.ok) return { ok: true, status: res.status, retryable: false, duplicate: false, body };
      if (res.status === 409) return { ok: true, status: 409, retryable: false, duplicate: true, body };
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        return { ok: false, status: 429, retryable: true, duplicate: false, body, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined };
      }
      if (res.status >= 500) return { ok: false, status: res.status, retryable: true, duplicate: false, body };
      return { ok: false, status: res.status, retryable: false, duplicate: false, body };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e);
      return { ok: false, status: 0, retryable: true, duplicate: false, body: msg };
    } finally {
      clearTimeout(timer);
    }
  }

  async botInfo(): Promise<{ ok: boolean; status: number; body: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v2/bot/info`, { headers: { Authorization: `Bearer ${this.opts.accessToken}` }, signal: ctrl.signal });
      return { ok: res.ok, status: res.status, body: await res.text().catch(() => '') };
    } catch (e) {
      return { ok: false, status: 0, body: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const LINE_TEXT_LIMIT = 5000;
