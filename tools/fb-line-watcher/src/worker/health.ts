import { writeFileSync } from 'node:fs';
import type { Db } from '../storage/db.js';
import type { AppConfig } from '../config/schema.js';
import { countDeliveries, countEntities, countEvents, getBudgetCount, listAllPendingGroups, listOpenAlerts, listTargets, recentExtractorHealth } from '../storage/repo.js';
import { toHuman, toIsoWithOffset, toLocalDate, type ClockLike } from '../util/time.js';

export interface TargetHealth {
  key: string;
  name: string;
  status: string;
  detectionMode: string;
  baselineCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  extractorFailures: number;
  posts: number;
  comments: number;
  lastExtraction?: { checkedAt: string; postCount: number | null; commentCount: number | null; confidence: number | null; status: string; durationMs: number | null };
  lastError: string | null;
}

export interface HealthReport {
  generatedAt: string;
  targets: TargetHealth[];
  pendingDeliveries: number;
  deadLetters: number;
  eventsToday: number;
  budgetUsed: number;
  budgetMax: number;
  pendingCommentGroups: number;
  openAlerts: { key: string; severity: string; message: string; lastSeenAt: string }[];
}

export function buildHealthReport(db: Db, config: AppConfig, clock: ClockLike): HealthReport {
  const now = clock.now();
  const tz = config.timezone;
  const today = toLocalDate(now, tz);
  const targets = listTargets(db).map<TargetHealth>((t) => {
    const last = recentExtractorHealth(db, t.target_key, 1)[0];
    return {
      key: t.target_key,
      name: t.target_name,
      status: t.enabled ? t.health_status : 'DISABLED',
      detectionMode: t.detection_mode,
      baselineCompletedAt: t.baseline_completed_at,
      lastSuccessAt: t.last_success_at,
      lastCheckedAt: t.last_checked_at,
      consecutiveFailures: t.consecutive_failures,
      extractorFailures: t.extractor_failures,
      posts: countEntities(db, t.target_key, 'post'),
      comments: countEntities(db, t.target_key, 'comment') + countEntities(db, t.target_key, 'reply'),
      lastExtraction: last ? { checkedAt: last.checked_at, postCount: last.post_count, commentCount: last.comment_count, confidence: last.confidence, status: last.status, durationMs: last.duration_ms } : undefined,
      lastError: t.last_error,
    };
  });
  return {
    generatedAt: toIsoWithOffset(now, tz),
    targets,
    pendingDeliveries: countDeliveries(db, 'PENDING') + countDeliveries(db, 'FAILED_RETRYABLE'),
    deadLetters: countDeliveries(db, 'DEAD_LETTER'),
    eventsToday: countEvents(db, { since: `${today}T00:00:00` }),
    budgetUsed: getBudgetCount(db, today),
    budgetMax: config.max_notifications_per_day,
    pendingCommentGroups: listAllPendingGroups(db).length,
    openAlerts: listOpenAlerts(db).map((a) => ({ key: a.alert_key, severity: a.severity, message: a.message, lastSeenAt: a.last_seen_at })),
  };
}

const fmt = (iso: string | null | undefined, tz: string): string => (iso ? toHuman(new Date(iso), tz) : '—');

export function formatHealthReport(r: HealthReport, tz: string): string {
  const lines: string[] = [];
  lines.push(`fb-line-watcher 健康報告 ${fmt(r.generatedAt, tz)}`);
  for (const t of r.targets) {
    const icon = t.status === 'READY' ? '✅' : t.status === 'DEGRADED' ? '🟠' : t.status === 'DISABLED' ? '⏸' : '❌';
    lines.push(`${icon} ${t.name}（${t.key}）：${t.status}／${t.detectionMode}`);
    lines.push(`   最後成功：${fmt(t.lastSuccessAt, tz)}｜baseline：${t.baselineCompletedAt ? '已建立' : '尚未'}｜已知貼文 ${t.posts}、留言 ${t.comments}`);
    if (t.lastExtraction) lines.push(`   最近抽取：貼文 ${t.lastExtraction.postCount ?? '-'}、留言 ${t.lastExtraction.commentCount ?? '-'}、信心 ${t.lastExtraction.confidence?.toFixed(2) ?? '-'}、${t.lastExtraction.durationMs ?? '-'} ms`);
    if (t.lastError) lines.push(`   最近錯誤：${t.lastError.slice(0, 160)}`);
  }
  lines.push(`待發送 ${r.pendingDeliveries}｜dead-letter ${r.deadLetters}｜今日事件 ${r.eventsToday}｜今日通知 ${r.budgetUsed}/${r.budgetMax}｜待合併留言群組 ${r.pendingCommentGroups}`);
  if (r.openAlerts.length) {
    lines.push('未解決警報：');
    for (const a of r.openAlerts.slice(0, 5)) lines.push(`  - [${a.severity}] ${a.key}：${a.message.slice(0, 120)}`);
  }
  return lines.join('\n');
}

export function writeHealthFile(report: HealthReport, file: string): void {
  writeFileSync(file, JSON.stringify(report, null, 2));
}
