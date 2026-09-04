import type { Completeness, DetectionMode } from './storage/repo.js';

export interface PostEventPayload {
  kind: 'NEW_POST' | 'EDITED_POST';
  targetKey: string;
  targetName: string;
  targetType: 'facebook_page' | 'facebook_group';
  author?: string;
  timeLabel?: string;
  timeTitle?: string;
  text: string;
  mediaSummary: string;
  imageCount: number;
  permalink?: string;
  sourceUrl: string;
  confidence: number;
  lowConfidence: boolean;
  completeness: Completeness;
  detectedAt: string;
  previousText?: string;
}

export interface CommentItem {
  entityKey: string;
  kind: 'NEW_COMMENT' | 'NEW_REPLY' | 'EDITED_COMMENT';
  author?: string;
  text: string;
  isReply: boolean;
  depth: number;
  permalink?: string;
}

export interface CommentsEventPayload {
  kind: 'NEW_COMMENTS';
  targetKey: string;
  targetName: string;
  targetType: 'facebook_page' | 'facebook_group';
  rootPostKey: string;
  post: { author?: string; textPrefix: string; permalink?: string; timeLabel?: string; timeTitle?: string };
  items: CommentItem[];
  completeness: Completeness;
  sourceUrl: string;
  firstDetectedAt: string;
  detectedAt: string;
}

export interface VisualEventPayload {
  kind: 'VISUAL_CHANGE';
  targetKey: string;
  targetName: string;
  targetType: 'facebook_page' | 'facebook_group';
  sourceUrl: string;
  reason: string;
  distance: number;
  newHash: string;
  imagePath: string;
  detectedAt: string;
}

export interface PhoneNotificationItem {
  /** 去重用的穩定識別碼 */
  itemKey: string;
  /** 通知標題，Facebook 通常放發文／留言者或社團名稱 */
  title?: string;
  /** 通知內文（優先使用未截斷的 bigText） */
  text: string;
  /** 手機上的通知時間（由手機端帶上，格式不保證） */
  postedAtLabel?: string;
  /** 來源 Android 套件 */
  packageName?: string;
  /** 這則通知是否附了截圖 */
  hasImage: boolean;
}

export interface PhoneNotificationPayload {
  kind: 'PHONE_NOTIFICATION';
  items: PhoneNotificationItem[];
  /** 因為超過每則上限而未列出的數量 */
  omittedCount: number;
  firstDetectedAt: string;
  detectedAt: string;
  /** 手機端來源標示，只用於文案 */
  source: string;
}

export interface SystemAlertPayload {
  kind: 'SYSTEM_ALERT';
  severity: 'INFO' | 'WARN' | 'ERROR';
  alertKey: string;
  targetKey?: string;
  targetName?: string;
  message: string;
  detectedAt: string;
}

export interface HealthSummaryPayload {
  kind: 'HEALTH_SUMMARY';
  text: string;
  detectedAt: string;
}

export interface TestPayload {
  kind: 'TEST';
  text: string;
}

export type EventPayload =
  | PostEventPayload
  | CommentsEventPayload
  | VisualEventPayload
  | PhoneNotificationPayload
  | SystemAlertPayload
  | HealthSummaryPayload
  | TestPayload;

export interface EventDraft {
  eventKey: string;
  targetKey: string;
  entityKey: string | null;
  detectionMode: DetectionMode;
  payload: EventPayload;
  screenshotPath: string | null;
  previewPath: string | null;
}
