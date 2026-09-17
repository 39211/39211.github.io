import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger } from '../logger.js';

export function verifyLineSignature(body: Buffer, signature: string | undefined, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', channelSecret).update(body).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface LineSourceInfo {
  eventType: string;
  sourceType: string;
  groupId?: string;
  roomId?: string;
  userId?: string;
  text?: string;
}

export interface IdsServerOptions {
  port: number;
  bind?: string;
  channelSecret?: string;
  logger: Logger;
  onEvent: (info: LineSourceInfo) => void;
}

/**
 * 一次性的 webhook 接收器：把 LINE 官方帳號加入群組後，LINE 會送 join／message 事件到這裡，
 * 我們只印出 groupId／userId，不做其他事。需要搭配 HTTPS Tunnel 讓 LINE 連得到。
 */
export function startLineIdsServer(opts: IdsServerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('fb-line-watcher webhook receiver OK');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (opts.channelSecret && !verifyLineSignature(body, req.headers['x-line-signature'] as string | undefined, opts.channelSecret)) {
        opts.logger.warn('收到簽章不符的 webhook 請求，已忽略');
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200).end();
      try {
        const parsed = JSON.parse(body.toString('utf8') || '{}') as { events?: { type: string; source?: { type: string; groupId?: string; roomId?: string; userId?: string }; message?: { type: string; text?: string } }[] };
        for (const ev of parsed.events ?? []) {
          opts.onEvent({
            eventType: ev.type,
            sourceType: ev.source?.type ?? 'unknown',
            groupId: ev.source?.groupId,
            roomId: ev.source?.roomId,
            userId: ev.source?.userId,
            text: ev.message?.type === 'text' ? ev.message.text : undefined,
          });
        }
      } catch {
        opts.logger.warn('webhook body 不是合法 JSON');
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.bind ?? '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}
