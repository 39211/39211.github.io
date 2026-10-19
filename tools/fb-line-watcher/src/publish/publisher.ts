import type { Db } from '../storage/db.js';
import type { Logger } from '../logger.js';
import { insertPublishedImage, listExpiredPublishedImages, markPublishedImageDeleted } from '../storage/repo.js';

export interface PublishedImage {
  originalUrl: string;
  previewUrl: string;
  expiresAt: string;
  objectKeys: string[];
}

export interface PublishOptions {
  ttlHours: number;
  now: Date;
  expiresAtIso: string;
  /** 原圖與預覽圖的真實副檔名（'.jpg' 或 '.png'），發布器據此決定物件名稱與 Content-Type */
  originalExtension?: '.jpg' | '.png';
  previewExtension?: '.jpg' | '.png';
}

/**
 * 圖片發布器：LINE 只能顯示 LINE 伺服器可存取的公開 HTTPS 圖片，
 * 因此截圖必須先放到可公開讀取、檔名不可猜測、會到期清除的位置。
 */
export interface ImagePublisher {
  readonly name: 'none' | 'local_http' | 's3';
  start?(): Promise<void>;
  stop?(): Promise<void>;
  publish(original: Buffer, preview: Buffer, opts: PublishOptions): Promise<PublishedImage | null>;
  delete(objectKey: string): Promise<void>;
}

export class NonePublisher implements ImagePublisher {
  readonly name = 'none' as const;
  async publish(): Promise<PublishedImage | null> {
    return null;
  }
  async delete(): Promise<void> {
    /* nothing */
  }
}

export function recordPublished(db: Db, publisher: ImagePublisher, img: PublishedImage, now: string): void {
  for (const key of img.objectKeys) {
    insertPublishedImage(db, { publisher: publisher.name, objectKey: key, url: key === img.objectKeys[0] ? img.originalUrl : img.previewUrl, createdAt: now, expiresAt: img.expiresAt });
  }
}

/** 刪除已到期的公開圖片 */
export async function cleanupExpiredImages(db: Db, publisher: ImagePublisher, now: string, logger: Logger): Promise<number> {
  const rows = listExpiredPublishedImages(db, now);
  let n = 0;
  for (const r of rows) {
    if (r.publisher !== publisher.name) {
      // 換了發布器，舊物件無法刪，只標記
      markPublishedImageDeleted(db, r.id, now);
      continue;
    }
    try {
      await publisher.delete(r.object_key);
      markPublishedImageDeleted(db, r.id, now);
      n++;
    } catch (e) {
      logger.warn({ objectKey: r.object_key, err: e }, '刪除到期公開圖片失敗');
    }
  }
  return n;
}
