import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import type { App } from '../app.js';
import type { TargetConfig } from '../config/schema.js';
import { ADAPTER_VERSION } from '../adapters/catalog.js';
import { FacebookSurfaceAdapter, MARK_ATTR, type SurfaceScan } from '../adapters/facebook.js';
import { normalizePost, mediaSummary, type NormalizedPost } from '../extract/fingerprint.js';
import { applyDiff, type CommentChange, type DiffStats } from '../detect/diff.js';
import { commentGroupKey, mergeCommentGroup, summarizeItems } from '../detect/groups.js';
import { decideVisual, dhashFromPng } from '../detect/visual.js';
import { captureEntity, captureViewport, type RawCapture } from '../capture/capture.js';
import { composeEvidence, type ComposeInfo } from '../capture/compose.js';
import { enqueueEvent, raiseAlert } from '../line/notifier.js';
import {
  deleteVisualBaseline,
  getPendingGroup,
  getVisualBaseline,
  insertExtractorHealth,
  markMissingEntities,
  resolveAlertsByPrefix,
  setVisualBaseline,
  setVisualPending,
  updateTarget,
  upsertPendingGroup,
  upsertTarget,
  type DetectionMode,
  type HealthStatus,
  type TargetRow,
} from '../storage/repo.js';
import type { CommentsEventPayload, PostEventPayload, VisualEventPayload } from '../events.js';
import { addSeconds, toFileStamp, toHuman, toIsoWithOffset, toLocalDate } from '../util/time.js';
import { sha256Hex } from '../util/hash.js';
import { ensureDir } from '../util/fs.js';
import { errorMessage, withTimeout } from '../util/retry.js';
import { PII_REGEX_SOURCES } from '../extract/normalize.js';
import { preparePage } from '../browser/page-prep.js';

export interface CycleOptions {
  /** 只建立現況、不通知 */
  baselineOnly?: boolean;
  /** 首次也把既有內容當新事件（預設禁止） */
  notifyExisting?: boolean;
  /** 強制 resync（adapter 更新後） */
  resync?: boolean;
}

export interface CycleResult {
  targetKey: string;
  status: HealthStatus;
  mode: DetectionMode;
  baselineMode: boolean;
  eventsCreated: number;
  groupsUpdated: number;
  stats?: DiffStats;
  scan?: { posts: number; comments: number; avgConfidence: number; expand?: SurfaceScan['expand']; timings: SurfaceScan['timings'] };
  error?: string;
  durationMs: number;
}

/** 每個 target 一個可重用的分頁 */
export class PageHolder {
  private page?: Page;
  constructor(private readonly browser: () => BrowserContext) {}
  async get(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.page = await this.browser().newPage();
    await preparePage(this.page);
    return this.page;
  }
  async reset(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    this.page = undefined;
  }
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

interface SavedCapture {
  contextPath: string;
  previewPath: string;
}

async function saveEvidence(app: App, target: TargetConfig, raw: RawCapture, info: ComposeInfo, label: string): Promise<SavedCapture> {
  const now = app.clock.now();
  const dir = ensureDir(path.join(app.capturesDir, toLocalDate(now, app.config.timezone), target.key));
  const stamp = toFileStamp(now, app.config.timezone);
  const composed = await composeEvidence(app.browser as BrowserContext, raw, info, {
    jpegQuality: app.config.images.jpeg_quality,
    maxOriginalBytes: app.config.images.max_original_bytes,
    maxPreviewBytes: app.config.images.max_preview_bytes,
    previewWidth: app.config.images.preview_width,
  });
  const contextPath = path.join(dir, `${stamp}_${label}_context.jpg`);
  const previewPath = path.join(dir, `${stamp}_${label}_preview.jpg`);
  writeFileSync(contextPath, composed.original);
  writeFileSync(previewPath, composed.preview);
  return { contextPath, previewPath };
}

function writeSidecar(contextPath: string, data: unknown): void {
  writeFileSync(contextPath.replace(/_context\.jpg$/, '.json'), JSON.stringify(data, null, 2));
}

function redactPatterns(app: App): string[] | undefined {
  if (!app.config.privacy.redact_in_screenshot) return undefined;
  const p: string[] = [];
  if (app.config.privacy.redact_phone) p.push(...PII_REGEX_SOURCES.phone);
  if (app.config.privacy.redact_email) p.push(...PII_REGEX_SOURCES.email);
  return p.length ? p : undefined;
}

function blockedMessage(status: HealthStatus, target: TargetConfig, markers: string[]): string {
  const m = markers.length ? `（診斷：${markers.slice(0, 4).join('、')}）` : '';
  switch (status) {
    case 'LOGIN_REQUIRED':
      return `Facebook 要求重新登入，已暫停監看「${target.name}」。請在 watcher 電腦執行 npm run login 重新登入後，watcher 會自動恢復。${m}`;
    case 'CHECKPOINT':
      return `Facebook 顯示安全檢查／身分驗證頁面，已暫停監看「${target.name}」。程式不會自動處理驗證，請人工在 npm run login 開啟的視窗完成。${m}`;
    case 'PERMISSION_DENIED':
      return `目前帳號看不到「${target.name}」的內容（可能未加入社團、內容不存在或無權限）。${m}`;
    default:
      return `「${target.name}」頁面狀態異常：${status}${m}`;
  }
}

/**
 * 對單一 target 執行一次完整巡邏：導航 → 健康判定 → 展開 → 抽取 → 比對 → 截圖 → 排入通知。
 */
export async function runTargetCycle(app: App, target: TargetConfig, holder: PageHolder, opts: CycleOptions = {}): Promise<CycleResult> {
  const started = Date.now();
  const { db, config, logger } = app;
  const tz = config.timezone;
  const adapter = new FacebookSurfaceAdapter(target);
  const targetRow: TargetRow = upsertTarget(db, target, targetRowAdapterVersion(db, target));
  const adapterChanged = targetRow.adapter_version !== ADAPTER_VERSION;
  const now = app.clock.now();
  const nowIso = toIsoWithOffset(now, tz);
  updateTarget(db, target.key, { last_checked_at: nowIso });
  const log = logger.child({ target: target.key });

  const finish = (partial: Omit<CycleResult, 'targetKey' | 'durationMs'>): CycleResult => ({ targetKey: target.key, durationMs: Date.now() - started, ...partial });

  let page: Page;
  let scan: SurfaceScan;
  try {
    page = await holder.get();
    scan = await withTimeout(adapter.scan(page, { timeoutMs: config.browser.navigation_timeout_ms, quietMs: config.browser.quiet_period_ms }), config.target_cycle_timeout_ms, `target ${target.key}`);
  } catch (e) {
    const msg = errorMessage(e);
    log.warn({ err: e }, '巡邏失敗（導航／逾時）');
    updateTarget(db, target.key, { health_status: 'NETWORK_ERROR', last_error: msg, consecutive_failures: targetRow.consecutive_failures + 1 });
    await holder.reset();
    if (targetRow.consecutive_failures + 1 >= 3) {
      raiseAlert(app.notifier, { alertKey: `target:${target.key}:network`, severity: 'WARN', targetKey: target.key, targetName: target.name, message: `「${target.name}」連續 ${targetRow.consecutive_failures + 1} 次無法載入（${msg.slice(0, 160)}）。請檢查網路或 Facebook 是否正常。` });
    }
    return finish({ status: 'NETWORK_ERROR', mode: targetRow.detection_mode, baselineMode: false, eventsCreated: 0, groupsUpdated: 0, error: msg });
  }

  // ---- 登入／驗證／權限 ----
  if (scan.health.status !== 'READY' && scan.health.status !== 'EMPTY') {
    const status: HealthStatus = scan.health.status === 'NETWORK_ERROR' ? 'NETWORK_ERROR' : scan.health.status;
    await saveDiagnostic(app, target, page, status).catch(() => undefined);
    updateTarget(db, target.key, { health_status: status, last_error: scan.health.markers.join(',').slice(0, 500), consecutive_failures: targetRow.consecutive_failures + 1 });
    raiseAlert(app.notifier, { alertKey: `target:${target.key}:${status}`, severity: 'ERROR', targetKey: target.key, targetName: target.name, message: blockedMessage(status, target, scan.health.markers) });
    return finish({ status, mode: targetRow.detection_mode, baselineMode: false, eventsCreated: 0, groupsUpdated: 0, error: status });
  }

  const extract = scan.extract ?? { posts: [], diagnostics: { url: scan.navigatedUrl, title: '', feedFound: false, topLevelArticles: 0, nestedArticles: 0, notes: ['no-extract'] } };
  const posts: NormalizedPost[] = extract.posts.map((p) => normalizePost(p, adapter.catalog));
  const avgConfidence = avg(posts.map((p) => p.confidence));
  const commentCount = posts.reduce((n, p) => n + p.comments.length, 0);
  const extractorFailed = posts.length === 0 || avgConfidence < 0.6;
  insertExtractorHealth(db, {
    targetKey: target.key,
    adapterVersion: ADAPTER_VERSION,
    checkedAt: nowIso,
    postCount: posts.length,
    commentCount,
    confidence: avgConfidence,
    durationMs: scan.timings.navigateMs + scan.timings.expandMs + scan.timings.extractMs,
    status: extractorFailed ? 'FAILED' : 'OK',
    diagnostics: { ...extract.diagnostics, expand: scan.expand, health: scan.health, flags: posts.map((p) => p.flags) },
  });
  const scanInfo = { posts: posts.length, comments: commentCount, avgConfidence, expand: scan.expand, timings: scan.timings };

  // ---- 結構化抽取失敗 → 降級 ----
  if (extractorFailed) {
    const failures = targetRow.extractor_failures + 1;
    log.warn({ failures, posts: posts.length, avgConfidence, diagnostics: extract.diagnostics }, '無法從畫面辨識貼文結構');
    if (failures >= config.extractor_failure_threshold) {
      const mode: DetectionMode = config.visual_fallback_enabled ? 'DEGRADED_VISUAL_MODE' : 'STRUCTURED';
      updateTarget(db, target.key, { extractor_failures: failures, health_status: 'SELECTOR_BROKEN', detection_mode: mode, last_error: `extractor failed x${failures}: ${extract.diagnostics.notes.join(',')}` });
      raiseAlert(app.notifier, {
        alertKey: `target:${target.key}:extractor`,
        severity: 'WARN',
        targetKey: target.key,
        targetName: target.name,
        message: `「${target.name}」連續 ${failures} 次無法從畫面辨識貼文結構（可能是 Facebook 改版或頁面異常）。${config.visual_fallback_enabled ? '已切換為視覺降級模式：只比對畫面是否有實質變化，無法分辨是哪則貼文或留言。' : '未啟用視覺降級，將持續重試。'}請在 watcher 電腦執行 npm run probe -- --target ${target.key} 取得診斷。`,
      });
      if (config.visual_fallback_enabled) {
        const r = await runVisualCycle(app, target, page, adapter.catalog.hideForCaptureSelectors, `結構化抽取連續失敗 ${failures} 次`).catch((e) => {
          log.warn({ err: e }, '視覺降級模式失敗');
          return 0;
        });
        return finish({ status: 'DEGRADED', mode, baselineMode: false, eventsCreated: r, groupsUpdated: 0, scan: scanInfo });
      }
      return finish({ status: 'SELECTOR_BROKEN', mode, baselineMode: false, eventsCreated: 0, groupsUpdated: 0, scan: scanInfo });
    }
    updateTarget(db, target.key, { extractor_failures: failures, health_status: 'DEGRADED', last_error: `extractor failed x${failures}` });
    return finish({ status: 'DEGRADED', mode: targetRow.detection_mode, baselineMode: false, eventsCreated: 0, groupsUpdated: 0, scan: scanInfo });
  }

  // ---- 結構化比對 ----
  const recovering = targetRow.detection_mode === 'DEGRADED_VISUAL_MODE';
  const resync = !!opts.resync || recovering || adapterChanged;
  const firstRun = targetRow.baseline_completed_at === null;
  const baselineMode = (firstRun && !opts.notifyExisting) || !!opts.baselineOnly || resync;
  const diff = applyDiff({ db, target, targetRow, now: nowIso, baselineMode }, posts);
  markMissingEntities(db, target.key, diff.seenKeys, targetRow.last_cycle_at);
  if (firstRun) log.info({ posts: posts.length, comments: commentCount }, 'baseline 已建立（首次不通知既有內容）');
  if (resync) log.info({ reason: opts.resync ? 'manual' : recovering ? 'recovered-from-visual' : 'adapter-updated' }, 'resync：本輪只同步現況、不通知');
  if (recovering) {
    deleteVisualBaseline(db, target.key);
    raiseAlert(app.notifier, { alertKey: `target:${target.key}:recovered`, severity: 'INFO', targetKey: target.key, targetName: target.name, message: `「${target.name}」結構化偵測已恢復，已重新同步現況。` , cooldownMs: 6 * 3600 * 1000 });
  }

  let eventsCreated = 0;
  let groupsUpdated = 0;
  const sourceUrl = target.url;

  for (const ch of diff.postChanges) {
    if (ch.suppressedReason) {
      log.debug({ kind: ch.kind, reason: ch.suppressedReason, author: ch.post.author }, '事件被設定過濾，不通知');
      continue;
    }
    try {
      const detectedAt = nowIso;
      const raw = await captureEntity(page, { markAttr: MARK_ATTR, postMarkId: ch.post.markId, highlightMarkIds: [], hideSelectors: adapter.catalog.hideForCaptureSelectors, redactPatterns: redactPatterns(app) });
      if (raw.redactionFailed) raiseAlert(app.notifier, { alertKey: 'redaction:failed', severity: 'WARN', message: '截圖個資遮罩失敗，本次截圖未遮罩。' });
      const title = ch.kind === 'NEW_POST' ? 'Facebook 新貼文' : 'Facebook 貼文已編輯';
      const info: ComposeInfo = {
        title,
        badge: ch.kind === 'NEW_POST' ? 'NEW' : 'EDITED',
        lines: [`來源：${target.name}`, `作者：${ch.post.author ?? '（未辨識）'}　時間：${ch.post.timeTitle ?? ch.post.timeLabel ?? '（未辨識）'}`, `偵測：${toHuman(now, tz)}　信心：${ch.post.confidence.toFixed(2)}　完整性：${ch.post.completeness}`],
        sourceUrl: ch.post.permalink ?? sourceUrl,
      };
      const label = `${ch.kind.toLowerCase()}_${ch.entityKey.slice(0, 10)}`;
      const saved = await saveEvidence(app, target, raw, info, label);
      const payload: PostEventPayload = {
        kind: ch.kind,
        targetKey: target.key,
        targetName: target.name,
        targetType: target.type,
        author: ch.post.author,
        timeLabel: ch.post.timeLabel,
        timeTitle: ch.post.timeTitle,
        text: ch.post.text,
        mediaSummary: mediaSummary(ch.post.media),
        imageCount: ch.post.media.filter((m) => m.type === 'image').length,
        permalink: ch.post.permalink,
        sourceUrl,
        confidence: ch.post.confidence,
        lowConfidence: ch.lowConfidence,
        completeness: ch.post.completeness,
        detectedAt,
        previousText: ch.previousText,
      };
      const eventKey = sha256Hex(`${target.key}|${ch.kind}|${ch.entityKey}|${ch.kind === 'EDITED_POST' ? ch.contentHash : ''}`);
      writeSidecar(saved.contextPath, { eventKey, entityKey: ch.entityKey, contentHash: ch.contentHash, payload });
      if (enqueueEvent(app.notifier, { eventKey, targetKey: target.key, entityKey: ch.entityKey, detectionMode: 'STRUCTURED', payload, screenshotPath: saved.contextPath, previewPath: saved.previewPath })) eventsCreated++;
      log.info({ kind: ch.kind, author: ch.post.author, confidence: ch.post.confidence }, '偵測到貼文事件');
    } catch (e) {
      log.error({ err: e, kind: ch.kind }, '貼文事件處理失敗（截圖／儲存）');
      raiseAlert(app.notifier, { alertKey: `target:${target.key}:capture`, severity: 'WARN', targetKey: target.key, targetName: target.name, message: `「${target.name}」偵測到 ${ch.kind} 但截圖失敗：${errorMessage(e).slice(0, 160)}` });
    }
  }

  const byPost = new Map<string, CommentChange[]>();
  for (const ch of diff.commentChanges) {
    if (ch.suppressedReason) {
      log.debug({ kind: ch.kind, reason: ch.suppressedReason, author: ch.comment.author }, '留言事件被設定過濾，不通知');
      continue;
    }
    const arr = byPost.get(ch.postEntityKey) ?? [];
    arr.push(ch);
    byPost.set(ch.postEntityKey, arr);
  }
  for (const [postKey, changes] of byPost) {
    try {
      const gkey = commentGroupKey(target.key, postKey);
      const existing = getPendingGroup(db, gkey);
      let existingPayload: CommentsEventPayload | undefined;
      if (existing) {
        try {
          existingPayload = JSON.parse(existing.payload_json) as CommentsEventPayload;
        } catch {
          existingPayload = undefined;
        }
      }
      const merged = mergeCommentGroup(existingPayload, changes, target, sourceUrl, nowIso);
      const post = changes[0]!.post;
      const highlight = merged.items.map((i) => diff.markByKey.get(i.entityKey)).filter((x): x is string => !!x);
      const raw = await captureEntity(page, { markAttr: MARK_ATTR, postMarkId: post.markId, highlightMarkIds: highlight, hideSelectors: adapter.catalog.hideForCaptureSelectors, redactPatterns: redactPatterns(app) });
      const info: ComposeInfo = {
        title: target.type === 'facebook_group' ? 'Facebook 社團有新對話' : 'Facebook 粉專有新留言',
        badge: `${merged.items.length} NEW`,
        lines: [`來源：${target.name}`, `事件：${summarizeItems(merged.items)}（紅框處為新增）`, `偵測：${toHuman(now, tz)}　完整性：${post.completeness}`],
        sourceUrl: post.permalink ?? sourceUrl,
      };
      const saved = await saveEvidence(app, target, raw, info, `comments_${postKey.slice(0, 10)}`);
      writeSidecar(saved.contextPath, { groupKey: gkey, payload: merged });
      // 等待時間從「此刻」起算（而不是本輪開始時間），避免巡邏本身耗時導致同一輪就送出
      const upsertAt = app.clock.now();
      const upsertIso = toIsoWithOffset(upsertAt, tz);
      upsertPendingGroup(db, {
        group_key: gkey,
        target_key: target.key,
        root_post_key: postKey,
        hold_until: toIsoWithOffset(addSeconds(upsertAt, config.comment_debounce_seconds), tz),
        created_at: existing?.created_at ?? upsertIso,
        updated_at: upsertIso,
        payload_json: JSON.stringify(merged),
        screenshot_path: saved.contextPath,
        preview_path: saved.previewPath,
      });
      groupsUpdated++;
      log.info({ postKey: postKey.slice(0, 10), items: merged.items.length, holdSeconds: config.comment_debounce_seconds }, '偵測到新留言／回覆，已加入合併等待');
    } catch (e) {
      log.error({ err: e }, '留言事件處理失敗（截圖／儲存）');
      raiseAlert(app.notifier, { alertKey: `target:${target.key}:capture`, severity: 'WARN', targetKey: target.key, targetName: target.name, message: `「${target.name}」偵測到新留言但截圖失敗：${errorMessage(e).slice(0, 160)}` });
    }
  }

  updateTarget(db, target.key, {
    health_status: 'READY',
    detection_mode: 'STRUCTURED',
    last_success_at: nowIso,
    last_cycle_at: nowIso,
    consecutive_failures: 0,
    extractor_failures: 0,
    last_error: null,
    adapter_version: ADAPTER_VERSION,
    baseline_completed_at: targetRow.baseline_completed_at ?? nowIso,
  });
  resolveAlertsByPrefix(db, `target:${target.key}:`, nowIso);
  return finish({ status: 'READY', mode: 'STRUCTURED', baselineMode, eventsCreated, groupsUpdated, stats: diff.stats, scan: scanInfo });
}

function targetRowAdapterVersion(db: App['db'], target: TargetConfig): string {
  const row = db.get<{ adapter_version: string }>('SELECT adapter_version FROM targets WHERE target_key = ?', target.key);
  return row?.adapter_version ?? ADAPTER_VERSION;
}

async function saveDiagnostic(app: App, target: TargetConfig, page: Page, status: string): Promise<string> {
  const dir = ensureDir(path.join(app.capturesDir, 'diagnostics'));
  const file = path.join(dir, `${target.key}_${status}_${toFileStamp(app.clock.now(), app.config.timezone)}.png`);
  await page.screenshot({ path: file, type: 'png', fullPage: false });
  return file;
}

/** 視覉降級模式：整個可視區域 dHash 雙重取樣 */
async function runVisualCycle(app: App, target: TargetConfig, page: Page, hideSelectors: string[], reason: string): Promise<number> {
  const { db, config } = app;
  const tz = config.timezone;
  const now = app.clock.now();
  const nowIso = toIsoWithOffset(now, tz);
  const raw = await captureViewport(page, hideSelectors);
  const hash = dhashFromPng(raw.png);
  const dir = ensureDir(path.join(app.capturesDir, 'visual', target.key));
  const imagePath = path.join(dir, `${toFileStamp(now, tz)}.png`);
  writeFileSync(imagePath, raw.png);
  const baseline = getVisualBaseline(db, target.key);
  const decision = decideVisual(baseline, hash, now.getTime(), { threshold: config.visual_change_threshold, confirmAfterMs: config.visual_confirm_after_seconds * 1000, similarTolerance: 6 });
  const log = app.logger.child({ target: target.key, mode: 'visual' });
  switch (decision.action) {
    case 'INIT':
      setVisualBaseline(db, { target_key: target.key, zone: 'viewport', dhash: hash, image_path: imagePath }, nowIso);
      log.info('視覺 baseline 已建立');
      return 0;
    case 'NONE':
      return 0;
    case 'DROP_PENDING':
      setVisualPending(db, target.key, null);
      return 0;
    case 'PENDING':
      if (decision.replacePending) setVisualPending(db, target.key, { dhash: hash, imagePath, since: nowIso });
      log.info({ distance: decision.distance }, '畫面有變化，等待第二次取樣確認');
      return 0;
    case 'CONFIRMED': {
      const info: ComposeInfo = {
        title: 'Facebook 畫面有變化（降級模式）',
        badge: 'DEGRADED_VISUAL_MODE',
        lines: [`來源：${target.name}`, `原因：${reason}`, `偵測：${toHuman(now, tz)}　畫面差異值：${decision.distance}　語意類型：UNKNOWN_VISUAL_CHANGE`],
        sourceUrl: target.url,
      };
      const saved = await saveEvidence(app, target, raw, info, `visual_${hash.slice(0, 10)}`);
      const payload: VisualEventPayload = { kind: 'VISUAL_CHANGE', targetKey: target.key, targetName: target.name, targetType: target.type, sourceUrl: target.url, reason, distance: decision.distance, newHash: hash, imagePath, detectedAt: nowIso };
      const eventKey = sha256Hex(`${target.key}|VISUAL|${hash}`);
      writeSidecar(saved.contextPath, { eventKey, payload });
      const created = enqueueEvent(app.notifier, { eventKey, targetKey: target.key, entityKey: null, detectionMode: 'DEGRADED_VISUAL_MODE', payload, screenshotPath: saved.contextPath, previewPath: saved.previewPath });
      // 事件已持久化並由 delivery 負責重試，因此此時即可更新 baseline，避免重複事件
      setVisualBaseline(db, { target_key: target.key, zone: 'viewport', dhash: hash, image_path: imagePath }, nowIso);
      log.info({ distance: decision.distance }, '視覺變化已確認並排入通知');
      return created ? 1 : 0;
    }
  }
}
