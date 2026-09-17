import http from 'node:http';
import path from 'node:path';
import { renameSync, writeFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../storage/db.js';
import type { PhoneIngestConfig } from '../config/schema.js';
import type { Logger } from '../logger.js';
import { randomToken, sha256Hex } from '../util/hash.js';
import { ensureDir } from '../util/fs.js';
import { InvalidImageError, validateImage } from '../util/image.js';
import { parseRequestTarget } from '../util/http-target.js';
import { matchesAuthorRule } from '../util/text.js';
import { toFileStamp, toLocalDate } from '../util/time.js';

export interface PhoneNotification {
  title?: string;
  text: string;
  packageName?: string;
  postedLabel?: string;
  /** 手機端若能提供穩定識別碼就帶上；否則由內容推導 */
  clientKey?: string;
}

export type IngestOutcome =
  | { status: 'accepted'; occurrenceId: string; contentFingerprint: string; hasImage: boolean }
  | { status: 'duplicate'; contentFingerprint: string }
  | { status: 'filtered'; reason: string }
  | { status: 'rejected'; reason: string };

export interface PhoneIngestDeps {
  db: Db;
  config: PhoneIngestConfig;
  token: string;
  capturesDir: string;
  timezone: string;
  logger: Logger;
  now: () => Date;
  /** 有新通知進來時通知排程器（用於提早結束等待） */
  onAccepted?: (occurrenceId: string) => void;
  /** 覆寫監聽的 port／bind（測試用；正式運作讀 config） */
  port?: number;
  bind?: string;
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function matchesAny(patterns: string[], subject: string): boolean {
  return patterns.some((p) => {
    const m = /^\/(.+)\/([a-z]*)$/i.exec(p.trim());
    if (m) {
      try {
        return new RegExp(m[1] ?? '', m[2] ?? '').test(subject);
      } catch {
        return false;
      }
    }
    return subject.includes(p.trim());
  });
}

/**
 * 顯示用的通知文字：去除零寬字元、合併空白、丟掉空行。
 *
 * 刻意不做 NFKC——這段文字會原樣出現在 LINE 訊息裡，NFKC 會把中文全形標點
 * （例如「：」「，」）轉成半形，等於竄改了原文。正規化只留給比對用的 canonical 版本。
 */
export function normalizeNotificationText(raw: string): string {
  return raw
    .replace(/[\u200b-\u200d\ufeff\u2060]/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/[^\S\n]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

/** 比對用的正規化：在顯示版本之上再做 NFKC，讓全形／半形差異不會被當成不同通知 */
export function canonicalNotificationText(raw: string): string {
  return normalizeNotificationText(raw).normalize('NFKC');
}

/**
 * 內容指紋：只用來判斷「去重時間窗內是否為同一則通知」。
 *
 * Facebook 的通知會隨時間更新相對時間字串，但標題與內文本身穩定，
 * 因此只用 package + title + text，不含時間。
 *
 * 注意這**不是**事件識別碼。同一則內容在去重窗到期後再次發生時，
 * 指紋相同但屬於新的一次 occurrence，必須重新通知。
 */
export function deriveContentFingerprint(n: PhoneNotification): string {
  if (n.clientKey && n.clientKey.trim()) return sha256Hex(`phone|client|${n.clientKey.trim()}`);
  return sha256Hex(`phone|${n.packageName ?? ''}|${(n.title ?? '').normalize('NFKC').trim()}|${canonicalNotificationText(n.text)}`);
}

interface PhoneRow {
  occurrence_id: string;
  received_at: string;
  batched: number;
}

/**
 * 處理一則手機通知：套用套件／作者／內文過濾，去重，儲存截圖。
 * 回傳結果不含 HTTP 語意，方便測試。
 */
export function ingestNotification(deps: PhoneIngestDeps, n: PhoneNotification, image: Buffer | null): IngestOutcome {
  const cfg = deps.config;
  const text = normalizeNotificationText(n.text);
  const title = n.title?.trim() || undefined;

  // allowlist 必須 fail-closed：缺少 packageName 時不能放行，
  // 否則 MacroDroid 變數失效或呼叫端漏帶欄位就能繞過「只接受 Facebook App」的限制。
  if (cfg.allowed_packages.length) {
    if (!n.packageName) {
      if (!cfg.allow_missing_package) return { status: 'filtered', reason: 'package_missing' };
    } else if (!cfg.allowed_packages.includes(n.packageName)) {
      return { status: 'filtered', reason: `package_not_allowed:${n.packageName}` };
    }
  }
  if (!text && !title) return { status: 'rejected', reason: 'empty_notification' };

  const author = title ?? '';
  if (cfg.ignore_authors.length && matchesAny(cfg.ignore_authors, author)) {
    return { status: 'filtered', reason: 'author_ignored' };
  }
  if (cfg.notify_authors.length && !cfg.notify_authors.some((r) => matchesAuthorRule(author, r)) && !matchesAny(cfg.notify_authors, author)) {
    return { status: 'filtered', reason: 'author_not_in_allowlist' };
  }
  if (cfg.require_text_match.length && !matchesAny(cfg.require_text_match, `${title ?? ''}\n${text}`)) {
    return { status: 'filtered', reason: 'text_no_match' };
  }

  const contentFingerprint = deriveContentFingerprint({ ...n, text });
  const now = deps.now();
  const nowIso = now.toISOString();
  // 去重只看「同一指紋最近一次發生」是否落在時間窗內
  const recent = deps.db.get<PhoneRow>(
    'SELECT occurrence_id, received_at, batched FROM phone_notifications WHERE content_fingerprint = ? ORDER BY received_at DESC LIMIT 1',
    contentFingerprint,
  );
  if (recent) {
    const age = now.getTime() - Date.parse(recent.received_at);
    if (Number.isFinite(age) && age <= cfg.dedup_window_seconds * 1000) {
      return { status: 'duplicate', contentFingerprint };
    }
  }

  // 時間窗外（或第一次）＝ 一次新的 occurrence，事件鍵會不同，因此能再次送出
  const occurrenceId = `${contentFingerprint.slice(0, 16)}-${randomToken(8)}`;

  let imagePath: string | null = null;
  if (image && image.length > 0) {
    // 只檢查 magic bytes 不夠：垃圾資料前面補上 JPEG 標頭一樣會通過。
    // 這裡做真正的結構驗證，失敗就當成沒有截圖，但通知本身照常處理。
    try {
      const info = validateImage(image, { maxPixels: cfg.max_image_pixels });
      const dir = ensureDir(path.join(deps.capturesDir, 'phone', toLocalDate(now, deps.timezone)));
      const tmp = path.join(dir, `.tmp_${occurrenceId}${info.extension}`);
      const finalPath = path.join(dir, `${toFileStamp(now, deps.timezone)}_${occurrenceId}${info.extension}`);
      // 先寫暫存檔再 rename，避免半截檔案被後續流程讀到
      writeFileSync(tmp, image);
      renameSync(tmp, finalPath);
      imagePath = finalPath;
    } catch (e) {
      const why = e instanceof InvalidImageError ? e.message : String(e);
      deps.logger.warn({ bytes: image.length, why }, '手機上傳的資料不是有效圖片，已忽略截圖但保留通知文字');
    }
  }

  deps.db.run(
    `INSERT INTO phone_notifications (occurrence_id, content_fingerprint, title, body_text, package_name, posted_label, image_path, received_at, batched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    occurrenceId,
    contentFingerprint,
    title ?? null,
    text,
    n.packageName ?? null,
    n.postedLabel ?? null,
    imagePath,
    nowIso,
  );
  deps.logger.info({ occurrenceId, title, hasImage: !!imagePath, chars: text.length }, '收到手機通知');
  deps.onAccepted?.(occurrenceId);
  return { status: 'accepted', occurrenceId, contentFingerprint, hasImage: !!imagePath };
}

export interface PhoneIngestHandle {
  port: number;
  /** 測試用：跳過 HTTP 直接走同一段邏輯 */
  handle(token: string | undefined, n: PhoneNotification, image: Buffer | null): { status: number; outcome: IngestOutcome };
  close(): Promise<void>;
}

const OK_STATUS: Record<IngestOutcome['status'], number> = {
  accepted: 200,
  duplicate: 200,
  filtered: 200,
  rejected: 400,
};

export function startPhoneIngestServer(deps: PhoneIngestDeps): Promise<PhoneIngestHandle> {
  const handle = (token: string | undefined, n: PhoneNotification, image: Buffer | null): { status: number; outcome: IngestOutcome } => {
    if (!tokenMatches(token, deps.token)) {
      deps.logger.warn('手機上傳的 token 不正確，已拒絕');
      return { status: 401, outcome: { status: 'rejected', reason: 'unauthorized' } };
    }
    const outcome = ingestNotification(deps, n, image);
    return { status: OK_STATUS[outcome.status], outcome };
  };

  const failClosed = (res: http.ServerResponse, status: number, message: string): void => {
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    else res.destroy();
  };

  const server = http.createServer((req, res) => {
    try {
      const parsed = parseRequestTarget(req.url);
      if (!parsed) {
        failClosed(res, 400, 'bad request');
        return;
      }
      if (req.method === 'GET' && parsed.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('fb-line-watcher phone ingest OK');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('method not allowed');
        return;
      }
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > deps.config.max_image_bytes) {
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }).end('payload too large');
        req.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      let tooLarge = false;
      req.on('data', (c: Buffer) => {
        if (tooLarge) return;
        received += c.length;
        if (received > deps.config.max_image_bytes) {
          tooLarge = true;
          chunks.length = 0;
          failClosed(res, 413, 'payload too large');
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooLarge) return;
        try {
          const body = Buffer.concat(chunks);
          const q = (k: string): string | undefined => parsed.searchParams.get(k) ?? undefined;
          const token = (req.headers['x-phone-token'] as string | undefined) ?? q('token');
          // body 是原始圖片位元組（MacroDroid 不支援 multipart）。
          // 這裡不做 magic bytes 預判，交給 ingestNotification 的完整結構驗證處理。
          const maybeImage = body.length > 0 ? body : null;
          const result = handle(
            token,
            {
              title: q('title'),
              text: q('text') ?? q('body') ?? '',
              packageName: q('pkg') ?? q('package'),
              postedLabel: q('posted'),
              clientKey: q('key'),
            },
            maybeImage,
          );
          res
            .writeHead(result.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
            .end(
              result.outcome.status === 'accepted' || result.outcome.status === 'duplicate'
                ? result.outcome.status
                : `${result.outcome.status}:${'reason' in result.outcome ? result.outcome.reason : ''}`,
            );
        } catch (e) {
          deps.logger.warn({ err: e }, '手機接收伺服器處理請求時發生例外');
          failClosed(res, 500, 'error');
        }
      });
    } catch (e) {
      deps.logger.warn({ err: e }, '手機接收伺服器處理請求時發生例外');
      failClosed(res, 500, 'error');
    }
  });
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const listenPort = deps.port ?? deps.config.port;
    const listenBind = deps.bind ?? deps.config.bind;
    server.listen(listenPort, listenBind, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : listenPort;
      deps.logger.info({ port, bind: listenBind }, '手機通知接收伺服器已啟動');
      resolve({
        port,
        handle,
        close: () =>
          new Promise<void>((r) => {
            // keep-alive 連線會讓 close() 一直等到閒置逾時
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}
