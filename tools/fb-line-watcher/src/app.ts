import path from 'node:path';
import type { BrowserContext } from 'playwright';
import type { AppConfig, Secrets } from './config/schema.js';
import { loadConfig, resolveSecrets, validateSecrets, type LoadOptions } from './config/load.js';
import { createLogger, registerSecret, type Logger } from './logger.js';
import { Db } from './storage/db.js';
import { systemClock, type ClockLike } from './util/time.js';
import { ensureDir } from './util/fs.js';
import { createPublisher } from './publish/factory.js';
import type { ImagePublisher } from './publish/publisher.js';
import { LineClient } from './line/client.js';
import type { NotifierCore } from './line/notifier.js';
import { launchPersistentBrowser } from './browser/profile.js';

export interface App {
  config: AppConfig;
  secrets: Secrets;
  rootDir: string;
  dataDir: string;
  capturesDir: string;
  db: Db;
  logger: Logger;
  clock: ClockLike;
  publisher: ImagePublisher;
  client: LineClient;
  notifier: NotifierCore;
  browser?: BrowserContext;
  openBrowser(opts?: { headless?: boolean }): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface CreateAppOptions extends LoadOptions {
  /** 直接給設定物件（測試用），略過 YAML */
  config?: AppConfig;
  secrets?: Secrets;
  logger?: Logger;
  clock?: ClockLike;
  fetchImpl?: typeof fetch;
  dbFile?: string;
  logToFile?: boolean;
}

export async function createApp(opts: CreateAppOptions = {}): Promise<App> {
  let config: AppConfig;
  let secrets: Secrets;
  let rootDir: string;
  if (opts.config) {
    config = opts.config;
    rootDir = path.resolve(opts.rootDir ?? process.cwd());
    secrets = opts.secrets ?? resolveSecrets(config);
    validateSecrets(config, secrets, opts);
  } else {
    const loaded = loadConfig(opts);
    config = loaded.config;
    secrets = loaded.secrets;
    rootDir = loaded.rootDir;
  }
  registerSecret(secrets.lineAccessToken);
  registerSecret(secrets.lineChannelSecret);
  registerSecret(secrets.lineDestinationId);
  registerSecret(secrets.s3?.secretAccessKey);
  registerSecret(secrets.s3?.accessKeyId);

  const dataDir = ensureDir(path.resolve(rootDir, config.paths.data_dir));
  const capturesDir = ensureDir(path.resolve(rootDir, config.paths.captures_dir));
  const logger = opts.logger ?? createLogger({ logDir: opts.logToFile === false ? undefined : path.join(dataDir, 'logs') });
  const db = new Db(opts.dbFile ?? path.join(dataDir, 'watcher.sqlite'));
  const clock = opts.clock ?? systemClock;
  const publisher = createPublisher(config, secrets, { rootDir, logger });
  const client = new LineClient({ accessToken: secrets.lineAccessToken ?? '', baseUrl: config.line.api_base_url, timeoutMs: config.line.request_timeout_ms, fetchImpl: opts.fetchImpl });
  const notifier: NotifierCore = { db, config, logger, clock, destinationId: secrets.lineDestinationId ?? '' };

  const app: App = {
    config,
    secrets,
    rootDir,
    dataDir,
    capturesDir,
    db,
    logger,
    clock,
    publisher,
    client,
    notifier,
    browser: undefined,
    async openBrowser(o = {}) {
      if (app.browser) return app.browser;
      app.browser = await launchPersistentBrowser(config, { rootDir, headless: o.headless, logger });
      app.browser.on('close', () => {
        app.browser = undefined;
      });
      return app.browser;
    },
    async close() {
      await app.browser?.close().catch(() => undefined);
      app.browser = undefined;
      await publisher.stop?.().catch(() => undefined);
      db.close();
    },
  };
  return app;
}
