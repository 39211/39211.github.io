import http from 'node:http';

export interface RecordedPush {
  at: number;
  status: number;
  retryKey?: string;
  authorization?: string;
  body: { to?: string; messages?: { type: string; text?: string; originalContentUrl?: string; previewImageUrl?: string }[] };
}

export interface MockLineServer {
  port: number;
  baseUrl: string;
  /** 所有收到的 push 請求（含失敗） */
  attempts: RecordedPush[];
  /** 成功接受（200）的 push */
  accepted: RecordedPush[];
  failNext(status: number, times?: number, headers?: Record<string, string>): void;
  reset(): void;
  close(): Promise<void>;
}

/** 模擬 LINE Messaging API：push、409 重複 retry key、可注入失敗 */
export async function startMockLine(): Promise<MockLineServer> {
  const attempts: RecordedPush[] = [];
  const accepted: RecordedPush[] = [];
  const seenKeys = new Set<string>();
  const failQueue: { status: number; headers?: Record<string, string> }[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'GET' && req.url === '/v2/bot/info') {
        if (!/^Bearer .+/.test(req.headers.authorization ?? '')) return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Authentication failed.' }));
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ displayName: 'mock-bot', userId: 'U0000', basicId: '@mock' }));
      }
      if (req.method === 'POST' && req.url === '/v2/bot/message/push') {
        let body: RecordedPush['body'] = {};
        try {
          body = JSON.parse(raw) as RecordedPush['body'];
        } catch {
          return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'invalid json' }));
        }
        const retryKey = req.headers['x-line-retry-key'] as string | undefined;
        const rec: RecordedPush = { at: Date.now(), status: 0, retryKey, authorization: req.headers.authorization, body };
        attempts.push(rec);
        if (!/^Bearer .{6,}/.test(req.headers.authorization ?? '')) {
          rec.status = 401;
          return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Authentication failed. Confirm that the access token in the authorization header is valid.' }));
        }
        const fail = failQueue.shift();
        if (fail) {
          rec.status = fail.status;
          return res.writeHead(fail.status, { 'Content-Type': 'application/json', ...(fail.headers ?? {}) }).end(JSON.stringify({ message: `mock failure ${fail.status}` }));
        }
        if (retryKey && seenKeys.has(retryKey)) {
          rec.status = 409;
          return res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'The retry key is already accepted for another request', sentMessages: [] }));
        }
        if (!body.to || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 5) {
          rec.status = 400;
          return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: "The property, 'to', in the request body is invalid (line: -, column: -)" }));
        }
        if (retryKey) seenKeys.add(retryKey);
        rec.status = 200;
        accepted.push(rec);
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sentMessages: body.messages.map((_, i) => ({ id: String(i), quoteToken: 'q' })) }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    attempts,
    accepted,
    failNext(status, times = 1, headers) {
      for (let i = 0; i < times; i++) failQueue.push({ status, headers });
    },
    reset() {
      attempts.length = 0;
      accepted.length = 0;
      seenKeys.clear();
      failQueue.length = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
