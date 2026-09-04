import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, type AppConfig, type Secrets } from './schema.js';

export interface LoadedConfig {
  config: AppConfig;
  secrets: Secrets;
  configPath: string;
  rootDir: string;
}

export class ConfigError extends Error {}

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** 載入 .env（若存在）。使用 Node 內建 loadEnvFile，不覆寫既有環境變數。 */
export function loadDotEnv(rootDir: string, file = '.env'): boolean {
  const p = path.join(rootDir, file);
  if (!existsSync(p)) return false;
  const before = { ...process.env };
  process.loadEnvFile(p);
  // loadEnvFile 會覆寫；還原原本已存在的值以符合「環境變數優先」
  for (const [k, v] of Object.entries(before)) {
    if (v !== undefined) process.env[k] = v;
  }
  return true;
}

export function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('\n');
}

export function parseConfigObject(raw: unknown): AppConfig {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`設定檔驗證失敗：\n${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

export function resolveSecrets(config: AppConfig): Secrets {
  const s: Secrets = {
    triggerToken: readEnv(config.trigger.token_env),
    phoneIngestToken: readEnv(config.phone_ingest.token_env),
    lineAccessToken: readEnv(config.line.access_token_env),
    lineChannelSecret: readEnv(config.line.channel_secret_env),
    lineDestinationId: readEnv(config.line.destination_id_env),
    publicBaseUrl: readEnv(config.images.local_http.public_base_url_env),
  };
  if (config.images.publisher === 's3') {
    const c = config.images.s3;
    s.s3 = {
      endpoint: readEnv(c.endpoint_env),
      region: readEnv(c.region_env) ?? 'auto',
      bucket: readEnv(c.bucket_env),
      accessKeyId: readEnv(c.access_key_env),
      secretAccessKey: readEnv(c.secret_key_env),
      publicBaseUrl: readEnv(c.public_base_url_env),
    };
  }
  return s;
}

export interface LoadOptions {
  configPath?: string;
  rootDir?: string;
  /** 需要 LINE token 與目的地（watch/once/test-line） */
  requireLine?: boolean;
  /** 需要圖片主機設定完整（publisher != none 時） */
  requireImages?: boolean;
  /** 需要觸發伺服器的 token（watch/trigger-url，且 trigger.enabled 為 true 時） */
  requireTrigger?: boolean;
  /** 需要手機接收伺服器的 token（watch/phone-url，且 phone_ingest.enabled 為 true 時） */
  requirePhoneIngest?: boolean;
}

export function loadConfig(opts: LoadOptions = {}): LoadedConfig {
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  loadDotEnv(rootDir);
  const configPath = path.resolve(rootDir, opts.configPath ?? 'config/targets.yaml');
  if (!existsSync(configPath)) {
    throw new ConfigError(
      `找不到設定檔 ${configPath}\n請先複製 config/targets.example.yaml 為 config/targets.yaml 並填入粉專／社團網址。`,
    );
  }
  const raw: unknown = parseYaml(readFileSync(configPath, 'utf8'));
  const config = parseConfigObject(raw);
  const secrets = resolveSecrets(config);
  validateSecrets(config, secrets, opts);
  return { config, secrets, configPath, rootDir };
}

export function validateSecrets(config: AppConfig, secrets: Secrets, opts: LoadOptions): void {
  const problems: string[] = [];
  if (opts.requireLine) {
    if (!secrets.lineAccessToken) problems.push(`缺少環境變數 ${config.line.access_token_env}（LINE Channel access token）`);
    if (!secrets.lineDestinationId) problems.push(`缺少環境變數 ${config.line.destination_id_env}（LINE 群組或使用者 ID）`);
    else {
      const id = secrets.lineDestinationId;
      if (config.line.destination_type === 'group' && !/^C[0-9a-f]{32}$/.test(id)) {
        problems.push(`destination_type 為 group，但 ${config.line.destination_id_env} 不是 C 開頭的 33 字元群組 ID`);
      }
      if (config.line.destination_type === 'user' && !/^U[0-9a-f]{32}$/.test(id)) {
        problems.push(`destination_type 為 user，但 ${config.line.destination_id_env} 不是 U 開頭的 33 字元使用者 ID`);
      }
    }
  }
  if (opts.requireTrigger && config.trigger.enabled) {
    if (!secrets.triggerToken) {
      problems.push(`trigger.enabled 為 true，但缺少環境變數 ${config.trigger.token_env}（觸發用的密鑰，請用 npm run trigger-url 產生的隨機字串）`);
    } else if (secrets.triggerToken.length < 16) {
      problems.push(`${config.trigger.token_env} 太短（至少 16 個字元），請改用夠長的隨機字串`);
    }
  }
  if (opts.requirePhoneIngest && config.phone_ingest.enabled) {
    if (!secrets.phoneIngestToken) {
      problems.push(`phone_ingest.enabled 為 true，但缺少環境變數 ${config.phone_ingest.token_env}（手機上傳用的密鑰，請用 npm run phone-url 產生）`);
    } else if (secrets.phoneIngestToken.length < 16) {
      problems.push(`${config.phone_ingest.token_env} 太短（至少 16 個字元），請改用夠長的隨機字串`);
    }
  }
  if (opts.requireImages) {
    if (config.images.publisher === 'local_http') {
      if (!secrets.publicBaseUrl) problems.push(`images.publisher=local_http 需要環境變數 ${config.images.local_http.public_base_url_env}`);
      else if (!/^https:\/\//.test(secrets.publicBaseUrl)) problems.push(`${config.images.local_http.public_base_url_env} 必須是 https:// 開頭（LINE 只接受 HTTPS 圖片）`);
    }
    if (config.images.publisher === 's3') {
      const s = secrets.s3 ?? {};
      const c = config.images.s3;
      if (!s.bucket) problems.push(`缺少環境變數 ${c.bucket_env}`);
      if (!s.accessKeyId) problems.push(`缺少環境變數 ${c.access_key_env}`);
      if (!s.secretAccessKey) problems.push(`缺少環境變數 ${c.secret_key_env}`);
      if (!s.publicBaseUrl) problems.push(`缺少環境變數 ${c.public_base_url_env}`);
      else if (!/^https:\/\//.test(s.publicBaseUrl)) problems.push(`${c.public_base_url_env} 必須是 https:// 開頭`);
    }
  }
  if (problems.length) {
    throw new ConfigError(`環境設定不完整：\n${problems.map((p) => `  - ${p}`).join('\n')}\n請檢查 .env（可參考 .env.example）。`);
  }
}
