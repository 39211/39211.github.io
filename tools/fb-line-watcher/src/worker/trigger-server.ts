import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import type { Logger } from '../logger.js';
import { truncate } from '../util/text.js';

export interface TriggerRequest {
  /** 誰觸發的（MacroDroid 會帶 app 名稱或自訂字串） */
  source: string;
  /** 只巡邏這個 target；省略＝全部 */
  targetKey?: string;
  /** 手機通知的文字，只用於日誌與診斷，不會影響偵測結果 */
  text?: string;
  remoteAddress?: string;
}

export type TriggerVerdict = 'accepted' | 'throttled';

/**
 * 請求 body 的位元組上限。body 只用來傳幾個短參數（source/target/text），
 * 8 KiB 綽綽有餘；超過就直接回 413 並中斷連線，不把資料留在記憶體。
 */
export const MAX_BODY_BYTES = 8 * 1024;

export interface TriggerServerOptions {
  port: number;
  bind: string;
  token: string;
  /** 兩次接受之間至少間隔幾毫秒；期間內的觸發回 throttled（不會排隊塞爆） */
  minIntervalMs: number;
  logger: Logger;
  now?: () => number;
  onTrigger: (req: TriggerRequest) => void;
}

export interface TriggerServerHandle {
  port: number;
  /** 測試用：不經過 HTTP 直接走同一段判斷邏輯 */
  handle(token: string | undefined, req: TriggerRequest): { status: number; verdict?: TriggerVerdict; message: string };
  close(): Promise<void>;
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // 長度不同時仍做一次比較，避免用回應時間推測長度
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * 觸發伺服器：手機收到 Facebook 通知時打這個網址，watcher 立刻巡邏一次。
 *
 * 這樣就不必每 3 分鐘固定重新載入 Facebook；平常幾乎不連線，只在真的有新內容時才開頁面，
 * 行為更接近「收到通知才去看」的真人，也大幅降低被要求安全驗證的機率。
 *
 * 只綁在家用區域網路，並以固定長度的隨機 token 驗證。
 */
export function startTriggerServer(opts: TriggerServerOptions): Promise<TriggerServerHandle> {
  const now = opts.now ?? (() => Date.now());
  let lastAcceptedAt = 0;

  const handle = (token: string | undefined, req: TriggerRequest): { status: number; verdict?: TriggerVerdict; message: string } => {
    if (!tokenMatches(token, opts.token)) {
      opts.logger.warn({ remote: req.remoteAddress }, '觸發請求的 token 不正確，已拒絕');
      return { status: 401, message: 'unauthorized' };
    }
    const elapsed = now() - lastAcceptedAt;
    if (lastAcceptedAt !== 0 && elapsed < opts.minIntervalMs) {
      const waitSec = Math.ceil((opts.minIntervalMs - elapsed) / 1000);
      opts.logger.debug({ source: req.source, waitSec }, '觸發過於頻繁，本次略過（上一輪巡邏已涵蓋）');
      return { status: 200, verdict: 'throttled', message: `throttled; next accepted in ${waitSec}s` };
    }
    lastAcceptedAt = now();
    opts.logger.info({ source: req.source, target: req.targetKey ?? 'all', hint: req.text ? truncate(req.text, 80) : undefined }, '收到手機觸發，立即巡邏');
    opts.onTrigger(req);
    return { status: 200, verdict: 'accepted', message: 'accepted' };
  };

  const server = http.createServer((httpReq, httpRes) => {
    const url = new URL(httpReq.url ?? '/', 'http://trigger.local');
    if (httpReq.method !== 'GET' && httpReq.method !== 'POST') {
      httpRes.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('method not allowed');
      return;
    }
    const declared = Number(httpReq.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      httpRes.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }).end('payload too large');
      httpReq.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let tooLarge = false;
    httpReq.on('data', (c: Buffer) => {
      if (tooLarge) return;
      receivedBytes += c.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        httpRes.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }).end('payload too large');
        httpReq.destroy();
        return;
      }
      chunks.push(c);
    });
    httpReq.on('end', () => {
      if (tooLarge) return;
      let body: Record<string, unknown> = {};
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      const pick = (k: string): string | undefined => {
        const q = url.searchParams.get(k);
        if (q) return q;
        const v = body[k];
        return typeof v === 'string' ? v : undefined;
      };
      const token = (httpReq.headers['x-trigger-token'] as string | undefined) ?? pick('token');
      const result = handle(token, {
        source: pick('source') ?? 'unknown',
        targetKey: pick('target'),
        text: pick('text'),
        remoteAddress: httpReq.socket.remoteAddress ?? undefined,
      });
      httpRes.writeHead(result.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(result.message);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.bind, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      opts.logger.info({ port, bind: opts.bind, minIntervalMs: opts.minIntervalMs }, '觸發伺服器已啟動（等待手機通知）');
      resolve({ port, handle, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

/** 找出這台電腦在家用網路上的 IPv4 位址，用來組出手機要打的網址 */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}
