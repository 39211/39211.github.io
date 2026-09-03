import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../../fixtures/server.js';
import { startMockLine, type MockLineServer } from '../../fixtures/mock-line.js';
import { createApp, type App } from '../../src/app.js';
import { parseConfigObject } from '../../src/config/load.js';
import type { AppConfig, Secrets } from '../../src/config/schema.js';
import { createLogger } from '../../src/logger.js';
import { Watcher, type CycleSummary } from '../../src/worker/scheduler.js';
import type { CycleOptions } from '../../src/worker/target-worker.js';
import { processDeliveries } from '../../src/line/notifier.js';

export interface HarnessOptions {
  seedPosts?: number;
  targets?: ('page' | 'group')[];
  configOverrides?: Record<string, unknown>;
  targetOverrides?: Record<string, unknown>;
  publisher?: 'none' | 'local_http';
  publicPort?: number;
}

export interface Harness {
  app: App;
  watcher: Watcher;
  fixture: FixtureServer;
  line: MockLineServer;
  rootDir: string;
  config: AppConfig;
  clock: { offsetMs: number; now(): Date };
  cycle(o?: CycleOptions & { onlyTarget?: string }): Promise<CycleSummary>;
  deliver(): ReturnType<typeof processDeliveries>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export const TMP_ROOT = path.resolve('tests/.tmp');
export const SAMPLES_DIR = path.resolve('docs/samples');

export function saveSample(name: string, file: string | null | undefined): void {
  if (process.env.FBLW_WRITE_SAMPLES !== '1' || !file || !existsSync(file)) return;
  mkdirSync(SAMPLES_DIR, { recursive: true });
  copyFileSync(file, path.join(SAMPLES_DIR, name));
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 等待條件成立，逾時則丟出錯誤（附上最後狀態方便除錯） */
export async function waitFor(label: string, predicate: () => boolean, timeoutMs = 60_000, stepMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(stepMs);
  }
  throw new Error(`等待逾時（${timeoutMs} ms）：${label}`);
}

export async function setupHarness(opts: HarnessOptions = {}): Promise<Harness> {
  mkdirSync(TMP_ROOT, { recursive: true });
  const rootDir = mkdtempSync(path.join(TMP_ROOT, 'run-'));
  const fixture = await startFixtureServer({ seedPosts: opts.seedPosts ?? 3 });
  const line = await startMockLine();
  const targets = (opts.targets ?? ['page']).map((kind) =>
    kind === 'page'
      ? { key: 'page', name: '阿爸洗鞋店', type: 'facebook_page', url: fixture.url('page'), scan_latest_posts: 6, max_scrolls: 1, ...opts.targetOverrides }
      : { key: 'group', name: '青海路洗鞋交流社團', type: 'facebook_group', url: fixture.url('group'), scan_latest_posts: 6, max_scrolls: 1, ...opts.targetOverrides },
  );
  const config = parseConfigObject({
    poll_interval_seconds: 20,
    comment_debounce_seconds: 0,
    extractor_failure_threshold: 2,
    visual_confirm_after_seconds: 0,
    browser: { headed: false, viewport: { width: 1200, height: 900 }, navigation_timeout_ms: 20000, quiet_period_ms: 150, profile_dir: 'profile' },
    line: { api_base_url: line.baseUrl, retry_schedule_seconds: [1, 1, 1], system_alert_cooldown_minutes: 60 },
    images: { publisher: opts.publisher ?? 'none', local_http: { port: opts.publicPort ?? 8787 } },
    ...opts.configOverrides,
    targets,
  });
  const secrets: Secrets = { lineAccessToken: 'test-token-abcdef', lineDestinationId: `C${'a'.repeat(32)}`, publicBaseUrl: 'https://img.example.test', triggerToken: 't'.repeat(32) };
  const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
  const logStream = createWriteStream(path.join(rootDir, 'test.log'), { flags: 'a' });
  const logger = createLogger({ stream: logStream, level: 'debug' });

  const build = async (): Promise<App> => createApp({ config, secrets, rootDir, logger, clock, logToFile: false });
  let app = await build();
  let watcher = new Watcher(app);
  const h: Harness = {
    get app() {
      return app;
    },
    get watcher() {
      return watcher;
    },
    fixture,
    line,
    rootDir,
    config,
    clock,
    cycle: (o) => watcher.runCycle(o),
    deliver: () => processDeliveries({ ...app.notifier, client: app.client, publisher: app.publisher }),
    async restart() {
      watcher.stop();
      await app.close();
      app = await build();
      watcher = new Watcher(app);
    },
    async close() {
      watcher.stop();
      await app.close().catch(() => undefined);
      await fixture.close();
      await line.close();
      logStream.end();
      if (process.env.FBLW_KEEP_TMP !== '1') rmSync(rootDir, { recursive: true, force: true });
    },
  };
  return h;
}
