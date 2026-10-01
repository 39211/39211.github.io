import { DatabaseSync, type StatementSync } from 'node:sqlite';
import path from 'node:path';
import { ensureDir } from '../util/fs.js';

export type SqlParam = string | number | bigint | null | Uint8Array;
export type Bindable = SqlParam | boolean | undefined;

export function bind(values: Bindable[]): SqlParam[] {
  return values.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS targets (
  target_key TEXT PRIMARY KEY,
  target_name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  baseline_completed_at TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  last_cycle_at TEXT,
  health_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  extractor_failures INTEGER NOT NULL DEFAULT 0,
  detection_mode TEXT NOT NULL DEFAULT 'STRUCTURED',
  next_check_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS entities (
  entity_key TEXT PRIMARY KEY,
  target_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  parent_entity_key TEXT,
  root_post_key TEXT,
  canonical_url TEXT,
  author_display_name TEXT,
  stable_time_label TEXT,
  key_strategy TEXT NOT NULL,
  current_content_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  extraction_confidence REAL NOT NULL,
  completeness TEXT NOT NULL,
  missing_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  confirmed INTEGER NOT NULL DEFAULT 1,
  known INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_entities_target_type ON entities(target_key, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_root ON entities(root_post_key);

CREATE TABLE IF NOT EXISTS entity_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  normalized_payload_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE(entity_key, content_hash)
);

CREATE TABLE IF NOT EXISTS events (
  event_key TEXT PRIMARY KEY,
  target_key TEXT NOT NULL,
  entity_key TEXT,
  event_type TEXT NOT NULL,
  detection_mode TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  screenshot_path TEXT,
  preview_path TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  retry_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  published_original_url TEXT,
  published_preview_url TEXT,
  published_expires_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  UNIQUE(event_key, channel, destination_hash)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS pending_groups (
  group_key TEXT PRIMARY KEY,
  target_key TEXT NOT NULL,
  root_post_key TEXT NOT NULL,
  hold_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  screenshot_path TEXT,
  preview_path TEXT
);

CREATE TABLE IF NOT EXISTS system_alerts (
  alert_key TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  target_key TEXT,
  message TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_notified_at TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS extractor_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_key TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  post_count INTEGER,
  comment_count INTEGER,
  confidence REAL,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  diagnostics_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_health_target ON extractor_health(target_key, checked_at);

CREATE TABLE IF NOT EXISTS visual_baselines (
  target_key TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  dhash TEXT NOT NULL,
  image_path TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pending_dhash TEXT,
  pending_image_path TEXT,
  pending_since TEXT
);

CREATE TABLE IF NOT EXISTS notification_budget (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS published_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publisher TEXT NOT NULL,
  object_key TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE IF NOT EXISTS phone_notifications (
  item_key TEXT PRIMARY KEY,
  title TEXT,
  body_text TEXT NOT NULL,
  package_name TEXT,
  posted_label TEXT,
  image_path TEXT,
  received_at TEXT NOT NULL,
  batched INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_phone_received ON phone_notifications(received_at);
`,
  },
  {
    version: 3,
    sql: `
-- 手機通知必須分成兩種身分：
--   content_fingerprint 只用來判斷「去重時間窗內是否重複」
--   occurrence_id       代表「這一次真正發生的通知」，事件鍵由它產生
-- 舊版兩者共用同一個內容雜湊，導致去重窗到期後同樣的通知再也送不出去。
CREATE TABLE IF NOT EXISTS phone_notifications_v3 (
  occurrence_id TEXT PRIMARY KEY,
  content_fingerprint TEXT NOT NULL,
  title TEXT,
  body_text TEXT NOT NULL,
  package_name TEXT,
  posted_label TEXT,
  image_path TEXT,
  received_at TEXT NOT NULL,
  batched INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO phone_notifications_v3
  (occurrence_id, content_fingerprint, title, body_text, package_name, posted_label, image_path, received_at, batched)
SELECT item_key || ':' || received_at, item_key, title, body_text, package_name, posted_label, image_path, received_at, batched
FROM phone_notifications;
DROP TABLE phone_notifications;
ALTER TABLE phone_notifications_v3 RENAME TO phone_notifications;
CREATE INDEX IF NOT EXISTS idx_phone_fingerprint ON phone_notifications(content_fingerprint, received_at);
CREATE INDEX IF NOT EXISTS idx_phone_batched ON phone_notifications(batched, received_at);
`,
  },
  {
    version: 4,
    sql: `
-- 偵測到變更之後、事件真正持久化之前，實體會停留在 known = 0。
-- 若截圖／存檔失敗，下一輪會再看到同一筆並重新補送；capture_failures 記錄連續失敗次數，
-- 超過門檻就改送純文字事件，避免永遠卡在補送迴圈。
ALTER TABLE entities ADD COLUMN capture_failures INTEGER NOT NULL DEFAULT 0;
`,
  },
];

export class Db {
  readonly raw: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();

  constructor(readonly file: string) {
    if (file !== ':memory:') ensureDir(path.dirname(path.resolve(file)));
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const row = this.raw.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number };
    for (const m of MIGRATIONS) {
      if (m.version <= row.v) continue;
      this.transaction(() => {
        this.raw.exec(m.sql);
        this.raw.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
      });
    }
  }

  stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  run(sql: string, ...params: Bindable[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.stmt(sql).run(...bind(params));
  }

  get<T = Record<string, unknown>>(sql: string, ...params: Bindable[]): T | undefined {
    return this.stmt(sql).get(...bind(params)) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: Bindable[]): T[] {
    return this.stmt(sql).all(...bind(params)) as T[];
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}
