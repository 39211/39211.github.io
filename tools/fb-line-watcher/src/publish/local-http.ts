import http from 'node:http';
import { promises as fs, createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '../logger.js';
import { ensureDir } from '../util/fs.js';
import { randomToken } from '../util/hash.js';
import type { ImagePublisher, PublishedImage, PublishOptions } from './publisher.js';
import { contentTypeForExtension } from '../util/image.js';

export interface LocalHttpOptions {
  publicDir: string;
  port: number;
  bind: string;
  publicBaseUrl: string;
  logger: Logger;
}

const NAME_RE = /^[a-f0-9]{32}(_p)?\.(jpg|png)$/;

/**
 * 安全地取出 request target 的檔名部分。
 *
 * decodeURIComponent 遇到畸形百分比序列（例如 /%E0%A4%A）會丟 URIError；
 * 過去這個例外直接從 request callback 逸出，會讓整個 watcher 程序以 exit 1 結束——
 * 任何連得到這個 port 的裝置都能藉此讓服務停擺。這裡把解析包起來，失敗回 null。
 */
export function safeDecodeRequestName(rawUrl: string | undefined): string | null {
  try {
    const pathPart = (rawUrl ?? '/').split('?')[0] ?? '/';
    return decodeURIComponent(pathPart).replace(/^\/+/, '');
  } catch {
    return null;
  }
}

/**
 * 本機小型 HTTP 圖片伺服器。只提供不可猜測檔名的 JPEG，不列目錄。
 * 使用者需以自己的 HTTPS Tunnel（例如 cloudflared）把它對外，並把網址填到 PUBLIC_BASE_URL。
 */
export class LocalHttpPublisher implements ImagePublisher {
  readonly name = 'local_http' as const;
  private server?: http.Server;
  private readonly baseUrl: string;

  constructor(private readonly opts: LocalHttpOptions) {
    ensureDir(opts.publicDir);
    this.baseUrl = opts.publicBaseUrl.replace(/\/+$/, '');
  }

  get port(): number {
    const addr = this.server?.address();
    return typeof addr === 'object' && addr ? addr.port : this.opts.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      // 這個 callback 內絕對不能讓例外逸出，否則整個程序會結束
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('method not allowed');
          return;
        }
        const name = safeDecodeRequestName(req.url);
        if (name === null) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('bad request');
          return;
        }
        if (!NAME_RE.test(name)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
          return;
        }
        const contentType = contentTypeForExtension(path.extname(name));
        if (!contentType) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
          return;
        }
        const file = path.join(this.opts.publicDir, name);
        if (!existsSync(file)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
          return;
        }
        fs.stat(file)
          .then((st) => {
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Length': st.size,
              'Cache-Control': 'private, max-age=86400',
              'X-Content-Type-Options': 'nosniff',
              'X-Robots-Tag': 'noindex, nofollow',
            });
            if (req.method === 'HEAD') return res.end();
            const stream = createReadStream(file);
            stream.on('error', () => res.destroy());
            stream.pipe(res);
          })
          .catch(() => {
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('error');
          });
      } catch (e) {
        this.opts.logger.warn({ err: e }, '圖片伺服器處理請求時發生例外');
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('error');
        else res.destroy();
      }
    });
    // 連線層的錯誤（例如客戶端中斷）同樣不能讓程序結束
    this.server.on('clientError', (_err, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      else socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.opts.port, this.opts.bind, () => resolve());
    });
    this.opts.logger.info({ port: this.port, bind: this.opts.bind }, '本機圖片伺服器已啟動');
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    // keep-alive 連線會讓 close() 一直等到閒置逾時；關機時不該被卡住
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
  }

  async publish(original: Buffer, preview: Buffer, opts: PublishOptions): Promise<PublishedImage | null> {
    const token = randomToken(16);
    const o = `${token}${opts.originalExtension ?? '.jpg'}`;
    const p = `${token}_p${opts.previewExtension ?? '.jpg'}`;
    await fs.writeFile(path.join(this.opts.publicDir, o), original);
    await fs.writeFile(path.join(this.opts.publicDir, p), preview);
    return { originalUrl: `${this.baseUrl}/${o}`, previewUrl: `${this.baseUrl}/${p}`, expiresAt: opts.expiresAtIso, objectKeys: [o, p] };
  }

  async delete(objectKey: string): Promise<void> {
    if (!NAME_RE.test(objectKey)) return;
    await fs.unlink(path.join(this.opts.publicDir, objectKey)).catch(() => undefined);
  }
}
