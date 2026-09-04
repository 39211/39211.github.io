import type { Db } from './db.js';

export type HealthStatus =
  | 'UNKNOWN'
  | 'READY'
  | 'DEGRADED'
  | 'LOGIN_REQUIRED'
  | 'CHECKPOINT'
  | 'SELECTOR_BROKEN'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'DISABLED';

export type DetectionMode = 'STRUCTURED' | 'DEGRADED_VISUAL_MODE' | 'PHONE_NOTIFICATION' | 'SYSTEM';
export type EntityType = 'post' | 'comment' | 'reply';
export type Completeness = 'COMPLETE_VISIBLE_SET' | 'PARTIAL_EXPANSION' | 'UNKNOWN';
export type EventStatus = 'PENDING' | 'SENT' | 'DEAD_LETTER' | 'SUPPRESSED';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED_RETRYABLE' | 'DEAD_LETTER';
export type EventType = 'NEW_POST' | 'EDITED_POST' | 'NEW_COMMENTS' | 'VISUAL_CHANGE' | 'PHONE_NOTIFICATION' | 'SYSTEM_ALERT' | 'HEALTH_SUMMARY' | 'TEST';

export interface TargetRow {
  target_key: string;
  target_name: string;
  target_type: string;
  source_url: string;
  adapter_version: string;
  enabled: number;
  baseline_completed_at: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_cycle_at: string | null;
  health_status: HealthStatus;
  consecutive_failures: number;
  extractor_failures: number;
  detection_mode: DetectionMode;
  next_check_at: string | null;
  last_error: string | null;
}

export interface EntityRow {
  entity_key: string;
  target_key: string;
  entity_type: EntityType;
  parent_entity_key: string | null;
  root_post_key: string | null;
  canonical_url: string | null;
  author_display_name: string | null;
  stable_time_label: string | null;
  key_strategy: string;
  current_content_hash: string;
  first_seen_at: string;
  last_seen_at: string;
  last_changed_at: string;
  extraction_confidence: number;
  completeness: Completeness;
  missing_count: number;
  active: number;
  confirmed: number;
  known: number;
}

export interface EventRow {
  event_key: string;
  target_key: string;
  entity_key: string | null;
  event_type: EventType;
  detection_mode: DetectionMode;
  detected_at: string;
  payload_json: string;
  screenshot_path: string | null;
  preview_path: string | null;
  status: EventStatus;
  created_at: string;
}

export interface DeliveryRow {
  id: number;
  event_key: string;
  channel: string;
  destination_hash: string;
  retry_key: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  published_original_url: string | null;
  published_preview_url: string | null;
  published_expires_at: string | null;
  sent_at: string | null;
  last_error: string | null;
}

export interface PendingGroupRow {
  group_key: string;
  target_key: string;
  root_post_key: string;
  hold_until: string;
  created_at: string;
  updated_at: string;
  payload_json: string;
  screenshot_path: string | null;
  preview_path: string | null;
}

export interface AlertRow {
  alert_key: string;
  severity: string;
  target_key: string | null;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  last_notified_at: string | null;
  occurrences: number;
  resolved_at: string | null;
}

export interface VisualBaselineRow {
  target_key: string;
  zone: string;
  dhash: string;
  image_path: string;
  updated_at: string;
  pending_dhash: string | null;
  pending_image_path: string | null;
  pending_since: string | null;
}

export interface PublishedImageRow {
  id: number;
  publisher: string;
  object_key: string;
  url: string;
  created_at: string;
  expires_at: string;
  deleted_at: string | null;
}

// ---------- targets ----------

export function upsertTarget(
  db: Db,
  t: { key: string; name: string; type: string; url: string; enabled: boolean },
  adapterVersion: string,
): TargetRow {
  const existing = getTarget(db, t.key);
  if (!existing) {
    db.run(
      `INSERT INTO targets (target_key, target_name, target_type, source_url, adapter_version, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      t.key,
      t.name,
      t.type,
      t.url,
      adapterVersion,
      t.enabled,
    );
  } else {
    db.run(
      `UPDATE targets SET target_name = ?, target_type = ?, source_url = ?, enabled = ? WHERE target_key = ?`,
      t.name,
      t.type,
      t.url,
      t.enabled,
      t.key,
    );
  }
  return getTarget(db, t.key) as TargetRow;
}

export function getTarget(db: Db, key: string): TargetRow | undefined {
  return db.get<TargetRow>('SELECT * FROM targets WHERE target_key = ?', key);
}

export function listTargets(db: Db): TargetRow[] {
  return db.all<TargetRow>('SELECT * FROM targets ORDER BY target_key');
}

export function updateTarget(
  db: Db,
  key: string,
  patch: Partial<Omit<TargetRow, 'target_key'>>,
): void {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  db.run(`UPDATE targets SET ${sets} WHERE target_key = ?`, ...(entries.map(([, v]) => v) as (string | number | null)[]), key);
}

// ---------- entities ----------

export function getEntity(db: Db, key: string): EntityRow | undefined {
  return db.get<EntityRow>('SELECT * FROM entities WHERE entity_key = ?', key);
}

export interface NewEntity {
  entity_key: string;
  target_key: string;
  entity_type: EntityType;
  parent_entity_key?: string | null;
  root_post_key?: string | null;
  canonical_url?: string | null;
  author_display_name?: string | null;
  stable_time_label?: string | null;
  key_strategy: string;
  current_content_hash: string;
  extraction_confidence: number;
  completeness: Completeness;
  confirmed: boolean;
  known: boolean;
}

export function insertEntity(db: Db, e: NewEntity, now: string): void {
  db.run(
    `INSERT INTO entities (entity_key, target_key, entity_type, parent_entity_key, root_post_key, canonical_url,
       author_display_name, stable_time_label, key_strategy, current_content_hash, first_seen_at, last_seen_at,
       last_changed_at, extraction_confidence, completeness, missing_count, active, confirmed, known)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    e.entity_key,
    e.target_key,
    e.entity_type,
    e.parent_entity_key ?? null,
    e.root_post_key ?? null,
    e.canonical_url ?? null,
    e.author_display_name ?? null,
    e.stable_time_label ?? null,
    e.key_strategy,
    e.current_content_hash,
    now,
    now,
    now,
    e.extraction_confidence,
    e.completeness,
    e.confirmed,
    e.known,
  );
}

export function touchEntitySeen(
  db: Db,
  key: string,
  now: string,
  patch: { confidence?: number; completeness?: Completeness; canonical_url?: string | null; author?: string | null; stable_time_label?: string | null },
): void {
  db.run(
    `UPDATE entities SET last_seen_at = ?, missing_count = 0, active = 1,
       extraction_confidence = COALESCE(?, extraction_confidence),
       completeness = COALESCE(?, completeness),
       canonical_url = COALESCE(?, canonical_url),
       author_display_name = COALESCE(?, author_display_name),
       stable_time_label = COALESCE(?, stable_time_label)
     WHERE entity_key = ?`,
    now,
    patch.confidence ?? null,
    patch.completeness ?? null,
    patch.canonical_url ?? null,
    patch.author ?? null,
    patch.stable_time_label ?? null,
    key,
  );
}

export function updateEntityContent(db: Db, key: string, contentHash: string, now: string): void {
  db.run('UPDATE entities SET current_content_hash = ?, last_changed_at = ?, last_seen_at = ? WHERE entity_key = ?', contentHash, now, now, key);
}

export function setEntityFlags(db: Db, key: string, flags: { confirmed?: boolean; known?: boolean }): void {
  if (flags.confirmed !== undefined) db.run('UPDATE entities SET confirmed = ? WHERE entity_key = ?', flags.confirmed, key);
  if (flags.known !== undefined) db.run('UPDATE entities SET known = ? WHERE entity_key = ?', flags.known, key);
}

/** 對本輪沒看到、但上一輪有看到的實體累加 missing_count；連續 3 次以上標記為不活躍（不通知） */
export function markMissingEntities(db: Db, targetKey: string, seenKeys: string[], previousCycleAt: string | null): number {
  if (!previousCycleAt) return 0;
  const placeholders = seenKeys.map(() => '?').join(',');
  const notIn = seenKeys.length ? `AND entity_key NOT IN (${placeholders})` : '';
  const r = db.run(
    `UPDATE entities SET missing_count = missing_count + 1,
       active = CASE WHEN missing_count + 1 >= 3 THEN 0 ELSE active END
     WHERE target_key = ? AND active = 1 AND last_seen_at = ? ${notIn}`,
    targetKey,
    previousCycleAt,
    ...seenKeys,
  );
  return Number(r.changes);
}

export function countEntities(db: Db, targetKey: string, type?: EntityType): number {
  const row = type
    ? db.get<{ c: number }>('SELECT COUNT(*) c FROM entities WHERE target_key = ? AND entity_type = ?', targetKey, type)
    : db.get<{ c: number }>('SELECT COUNT(*) c FROM entities WHERE target_key = ?', targetKey);
  return row?.c ?? 0;
}

export function markAllEntitiesKnown(db: Db, targetKey: string): void {
  db.run('UPDATE entities SET known = 1, confirmed = 1 WHERE target_key = ?', targetKey);
}

// ---------- snapshots ----------

export function insertSnapshotIfNew(db: Db, entityKey: string, contentHash: string, payloadJson: string, now: string): boolean {
  const r = db.run(
    'INSERT OR IGNORE INTO entity_snapshots (entity_key, content_hash, normalized_payload_json, captured_at) VALUES (?, ?, ?, ?)',
    entityKey,
    contentHash,
    payloadJson,
    now,
  );
  return Number(r.changes) > 0;
}

export function getLatestSnapshot(db: Db, entityKey: string): { content_hash: string; normalized_payload_json: string; captured_at: string } | undefined {
  return db.get('SELECT content_hash, normalized_payload_json, captured_at FROM entity_snapshots WHERE entity_key = ? ORDER BY id DESC LIMIT 1', entityKey);
}

// ---------- events ----------

export function insertEvent(db: Db, e: Omit<EventRow, 'created_at'>, now: string): boolean {
  const r = db.run(
    `INSERT OR IGNORE INTO events (event_key, target_key, entity_key, event_type, detection_mode, detected_at, payload_json, screenshot_path, preview_path, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.event_key,
    e.target_key,
    e.entity_key,
    e.event_type,
    e.detection_mode,
    e.detected_at,
    e.payload_json,
    e.screenshot_path,
    e.preview_path,
    e.status,
    now,
  );
  return Number(r.changes) > 0;
}

export function getEvent(db: Db, key: string): EventRow | undefined {
  return db.get<EventRow>('SELECT * FROM events WHERE event_key = ?', key);
}

export function setEventStatus(db: Db, key: string, status: EventStatus): void {
  db.run('UPDATE events SET status = ? WHERE event_key = ?', status, key);
}

export function listEventsByStatus(db: Db, status: EventStatus, limit = 200): EventRow[] {
  return db.all<EventRow>('SELECT * FROM events WHERE status = ? ORDER BY created_at ASC, rowid ASC LIMIT ?', status, limit);
}

export function countEvents(db: Db, where: { status?: EventStatus; since?: string } = {}): number {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (where.status) {
    conds.push('status = ?');
    params.push(where.status);
  }
  if (where.since) {
    conds.push('created_at >= ?');
    params.push(where.since);
  }
  const sql = `SELECT COUNT(*) c FROM events ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}`;
  return db.get<{ c: number }>(sql, ...params)?.c ?? 0;
}

export function listRecentEvents(db: Db, limit = 20): EventRow[] {
  // created_at 只到秒，同一秒內建立的事件需要 rowid 當決勝條件才有穩定順序
  return db.all<EventRow>('SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?', limit);
}

// ---------- deliveries ----------

export function getOrCreateDelivery(db: Db, eventKey: string, channel: string, destinationHash: string, retryKey: string): DeliveryRow {
  db.run(
    `INSERT OR IGNORE INTO deliveries (event_key, channel, destination_hash, retry_key, status, attempts) VALUES (?, ?, ?, ?, 'PENDING', 0)`,
    eventKey,
    channel,
    destinationHash,
    retryKey,
  );
  return db.get<DeliveryRow>('SELECT * FROM deliveries WHERE event_key = ? AND channel = ? AND destination_hash = ?', eventKey, channel, destinationHash) as DeliveryRow;
}

export function updateDelivery(db: Db, id: number, patch: Partial<Omit<DeliveryRow, 'id'>>): void {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  db.run(`UPDATE deliveries SET ${sets} WHERE id = ?`, ...(entries.map(([, v]) => v) as (string | number | null)[]), id);
}

export function listDueDeliveries(db: Db, now: string, limit = 50): (DeliveryRow & { event: EventRow })[] {
  const rows = db.all<DeliveryRow>(
    `SELECT * FROM deliveries WHERE status IN ('PENDING', 'FAILED_RETRYABLE') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id ASC LIMIT ?`,
    now,
    limit,
  );
  const out: (DeliveryRow & { event: EventRow })[] = [];
  for (const d of rows) {
    const ev = getEvent(db, d.event_key);
    if (ev) out.push({ ...d, event: ev });
  }
  return out;
}

export function countDeliveries(db: Db, status: DeliveryStatus): number {
  return db.get<{ c: number }>('SELECT COUNT(*) c FROM deliveries WHERE status = ?', status)?.c ?? 0;
}

// ---------- pending groups (留言 debounce) ----------

export function getPendingGroup(db: Db, key: string): PendingGroupRow | undefined {
  return db.get<PendingGroupRow>('SELECT * FROM pending_groups WHERE group_key = ?', key);
}

export function upsertPendingGroup(db: Db, g: PendingGroupRow): void {
  db.run(
    `INSERT INTO pending_groups (group_key, target_key, root_post_key, hold_until, created_at, updated_at, payload_json, screenshot_path, preview_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_key) DO UPDATE SET hold_until = excluded.hold_until, updated_at = excluded.updated_at,
       payload_json = excluded.payload_json, screenshot_path = excluded.screenshot_path, preview_path = excluded.preview_path`,
    g.group_key,
    g.target_key,
    g.root_post_key,
    g.hold_until,
    g.created_at,
    g.updated_at,
    g.payload_json,
    g.screenshot_path,
    g.preview_path,
  );
}

export function listDuePendingGroups(db: Db, now: string): PendingGroupRow[] {
  return db.all<PendingGroupRow>('SELECT * FROM pending_groups WHERE hold_until <= ? ORDER BY created_at ASC', now);
}

export function listAllPendingGroups(db: Db): PendingGroupRow[] {
  return db.all<PendingGroupRow>('SELECT * FROM pending_groups ORDER BY created_at ASC');
}

export function deletePendingGroup(db: Db, key: string): void {
  db.run('DELETE FROM pending_groups WHERE group_key = ?', key);
}

// ---------- alerts ----------

/**
 * 記錄一次系統警報。回傳是否應該發送 LINE 通知（首次出現、已解決後再次出現，或距上次通知超過冷卻時間）。
 */
export function recordAlert(
  db: Db,
  a: { alertKey: string; severity: string; targetKey?: string | null; message: string },
  now: string,
  cooldownMs: number,
): { notify: boolean; row: AlertRow } {
  const existing = db.get<AlertRow>('SELECT * FROM system_alerts WHERE alert_key = ?', a.alertKey);
  let notify = false;
  if (!existing) {
    db.run(
      `INSERT INTO system_alerts (alert_key, severity, target_key, message, first_seen_at, last_seen_at, last_notified_at, occurrences, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      a.alertKey,
      a.severity,
      a.targetKey ?? null,
      a.message,
      now,
      now,
      now,
    );
    notify = true;
  } else {
    const cameBack = existing.resolved_at !== null;
    const lastNotified = existing.last_notified_at ? Date.parse(existing.last_notified_at) : 0;
    const cooled = Date.parse(now) - lastNotified >= cooldownMs;
    notify = cameBack || cooled || existing.last_notified_at === null;
    db.run(
      `UPDATE system_alerts SET severity = ?, message = ?, last_seen_at = ?, occurrences = occurrences + 1, resolved_at = NULL,
         last_notified_at = CASE WHEN ? THEN ? ELSE last_notified_at END
       WHERE alert_key = ?`,
      a.severity,
      a.message,
      now,
      notify,
      now,
      a.alertKey,
    );
  }
  return { notify, row: db.get<AlertRow>('SELECT * FROM system_alerts WHERE alert_key = ?', a.alertKey) as AlertRow };
}

export function resolveAlert(db: Db, alertKey: string, now: string): boolean {
  const r = db.run('UPDATE system_alerts SET resolved_at = ? WHERE alert_key = ? AND resolved_at IS NULL', now, alertKey);
  return Number(r.changes) > 0;
}

export function resolveAlertsByPrefix(db: Db, prefix: string, now: string): number {
  const r = db.run(`UPDATE system_alerts SET resolved_at = ? WHERE alert_key LIKE ? AND resolved_at IS NULL`, now, `${prefix}%`);
  return Number(r.changes);
}

export function listOpenAlerts(db: Db): AlertRow[] {
  return db.all<AlertRow>('SELECT * FROM system_alerts WHERE resolved_at IS NULL ORDER BY last_seen_at DESC');
}

// ---------- extractor health ----------

export function insertExtractorHealth(
  db: Db,
  h: { targetKey: string; adapterVersion: string; checkedAt: string; postCount: number | null; commentCount: number | null; confidence: number | null; durationMs: number | null; status: string; diagnostics: unknown },
): void {
  db.run(
    `INSERT INTO extractor_health (target_key, adapter_version, checked_at, post_count, comment_count, confidence, duration_ms, status, diagnostics_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    h.targetKey,
    h.adapterVersion,
    h.checkedAt,
    h.postCount,
    h.commentCount,
    h.confidence,
    h.durationMs,
    h.status,
    JSON.stringify(h.diagnostics ?? null),
  );
  // 只保留最近 500 筆
  db.run('DELETE FROM extractor_health WHERE target_key = ? AND id NOT IN (SELECT id FROM extractor_health WHERE target_key = ? ORDER BY id DESC LIMIT 500)', h.targetKey, h.targetKey);
}

export function recentExtractorHealth(db: Db, targetKey: string, limit = 10): { checked_at: string; post_count: number | null; comment_count: number | null; confidence: number | null; status: string; duration_ms: number | null }[] {
  return db.all('SELECT checked_at, post_count, comment_count, confidence, status, duration_ms FROM extractor_health WHERE target_key = ? ORDER BY id DESC LIMIT ?', targetKey, limit);
}

// ---------- visual baselines ----------

export function getVisualBaseline(db: Db, targetKey: string): VisualBaselineRow | undefined {
  return db.get<VisualBaselineRow>('SELECT * FROM visual_baselines WHERE target_key = ?', targetKey);
}

export function setVisualBaseline(db: Db, row: { target_key: string; zone: string; dhash: string; image_path: string }, now: string): void {
  db.run(
    `INSERT INTO visual_baselines (target_key, zone, dhash, image_path, updated_at, pending_dhash, pending_image_path, pending_since)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
     ON CONFLICT(target_key) DO UPDATE SET zone = excluded.zone, dhash = excluded.dhash, image_path = excluded.image_path, updated_at = excluded.updated_at,
       pending_dhash = NULL, pending_image_path = NULL, pending_since = NULL`,
    row.target_key,
    row.zone,
    row.dhash,
    row.image_path,
    now,
  );
}

export function setVisualPending(db: Db, targetKey: string, pending: { dhash: string; imagePath: string; since: string } | null): void {
  db.run('UPDATE visual_baselines SET pending_dhash = ?, pending_image_path = ?, pending_since = ? WHERE target_key = ?', pending?.dhash ?? null, pending?.imagePath ?? null, pending?.since ?? null, targetKey);
}

export function deleteVisualBaseline(db: Db, targetKey: string): void {
  db.run('DELETE FROM visual_baselines WHERE target_key = ?', targetKey);
}

// ---------- budget ----------

export function getBudgetCount(db: Db, day: string): number {
  return db.get<{ count: number }>('SELECT count FROM notification_budget WHERE day = ?', day)?.count ?? 0;
}

export function incrementBudget(db: Db, day: string): number {
  db.run('INSERT INTO notification_budget (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1', day);
  return getBudgetCount(db, day);
}

// ---------- published images ----------

export function insertPublishedImage(db: Db, r: { publisher: string; objectKey: string; url: string; createdAt: string; expiresAt: string }): void {
  db.run('INSERT INTO published_images (publisher, object_key, url, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', r.publisher, r.objectKey, r.url, r.createdAt, r.expiresAt);
}

export function listExpiredPublishedImages(db: Db, now: string, limit = 200): PublishedImageRow[] {
  return db.all<PublishedImageRow>('SELECT * FROM published_images WHERE deleted_at IS NULL AND expires_at <= ? ORDER BY id ASC LIMIT ?', now, limit);
}

export function markPublishedImageDeleted(db: Db, id: number, now: string): void {
  db.run('UPDATE published_images SET deleted_at = ? WHERE id = ?', now, id);
}

// ---------- kv ----------

export function kvGet(db: Db, key: string): string | undefined {
  return db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value;
}

export function kvSet(db: Db, key: string, value: string): void {
  db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
