import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Db } from '../storage/db.js';
import type { AppConfig } from '../config/schema.js';
import type { Logger } from '../logger.js';
import { LINE_TEXT_LIMIT, type LineClient } from './client.js';
import { recordPublished, type ImagePublisher } from '../publish/publisher.js';
import {
  getBudgetCount,
  getOrCreateDelivery,
  incrementBudget,
  insertEvent,
  listDueDeliveries,
  recordAlert,
  setEventStatus,
  updateDelivery,
  type DeliveryRow,
  type EventRow,
} from '../storage/repo.js';
import type { EventDraft, EventPayload, SystemAlertPayload } from '../events.js';
import { addSeconds, toHuman, toIsoWithOffset, toLocalDate, type ClockLike } from '../util/time.js';
import { sha256Hex, uuidFromKey } from '../util/hash.js';
import { redactPii, textPrefix } from '../extract/normalize.js';
import { summarizeItems } from '../detect/groups.js';
import { backoffMs, errorMessage } from '../util/retry.js';

export interface NotifierCore {
  db: Db;
  config: AppConfig;
  logger: Logger;
  clock: ClockLike;
  destinationId: string;
}

export interface NotifierDeps extends NotifierCore {
  client: LineClient;
  publisher: ImagePublisher;
  onEventSent?: (event: EventRow, payload: EventPayload) => void;
}

export interface DeliveryStats {
  processed: number;
  sent: number;
  retried: number;
  dead: number;
  suppressed: number;
}

const UNCOUNTED_KINDS = new Set(['SYSTEM_ALERT', 'HEALTH_SUMMARY', 'TEST']);

export function destinationHash(destinationId: string): string {
  return sha256Hex(destinationId).slice(0, 16);
}

/** 建立事件與對應的 delivery 列（同一 event_key 只會建立一次） */
export function enqueueEvent(core: NotifierCore, draft: EventDraft): boolean {
  const now = toIsoWithOffset(core.clock.now(), core.config.timezone);
  const inserted = insertEvent(
    core.db,
    {
      event_key: draft.eventKey,
      target_key: draft.targetKey,
      entity_key: draft.entityKey,
      event_type: draft.payload.kind,
      detection_mode: draft.detectionMode,
      detected_at: now,
      payload_json: JSON.stringify(draft.payload),
      screenshot_path: draft.screenshotPath,
      preview_path: draft.previewPath,
      status: 'PENDING',
    },
    now,
  );
  const dh = destinationHash(core.destinationId);
  getOrCreateDelivery(core.db, draft.eventKey, 'line', dh, uuidFromKey(`${draft.eventKey}|${dh}`));
  return inserted;
}

/**
 * 記錄系統警報並在需要時排入 LINE 通知（同一 alertKey 有冷卻時間）。
 * 回傳是否有排入通知。
 */
export function raiseAlert(
  core: NotifierCore,
  a: { alertKey: string; severity: 'INFO' | 'WARN' | 'ERROR'; targetKey?: string; targetName?: string; message: string; cooldownMs?: number },
): boolean {
  const now = core.clock.now();
  const nowIso = toIsoWithOffset(now, core.config.timezone);
  const cooldown = a.cooldownMs ?? core.config.line.system_alert_cooldown_minutes * 60 * 1000;
  const { notify } = recordAlert(core.db, { alertKey: a.alertKey, severity: a.severity, targetKey: a.targetKey ?? null, message: a.message }, nowIso, cooldown);
  core.logger[a.severity === 'ERROR' ? 'error' : 'warn']({ alertKey: a.alertKey, targetKey: a.targetKey, notify }, a.message);
  if (!notify) return false;
  const payload: SystemAlertPayload = { kind: 'SYSTEM_ALERT', severity: a.severity, alertKey: a.alertKey, targetKey: a.targetKey, targetName: a.targetName, message: a.message, detectedAt: nowIso };
  enqueueEvent(core, {
    eventKey: sha256Hex(`alert|${a.alertKey}|${nowIso}`),
    targetKey: a.targetKey ?? '_system',
    entityKey: null,
    detectionMode: 'SYSTEM',
    payload,
    screenshotPath: null,
    previewPath: null,
  });
  return true;
}

function humanTime(iso: string, tz: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : toHuman(d, tz);
}

export function formatEventText(payload: EventPayload, config: AppConfig, opts: { screenshotNote?: string } = {}): string {
  const tz = config.timezone;
  const red = (s: string): string => redactPii(s, { phone: config.privacy.redact_phone, email: config.privacy.redact_email });
  const lines: string[] = [];
  switch (payload.kind) {
    case 'NEW_POST':
    case 'EDITED_POST': {
      lines.push(payload.kind === 'NEW_POST' ? '【Facebook 新貼文】' : '【Facebook 貼文已編輯】');
      lines.push(`來源：${payload.targetName}`);
      lines.push(`作者：${payload.author ?? '（未辨識）'}`);
      lines.push(`時間：${payload.timeTitle ?? payload.timeLabel ?? '（未辨識）'}`);
      if (payload.kind === 'EDITED_POST' && payload.previousText !== undefined) lines.push(`原文摘要：${textPrefix(red(payload.previousText), 80) || '（無文字）'}`);
      lines.push(`${payload.kind === 'EDITED_POST' ? '新內容' : '摘要'}：${textPrefix(red(payload.text), 120) || '（無文字）'}`);
      lines.push(`媒體：${payload.mediaSummary}`);
      lines.push(`偵測信心：${payload.confidence.toFixed(2)}${payload.lowConfidence ? '（低信心，已二次確認）' : ''}`);
      lines.push(`完整性：${payload.completeness}`);
      lines.push(`偵測時間：${humanTime(payload.detectedAt, tz)}`);
      lines.push(payload.permalink ?? payload.sourceUrl);
      break;
    }
    case 'NEW_COMMENTS': {
      lines.push(payload.targetType === 'facebook_group' ? '【Facebook 社團有新對話】' : '【Facebook 粉專有新留言】');
      lines.push(`來源：${payload.targetName}`);
      lines.push(`事件：${summarizeItems(payload.items)}`);
      lines.push(`父貼文：${payload.post.author ? `${payload.post.author}：` : ''}${red(payload.post.textPrefix) || '（無文字）'}`);
      for (const it of payload.items.slice(-3)) {
        lines.push(`${it.isReply ? '↳ 回覆' : '留言'} ${it.author ?? '（未辨識）'}：${textPrefix(red(it.text), 60) || '（圖片／貼圖）'}`);
      }
      if (payload.items.length > 3) lines.push(`…共 ${payload.items.length} 則，詳見截圖`);
      lines.push(`完整性：${payload.completeness}${payload.completeness === 'PARTIAL_EXPANSION' ? '（部分留言未完整展開）' : ''}`);
      lines.push(`偵測時間：${humanTime(payload.detectedAt, tz)}`);
      lines.push(payload.sourceUrl);
      break;
    }
    case 'PHONE_NOTIFICATION': {
      const n = payload.items.length + payload.omittedCount;
      lines.push(n === 1 ? '【Facebook 手機通知】' : `【Facebook 手機通知 ${n} 則】`);
      for (const it of payload.items) {
        const who = it.title ? `${it.title}：` : '';
        lines.push(`・${who}${textPrefix(red(it.text), 100) || '（無文字）'}${it.hasImage ? '（附截圖）' : ''}`);
      }
      if (payload.omittedCount > 0) lines.push(`…另有 ${payload.omittedCount} 則未列出`);
      lines.push(`偵測時間：${humanTime(payload.detectedAt, tz)}`);
      lines.push('來源：手機 Facebook App 通知（非網頁巡邏）');
      break;
    }
    case 'VISUAL_CHANGE': {
      lines.push('【Facebook 畫面有變化】');
      lines.push(`來源：${payload.targetName}`);
      lines.push('偵測模式：DEGRADED_VISUAL_MODE');
      lines.push(`原因：${payload.reason}`);
      lines.push('語意類型：UNKNOWN_VISUAL_CHANGE（無法判斷是哪一則貼文或留言）');
      lines.push(`畫面差異值：${payload.distance}`);
      lines.push(`偵測時間：${humanTime(payload.detectedAt, tz)}`);
      lines.push(payload.sourceUrl);
      break;
    }
    case 'SYSTEM_ALERT': {
      lines.push(`【fb-line-watcher 系統警報】${payload.severity}`);
      if (payload.targetName) lines.push(`目標：${payload.targetName}`);
      lines.push(payload.message);
      lines.push(`時間：${humanTime(payload.detectedAt, tz)}`);
      break;
    }
    case 'HEALTH_SUMMARY':
      lines.push(payload.text);
      break;
    case 'TEST':
      lines.push(payload.text);
      break;
  }
  if (opts.screenshotNote) lines.push(opts.screenshotNote);
  const text = lines.join('\n');
  return text.length > LINE_TEXT_LIMIT ? `${text.slice(0, LINE_TEXT_LIMIT - 1)}…` : text;
}

export function buildMessages(payload: EventPayload, config: AppConfig, urls: { original: string; preview: string } | null, screenshotPath: string | null, publisherName: string): unknown[] {
  const note = !urls && screenshotPath ? `截圖已存本機：${path.basename(screenshotPath)}${publisherName === 'none' ? '（未設定圖片主機，無法附圖）' : ''}` : undefined;
  const messages: unknown[] = [{ type: 'text', text: formatEventText(payload, config, { screenshotNote: note }) }];
  if (urls) messages.push({ type: 'image', originalContentUrl: urls.original, previewImageUrl: urls.preview });
  return messages;
}

function lineErrorHint(status: number, body: string): string {
  if (status === 401) return 'LINE_CHANNEL_ACCESS_TOKEN 無效或已撤銷，請到 LINE Developers 重新發行。';
  if (status === 400 && /to|invalid/i.test(body)) return '目的地 ID 可能不正確，或官方帳號已被移出群組。請重新執行 npm run get-line-ids。';
  if (status === 403) return '此 channel 沒有權限使用 push message，或方案不允許。';
  if (status === 429) return '已達 LINE 訊息額度或速率限制。';
  return '';
}

function deadLetter(deps: NotifierDeps, d: DeliveryRow, event: EventRow, error: string, nowIso: string): void {
  updateDelivery(deps.db, d.id, { status: 'DEAD_LETTER', last_error: error, attempts: d.attempts + 1 });
  setEventStatus(deps.db, event.event_key, 'DEAD_LETTER');
}

function scheduleRetry(deps: NotifierDeps, d: DeliveryRow, event: EventRow, error: string, now: Date, retryAfterMs?: number): 'retry' | 'dead' {
  const attempts = d.attempts + 1;
  const delay = retryAfterMs ?? backoffMs(attempts, deps.config.line.retry_schedule_seconds.map((s) => s * 1000));
  if (delay === null) {
    deadLetter(deps, d, event, `重試次數用盡：${error}`, toIsoWithOffset(now, deps.config.timezone));
    return 'dead';
  }
  updateDelivery(deps.db, d.id, {
    status: 'FAILED_RETRYABLE',
    attempts,
    last_error: error,
    next_attempt_at: toIsoWithOffset(new Date(now.getTime() + delay), deps.config.timezone),
  });
  return 'retry';
}

/** 處理所有到期的 delivery：發布圖片 → 推送 LINE → 更新狀態。冪等：同一 event 成功後不再發送。 */
export async function processDeliveries(deps: NotifierDeps): Promise<DeliveryStats> {
  const stats: DeliveryStats = { processed: 0, sent: 0, retried: 0, dead: 0, suppressed: 0 };
  const tz = deps.config.timezone;
  const now = deps.clock.now();
  const nowIso = toIsoWithOffset(now, tz);
  const today = toLocalDate(now, tz);
  const due = listDueDeliveries(deps.db, nowIso);
  for (const d of due) {
    stats.processed++;
    const event = d.event;
    if (event.status !== 'PENDING') {
      updateDelivery(deps.db, d.id, { status: event.status === 'SENT' ? 'SENT' : 'DEAD_LETTER', last_error: event.status === 'SENT' ? null : `event status ${event.status}` });
      continue;
    }
    let payload: EventPayload;
    try {
      payload = JSON.parse(event.payload_json) as EventPayload;
    } catch (e) {
      deadLetter(deps, d, event, `payload 無法解析：${errorMessage(e)}`, nowIso);
      stats.dead++;
      continue;
    }
    const counted = !UNCOUNTED_KINDS.has(payload.kind);
    if (counted && getBudgetCount(deps.db, today) >= deps.config.max_notifications_per_day) {
      setEventStatus(deps.db, event.event_key, 'SUPPRESSED');
      updateDelivery(deps.db, d.id, { status: 'DEAD_LETTER', last_error: 'daily notification budget exceeded' });
      stats.suppressed++;
      raiseAlert(deps, {
        alertKey: `budget:${today}`,
        severity: 'WARN',
        message: `今日通知已達上限 ${deps.config.max_notifications_per_day} 則，之後的內容事件今天不再發送（仍會記錄在本機）。可在 targets.yaml 調整 max_notifications_per_day。`,
        cooldownMs: 24 * 3600 * 1000,
      });
      continue;
    }

    let urls: { original: string; preview: string } | null = d.published_original_url && d.published_preview_url ? { original: d.published_original_url, preview: d.published_preview_url } : null;
    if (!urls && event.screenshot_path && deps.publisher.name !== 'none') {
      try {
        const original = await readFile(event.screenshot_path);
        const preview = event.preview_path ? await readFile(event.preview_path) : original;
        const expiresAtIso = toIsoWithOffset(addSeconds(now, deps.config.images.retention_hours * 3600), tz);
        const extOf = (p: string | null): '.jpg' | '.png' => (p && path.extname(p).toLowerCase() === '.png' ? '.png' : '.jpg');
        const pub = await deps.publisher.publish(original, preview, {
          ttlHours: deps.config.images.retention_hours,
          now,
          expiresAtIso,
          originalExtension: extOf(event.screenshot_path),
          previewExtension: extOf(event.preview_path ?? event.screenshot_path),
        });
        if (pub) {
          urls = { original: pub.originalUrl, preview: pub.previewUrl };
          updateDelivery(deps.db, d.id, { published_original_url: pub.originalUrl, published_preview_url: pub.previewUrl, published_expires_at: pub.expiresAt });
          recordPublished(deps.db, deps.publisher, pub, nowIso);
        }
      } catch (e) {
        const r = scheduleRetry(deps, d, event, `圖片發布失敗：${errorMessage(e)}`, now);
        deps.logger.warn({ eventKey: event.event_key, err: e }, '圖片發布失敗，稍後重試');
        if (r === 'dead') {
          stats.dead++;
          raiseAlert(deps, { alertKey: 'publish:failed', severity: 'ERROR', message: `圖片發布連續失敗，事件 ${event.event_key.slice(0, 12)} 已進入 dead-letter：${errorMessage(e)}` });
        } else stats.retried++;
        continue;
      }
    }

    const messages = buildMessages(payload, deps.config, urls, event.screenshot_path, deps.publisher.name);
    const res = await deps.client.push(deps.destinationId, messages, d.retry_key);
    if (res.ok) {
      updateDelivery(deps.db, d.id, { status: 'SENT', sent_at: nowIso, attempts: d.attempts + 1, last_error: res.duplicate ? 'duplicate retry key (already accepted)' : null });
      setEventStatus(deps.db, event.event_key, 'SENT');
      if (counted) incrementBudget(deps.db, today);
      stats.sent++;
      deps.logger.info({ eventKey: event.event_key, eventType: event.event_type, withImage: !!urls, duplicate: res.duplicate }, 'LINE 已送出');
      try {
        deps.onEventSent?.(event, payload);
      } catch (e) {
        deps.logger.warn({ err: e }, 'onEventSent 處理失敗');
      }
      continue;
    }
    const errText = `LINE ${res.status}: ${res.body.slice(0, 300)}`;
    if (res.retryable) {
      const r = scheduleRetry(deps, d, event, errText, now, res.retryAfterMs);
      if (r === 'dead') {
        stats.dead++;
        raiseAlert(deps, { alertKey: `line:retries_exhausted`, severity: 'ERROR', message: `LINE 發送重試次數用盡（${errText}）。${lineErrorHint(res.status, res.body)}` });
      } else {
        stats.retried++;
        deps.logger.warn({ eventKey: event.event_key, status: res.status }, 'LINE 暫時失敗，稍後重試');
      }
    } else {
      deadLetter(deps, d, event, errText, nowIso);
      stats.dead++;
      raiseAlert(deps, { alertKey: `line:permanent:${res.status}`, severity: 'ERROR', message: `LINE 發送被拒絕（${errText}）。${lineErrorHint(res.status, res.body)}` });
    }
  }
  return stats;
}
