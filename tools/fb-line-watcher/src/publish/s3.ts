import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomToken } from '../util/hash.js';
import type { ImagePublisher, PublishedImage, PublishOptions } from './publisher.js';

export interface S3PublisherOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  keyPrefix: string;
  acl: 'none' | 'public-read';
  forcePathStyle: boolean;
  /** 測試用 */
  client?: S3Client;
}

/** Cloudflare R2／AWS S3／MinIO 等 S3 相容儲存 */
export class S3Publisher implements ImagePublisher {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly baseUrl: string;

  constructor(private readonly opts: S3PublisherOptions) {
    this.client =
      opts.client ??
      new S3Client({
        region: opts.region,
        endpoint: opts.endpoint,
        forcePathStyle: opts.forcePathStyle,
        credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      });
    this.baseUrl = opts.publicBaseUrl.replace(/\/+$/, '');
  }

  private key(now: Date, suffix: string): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const prefix = this.opts.keyPrefix.replace(/^\/+/, '');
    return `${prefix}${y}/${m}/${randomToken(16)}${suffix}.jpg`;
  }

  async publish(original: Buffer, preview: Buffer, opts: PublishOptions): Promise<PublishedImage | null> {
    const oKey = this.key(opts.now, '');
    const pKey = this.key(opts.now, '_p');
    const acl = this.opts.acl === 'public-read' ? ('public-read' as const) : undefined;
    const common = { Bucket: this.opts.bucket, ContentType: 'image/jpeg', CacheControl: 'private, max-age=86400', ACL: acl };
    await this.client.send(new PutObjectCommand({ ...common, Key: oKey, Body: original }));
    await this.client.send(new PutObjectCommand({ ...common, Key: pKey, Body: preview }));
    return { originalUrl: `${this.baseUrl}/${oKey}`, previewUrl: `${this.baseUrl}/${pKey}`, expiresAt: opts.expiresAtIso, objectKeys: [oKey, pKey] };
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: objectKey }));
  }
}
