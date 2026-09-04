import path from 'node:path';
import type { App } from '../app.js';
import type { TargetConfig } from '../config/schema.js';
import { PageHolder, runTargetCycle, type CycleOptions, type CycleResult } from './target-worker.js';
import { enqueueEvent, processDeliveries, type DeliveryStats } from '../line/notifier.js';
import { cleanupExpiredImages } from '../publish/publisher.js';
import { deletePendingGroup, getTarget, kvGet, kvSet, listDuePendingGroups, updateTarget } from '../storage/repo.js';
import type { CommentsEventPayload, PhoneNotificationItem, PhoneNotificationPayload } from '../events.js';
import { addSeconds, localHour, sleep, toIsoWithOffset, toLocalDate } from '../util/time.js';
import { sha256Hex } from '../util/hash.js';
import { removeFilesOlderThan } from '../util/fs.js';
import { buildHealthReport, formatHealthReport, writeHealthFile } from './health.js';
import { errorMessage } from '../util/retry.js';

export interface CycleSummary {
  startedAt: string;
  results: CycleResult[];
  flushedGroups: number;
  deliveries: DeliveryStats;
  skipped: string[];
}

/** 把等待時間已到的留言合併群組轉成正式事件 */
export function flushDueGroups(app: App): number {
  const nowIso = toIsoWithOffset(app.clock.now(), app.config.timezone);
  let n = 0;
  for (const g of listDuePendingGroups(app.db, nowIso)) {
    try {
      const payload = JSON.parse(g.payload_json) as CommentsEventPayload;
      payload.detectedAt = nowIso;
      const itemKeys = payload.items.map((i) => i.entityKey).sort().join(',');
      const eventKey = sha256Hex(`${g.target_key}|COMMENTS|${g.root_post_key}|${itemKeys}`);
      enqueueEvent(app.notifier, { eventKey, targetKey: g.target_key, entityKey: g.root_post_key, detectionMode: 'STRUCTURED', payload, screenshotPath: g.screenshot_path, previewPath: g.preview_path });
      n++;
    } catch (e) {
      app.logger.error({ err: e, groupKey: g.group_key }, 'pending group 轉事件失敗，已丟棄');
    }
    deletePendingGroup(app.db, g.group_key);
  }
  return n;
}

interface PhoneRow {
  item_key: string;
  title: string | null;
  body_text: string;
  package_name: string | null;
  posted_label: string | null;
  image_path: string | null;
  received_at: string;
}

/**
 * 把尚未送出的手機通知合併成一則事件。
 *
 * debounce_seconds 內若還有新通知進來就繼續等，讓一串通知合成一則 LINE 訊息；
 * 設為 0 則每次都立即送出。
 */
export function flushPhoneNotifications(app: App, opts: { force?: boolean } = {}): number {
  const cfg = app.config.phone_ingest;
  if (!cfg.enabled) return 0;
  const rows = app.db.all<PhoneRow>('SELECT item_key, title, body_text, package_name, posted_label, image_path, received_at FROM phone_notifications WHERE batched = 0 ORDER BY received_at ASC');
  if (rows.length === 0) return 0;
  const now = app.clock.now();
  const newest = Math.max(...rows.map((r) => Date.parse(r.received_at)));
  if (!opts.force && cfg.debounce_seconds > 0 && now.getTime() - newest < cfg.debounce_seconds * 1000) return 0;

  const nowIso = toIsoWithOffset(now, app.config.timezone);
  const shown = rows.slice(0, cfg.max_items_per_message);
  const items: PhoneNotificationItem[] = shown.map((r) => ({
    itemKey: r.item_key,
    title: r.title ?? undefined,
    text: r.body_text,
    postedAtLabel: r.posted_label ?? undefined,
    packageName: r.package_name ?? undefined,
    hasImage: !!r.image_path,
  }));
  const payload: PhoneNotificationPayload = {
    kind: 'PHONE_NOTIFICATION',
    items,
    omittedCount: Math.max(0, rows.length - shown.length),
    firstDetectedAt: toIsoWithOffset(new Date(Date.parse(rows[0]!.received_at)), app.config.timezone),
    detectedAt: nowIso,
    source: 'phone',
  };
  // 一則 LINE 訊息只能帶一張圖，挑最後一則有截圖的
  const withImage = [...rows].reverse().find((r) => r.image_path);
  const eventKey = sha256Hex(`phone|${rows.map((r) => r.item_key).sort().join(',')}`);
  app.db.transaction(() => {
    enqueueEvent(app.notifier, {
      eventKey,
      targetKey: '_phone',
      entityKey: null,
      detectionMode: 'PHONE_NOTIFICATION',
      payload,
      screenshotPath: withImage?.image_path ?? null,
      previewPath: withImage?.image_path ?? null,
    });
    const placeholders = rows.map(() => '?').join(',');
    app.db.run(`UPDATE phone_notifications SET batched = 1 WHERE item_key IN (${placeholders})`, ...rows.map((r) => r.item_key));
  });
  app.logger.info({ items: rows.length, withImage: !!withImage }, '手機通知已合併並排入 LINE');
  return rows.length;
}

export async function runMaintenance(app: App): Promise<void> {
  const now = app.clock.now();
  const nowIso = toIsoWithOffset(now, app.config.timezone);
  try {
    const cutoff = addSeconds(now, -app.config.retention.local_capture_days * 86400);
    const removed = removeFilesOlderThan(app.capturesDir, cutoff, { recursive: true });
    if (removed) app.logger.info({ removed }, '已清理過期本機截圖');
    const logCutoff = addSeconds(now, -app.config.retention.log_days * 86400);
    removeFilesOlderThan(path.join(app.dataDir, 'logs'), logCutoff);
    const deleted = await cleanupExpiredImages(app.db, app.publisher, nowIso, app.logger);
    if (deleted) app.logger.info({ deleted }, '已刪除到期公開圖片');
  } catch (e) {
    app.logger.warn({ err: e }, '維護作業失敗');
  }
  try {
    writeHealthFile(buildHealthReport(app.db, app.config, app.clock), path.join(app.dataDir, 'health.json'));
  } catch (e) {
    app.logger.warn({ err: e }, '寫入 health.json 失敗');
  }
}

export function maybeEnqueueHealthSummary(app: App): boolean {
  if (!app.config.line.daily_health_summary) return false;
  const now = app.clock.now();
  const today = toLocalDate(now, app.config.timezone);
  if (localHour(now, app.config.timezone) < app.config.line.health_summary_hour) return false;
  if (kvGet(app.db, 'health_summary_day') === today) return false;
  const text = formatHealthReport(buildHealthReport(app.db, app.config, app.clock), app.config.timezone);
  enqueueEvent(app.notifier, { eventKey: sha256Hex(`health|${today}`), targetKey: '_system', entityKey: null, detectionMode: 'SYSTEM', payload: { kind: 'HEALTH_SUMMARY', text, detectedAt: toIsoWithOffset(now, app.config.timezone) }, screenshotPath: null, previewPath: null });
  kvSet(app.db, 'health_summary_day', today);
  return true;
}

/** 連續失敗後的退避：3 次以上開始跳過，最長 60 分鐘 */
function shouldSkipTarget(app: App, target: TargetConfig): string | null {
  const row = getTarget(app.db, target.key);
  if (!row) return null;
  if (row.next_check_at && Date.parse(row.next_check_at) > app.clock.now().getTime()) return `退避中，${row.next_check_at} 後再試`;
  return null;
}

function applyBackoff(app: App, target: TargetConfig, result: CycleResult): void {
  const row = getTarget(app.db, target.key);
  if (!row) return;
  if (result.status === 'READY' || result.status === 'DEGRADED') {
    if (row.next_check_at) updateTarget(app.db, target.key, { next_check_at: null });
    return;
  }
  const failures = row.consecutive_failures;
  if (failures >= 3) {
    const seconds = Math.min(3600, app.config.poll_interval_seconds * Math.pow(2, Math.min(6, failures - 2)));
    updateTarget(app.db, target.key, { next_check_at: toIsoWithOffset(addSeconds(app.clock.now(), seconds), app.config.timezone) });
    app.logger.warn({ target: target.key, failures, backoffSeconds: seconds }, 'target 連續失敗，進入退避');
  }
}

export interface PendingTrigger {
  reason: string;
  targetKey?: string;
  requestedAt: number;
}

export class Watcher {
  private readonly holders = new Map<string, PageHolder>();
  private stopped = false;
  private readonly abort = new AbortController();
  private cycles = 0;
  private pending: PendingTrigger | null = null;
  private wakeSignal: AbortController | null = null;

  constructor(private readonly app: App) {}

  /**
   * 要求立刻巡邏一次（手機通知觸發時呼叫）。
   * 只是設一個旗標並喚醒等待中的迴圈；實際巡邏仍在迴圈內依序執行，
   * 因此連續多次觸發不會造成同時開多個瀏覽器分頁。
   */
  requestImmediateCycle(reason: string, targetKey?: string): void {
    this.pending = { reason, targetKey, requestedAt: Date.now() };
    this.wakeSignal?.abort();
  }

  /**
   * 喚醒週期間的處理（合併、發送），但不觸發巡邏。
   * 手機通知進來時呼叫，讓 LINE 不必等到下一個 15 秒 tick。
   */
  pokeProcessing(): void {
    this.wakeSignal?.abort();
  }

  /** 可被 requestImmediateCycle 或 stop 提早中斷的等待 */
  private async waitInterruptible(ms: number): Promise<void> {
    if (ms <= 0) return;
    const ac = new AbortController();
    this.wakeSignal = ac;
    try {
      await sleep(ms, AbortSignal.any([ac.signal, this.abort.signal]));
    } finally {
      this.wakeSignal = null;
    }
  }

  private holder(key: string): PageHolder {
    let h = this.holders.get(key);
    if (!h) {
      h = new PageHolder(() => {
        if (!this.app.browser) throw new Error('瀏覽器尚未啟動');
        return this.app.browser;
      });
      this.holders.set(key, h);
    }
    return h;
  }

  /** 執行一輪：所有啟用的 target → 合併留言 → 發送 → 維護 */
  async runCycle(opts: CycleOptions & { onlyTarget?: string; skipDeliveries?: boolean } = {}): Promise<CycleSummary> {
    const app = this.app;
    const startedAt = toIsoWithOffset(app.clock.now(), app.config.timezone);
    const results: CycleResult[] = [];
    const skipped: string[] = [];
    const needsBrowser = app.config.targets.some((t) => t.enabled && (!opts.onlyTarget || t.key === opts.onlyTarget));
    if (needsBrowser) await app.openBrowser();
    for (const target of app.config.targets) {
      if (this.stopped) break;
      if (opts.onlyTarget && target.key !== opts.onlyTarget) continue;
      if (!target.enabled) {
        updateTarget(app.db, target.key, { health_status: 'DISABLED' });
        continue;
      }
      const skipReason = shouldSkipTarget(app, target);
      if (skipReason) {
        skipped.push(`${target.key}: ${skipReason}`);
        continue;
      }
      try {
        const r = await runTargetCycle(app, target, this.holder(target.key), opts);
        results.push(r);
        applyBackoff(app, target, r);
        app.logger.info({ target: target.key, status: r.status, mode: r.mode, baselineMode: r.baselineMode, events: r.eventsCreated, groups: r.groupsUpdated, stats: r.stats, scan: r.scan ? { posts: r.scan.posts, comments: r.scan.comments, conf: Number(r.scan.avgConfidence.toFixed(2)), ms: r.durationMs } : undefined }, '巡邏完成');
      } catch (e) {
        const msg = errorMessage(e);
        app.logger.error({ target: target.key, err: e }, '巡邏發生未預期錯誤');
        const row = getTarget(app.db, target.key);
        updateTarget(app.db, target.key, { health_status: 'NETWORK_ERROR', last_error: msg, consecutive_failures: (row?.consecutive_failures ?? 0) + 1 });
        await this.holder(target.key).reset();
        results.push({ targetKey: target.key, status: 'NETWORK_ERROR', mode: row?.detection_mode ?? 'STRUCTURED', baselineMode: false, eventsCreated: 0, groupsUpdated: 0, error: msg, durationMs: 0 });
        applyBackoff(app, target, results[results.length - 1]!);
      }
    }
    const flushedGroups = flushDueGroups(app);
    flushPhoneNotifications(app);
    maybeEnqueueHealthSummary(app);
    const deliveries = opts.skipDeliveries ? { processed: 0, sent: 0, retried: 0, dead: 0, suppressed: 0 } : await processDeliveries({ ...app.notifier, client: app.client, publisher: app.publisher });
    this.cycles++;
    if (this.cycles % 10 === 1) await runMaintenance(app);
    return { startedAt, results, flushedGroups, deliveries, skipped };
  }

  /**
   * 常駐迴圈。
   *
   * poll_mode = interval  ：固定週期巡邏。
   * poll_mode = triggered ：平常靠手機通知觸發；poll_interval_seconds 變成安全網間隔，
   *                         用來補抓不會產生手機通知的留言。
   *
   * 兩種模式在等待期間都每 15 秒處理一次到期的留言合併與 LINE 重試。
   */
  async runLoop(): Promise<void> {
    const app = this.app;
    await app.publisher.start?.();
    const triggered = app.config.poll_mode === 'triggered';
    while (!this.stopped) {
      const started = Date.now();
      const trigger = this.pending;
      this.pending = null;
      if (trigger) {
        const delayMs = app.config.trigger.delay_seconds * 1000;
        if (delayMs > 0) await sleep(delayMs, this.abort.signal);
        if (this.stopped) break;
      }
      try {
        await this.runCycle({ onlyTarget: trigger?.targetKey });
      } catch (e) {
        app.logger.error({ err: e }, '本輪巡邏失敗');
      }
      const intervalMs = app.config.poll_interval_seconds * 1000;
      while (!this.stopped && !this.pending && Date.now() - started < intervalMs) {
        await this.waitInterruptible(Math.min(15000, Math.max(0, intervalMs - (Date.now() - started))));
        if (this.stopped || this.pending) break;
        try {
          const flushed = flushDueGroups(app) + flushPhoneNotifications(app);
          const stats = await processDeliveries({ ...app.notifier, client: app.client, publisher: app.publisher });
          if (flushed || stats.processed) app.logger.debug({ flushed, stats }, '週期間處理');
        } catch (e) {
          app.logger.warn({ err: e }, '週期間處理失敗');
        }
      }
      if (triggered && !this.pending && !this.stopped) {
        app.logger.debug({ nextSafetyNetSeconds: app.config.poll_interval_seconds }, '安全網間隔到期，執行補抓巡邏');
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    this.wakeSignal?.abort();
  }
}
