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

export type EventPayload = PostEventPayload | CommentsEventPayload | VisualEventPayload | SystemAlertPayload | HealthSummaryPayload | TestPayload;

export interface EventDraft {
  eventKey: string;
  targetKey: string;
  entityKey: string | null;
  detectionMode: DetectionMode;
  payload: EventPayload;
  screenshotPath: string | null;
  previewPath: string | null;
}
