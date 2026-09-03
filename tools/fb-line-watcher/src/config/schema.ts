import { z } from 'zod';

export const NotifyEventTypeSchema = z.enum(['NEW_POST', 'EDITED_POST', 'NEW_COMMENT', 'NEW_REPLY']);
export type NotifyEventType = z.infer<typeof NotifyEventTypeSchema>;
export const ALL_NOTIFY_EVENT_TYPES: NotifyEventType[] = ['NEW_POST', 'EDITED_POST', 'NEW_COMMENT', 'NEW_REPLY'];

const ViewportSchema = z.object({
  width: z.number().int().min(800).max(4000).default(1440),
  height: z.number().int().min(600).max(4000).default(1200),
});

export const BrowserSchema = z.object({
  channel: z.enum(['chromium', 'chrome', 'msedge']).default('chromium'),
  headed: z.boolean().default(true),
  locale: z.string().default('zh-TW'),
  viewport: ViewportSchema.prefault({}),
  device_scale_factor: z.number().min(1).max(3).default(1),
  profile_dir: z.string().default('data/browser-profile'),
  navigation_timeout_ms: z.number().int().min(5000).default(45000),
  quiet_period_ms: z.number().int().min(0).default(2500),
  executable_path: z.string().optional(),
  extra_args: z.array(z.string()).default([]),
});

export const LineSchema = z.object({
  destination_type: z.enum(['user', 'group']).default('group'),
  destination_id_env: z.string().default('LINE_DESTINATION_ID'),
  access_token_env: z.string().default('LINE_CHANNEL_ACCESS_TOKEN'),
  channel_secret_env: z.string().default('LINE_CHANNEL_SECRET'),
  api_base_url: z.string().default('https://api.line.me'),
  request_timeout_ms: z.number().int().min(1000).default(15000),
  retry_schedule_seconds: z.array(z.number().int().min(1)).default([5, 30, 120, 600, 1800]),
  system_alert_cooldown_minutes: z.number().int().min(1).default(60),
  daily_health_summary: z.boolean().default(false),
  health_summary_hour: z.number().int().min(0).max(23).default(9),
});

export const ImagesSchema = z.object({
  publisher: z.enum(['none', 'local_http', 's3']).default('none'),
  retention_hours: z.number().int().min(1).default(72),
  jpeg_quality: z.number().int().min(30).max(95).default(82),
  max_original_bytes: z.number().int().default(9_500_000),
  max_preview_bytes: z.number().int().default(950_000),
  preview_width: z.number().int().min(240).max(1024).default(480),
  local_http: z
    .object({
      port: z.number().int().min(1).max(65535).default(8787),
      bind: z.string().default('127.0.0.1'),
      public_base_url_env: z.string().default('PUBLIC_BASE_URL'),
    })
    .prefault({}),
  s3: z
    .object({
      endpoint_env: z.string().default('S3_ENDPOINT'),
      region_env: z.string().default('S3_REGION'),
      bucket_env: z.string().default('S3_BUCKET'),
      access_key_env: z.string().default('S3_ACCESS_KEY_ID'),
      secret_key_env: z.string().default('S3_SECRET_ACCESS_KEY'),
      public_base_url_env: z.string().default('S3_PUBLIC_BASE_URL'),
      key_prefix: z.string().default('fb-line-watcher/'),
      acl: z.enum(['none', 'public-read']).default('none'),
      /** R2／MinIO 建議 true；AWS S3 可設 false */
      force_path_style: z.boolean().default(true),
    })
    .prefault({}),
});

export const PrivacySchema = z.object({
  redact_phone: z.boolean().default(true),
  redact_email: z.boolean().default(true),
  redact_in_screenshot: z.boolean().default(false),
});

export const RetentionSchema = z.object({
  local_capture_days: z.number().int().min(1).default(30),
  log_days: z.number().int().min(1).default(14),
});

export const TriggerSchema = z.object({
  /** 開啟後，手機收到 Facebook 通知即可打這個網址讓 watcher 立即巡邏 */
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(8799),
  /** 手機要連得到，所以預設綁全部介面；只在家用網路內開放 */
  bind: z.string().default('0.0.0.0'),
  token_env: z.string().default('TRIGGER_TOKEN'),
  /** 兩次觸發之間至少間隔幾秒，避免一串通知造成連續巡邏 */
  min_interval_seconds: z.number().int().min(0).default(20),
  /** 收到觸發後等幾秒再巡邏，讓 Facebook 網頁端內容跟上手機通知 */
  delay_seconds: z.number().int().min(0).max(300).default(8),
});

export const PathsSchema = z.object({
  data_dir: z.string().default('data'),
  captures_dir: z.string().default('captures'),
});

export const TargetSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'key 只能包含英數、底線與連字號'),
  name: z.string().min(1),
  type: z.enum(['facebook_page', 'facebook_group']),
  url: z.url(),
  enabled: z.boolean().default(true),
  preferred_sort: z.enum(['newest', 'recent_activity', 'default']).default('newest'),
  preferred_comment_sort: z.enum(['all', 'newest', 'none']).default('all'),
  scan_latest_posts: z.number().int().min(1).max(30).default(8),
  max_scrolls: z.number().int().min(0).max(30).default(4),
  expand_see_more: z.boolean().default(true),
  detect_post_edits: z.boolean().default(true),
  detect_comments: z.boolean().default(true),
  detect_replies: z.boolean().default(true),
  max_comment_expansions_per_post: z.number().int().min(0).max(200).default(15),
  notify_event_types: z.array(NotifyEventTypeSchema).default(ALL_NOTIFY_EVENT_TYPES),
  notify_authors: z.array(z.string()).default([]),
  ignore_authors: z.array(z.string()).default([]),
  min_confidence: z.number().min(0).max(1).default(0.85),
  skip_sponsored: z.boolean().default(true),
  /** 覆寫 selector catalog 的任一欄位（見 ADAPTER_MAINTENANCE.md） */
  adapter_overrides: z.record(z.string(), z.unknown()).optional(),
});

export const ConfigSchema = z
  .object({
    timezone: z.string().default('Asia/Taipei'),
    /**
     * interval  = 固定週期巡邏（預設）
     * triggered = 平常不巡邏，等手機通知觸發；poll_interval_seconds 變成安全網間隔，
     *             用來補抓「不會產生手機通知」的留言，建議設 600～1800
     */
    poll_mode: z.enum(['interval', 'triggered']).default('interval'),
    poll_interval_seconds: z.number().int().min(20).default(180),
    comment_debounce_seconds: z.number().int().min(0).default(60),
    extractor_failure_threshold: z.number().int().min(1).default(3),
    visual_fallback_enabled: z.boolean().default(true),
    visual_confirm_after_seconds: z.number().int().min(0).default(45),
    /** dHash（256 bit）漢明距離超過此值視為畫面實質變化 */
    visual_change_threshold: z.number().int().min(1).max(256).default(10),
    max_notifications_per_day: z.number().int().min(1).default(150),
    target_cycle_timeout_ms: z.number().int().min(30000).default(180000),
    paths: PathsSchema.prefault({}),
    trigger: TriggerSchema.prefault({}),
    browser: BrowserSchema.prefault({}),
    line: LineSchema.prefault({}),
    images: ImagesSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
    retention: RetentionSchema.prefault({}),
    targets: z.array(TargetSchema).min(1, '至少要設定一個 target'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.poll_mode === 'triggered' && !cfg.trigger.enabled) {
      ctx.addIssue({ code: 'custom', path: ['poll_mode'], message: 'poll_mode 為 triggered 時必須設定 trigger.enabled: true，否則沒有任何東西會觸發巡邏' });
    }
    const seen = new Set<string>();
    cfg.targets.forEach((t, i) => {
      if (seen.has(t.key)) {
        ctx.addIssue({ code: 'custom', path: ['targets', i, 'key'], message: `target key 重複：${t.key}` });
      }
      seen.add(t.key);
      const host = new URL(t.url).hostname;
      if (!/facebook\.com$/i.test(host) && !/^(localhost|127\.0\.0\.1)$/.test(host)) {
        ctx.addIssue({ code: 'custom', path: ['targets', i, 'url'], message: `url 必須是 facebook.com 網址：${t.url}` });
      }
      if (t.type === 'facebook_group' && /facebook\.com$/i.test(host) && !/\/groups\//.test(new URL(t.url).pathname)) {
        ctx.addIssue({ code: 'custom', path: ['targets', i, 'url'], message: `type 為 facebook_group 時 url 應包含 /groups/：${t.url}` });
      }
    });
  });

export type AppConfig = z.infer<typeof ConfigSchema>;
export type TargetConfig = z.infer<typeof TargetSchema>;
export type BrowserConfig = z.infer<typeof BrowserSchema>;
export type ImagesConfig = z.infer<typeof ImagesSchema>;
export type LineConfig = z.infer<typeof LineSchema>;

/** 從環境變數解析出的秘密；只會在記憶體中存在 */
export interface Secrets {
  triggerToken?: string;
  lineAccessToken?: string;
  lineChannelSecret?: string;
  lineDestinationId?: string;
  publicBaseUrl?: string;
  s3?: {
    endpoint?: string;
    region?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicBaseUrl?: string;
  };
}
