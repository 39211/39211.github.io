import http from 'node:http';
import { promises as fs, createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '../logger.js';
import { ensureDir } from '../util/fs.js';
import { randomToken } from '../util/hash.js';
import type { ImagePublisher, PublishedImage, PublishOptions } from './publisher.js';

export interface LocalHttpOptions {
  publicDir: string;
  port: number;
  bind: string;
  publicBaseUrl: string;
  logger: Logger;
}

const NAME_RE = /^[a-f0-9]{32}(_p)?\.jpg$/;

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
      const name = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/').replace(/^\/+/, '');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      if (!NAME_RE.test(name)) {
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
            'Content-Type': 'image/jpeg',
            'Content-Length': st.size,
            'Cache-Control': 'private, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow',
          });
          if (req.method === 'HEAD') return res.end();
          createReadStream(file).pipe(res);
        })
        .catch(() => res.writeHead(500).end());
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.opts.port, this.opts.bind, () => resolve());
    });
    this.opts.logger.info({ port: this.port, bind: this.opts.bind }, '本機圖片伺服器已啟動');
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
  }

  async publish(original: Buffer, preview: Buffer, opts: PublishOptions): Promise<PublishedImage | null> {
    const token = randomToken(16);
    const o = `${token}.jpg`;
    const p = `${token}_p.jpg`;
    await fs.writeFile(path.join(this.opts.publicDir, o), original);
    await fs.writeFile(path.join(this.opts.publicDir, p), preview);
    return { originalUrl: `${this.baseUrl}/${o}`, previewUrl: `${this.baseUrl}/${p}`, expiresAt: opts.expiresAtIso, objectKeys: [o, p] };
  }

  async delete(objectKey: string): Promise<void> {
    if (!NAME_RE.test(objectKey)) return;
    await fs.unlink(path.join(this.opts.publicDir, objectKey)).catch(() => undefined);
  }
}
