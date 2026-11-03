import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import type { AppConfig } from '../config/schema.js';
import { ensureDir } from '../util/fs.js';
import type { Logger } from '../logger.js';

export interface LaunchOptions {
  rootDir: string;
  headless?: boolean;
  logger?: Logger;
}

/**
 * 以專用的 persistent profile 啟動瀏覽器。
 * - 不共用日常瀏覽器 profile
 * - 不做任何指紋偽裝／反偵測；只設定 viewport、語言、時區
 */
export async function launchPersistentBrowser(config: AppConfig, opts: LaunchOptions): Promise<BrowserContext> {
  const profileDir = ensureDir(path.resolve(opts.rootDir, config.browser.profile_dir));
  const b = config.browser;
  const headless = opts.headless ?? !b.headed;
  const args = [...b.extra_args];
  if (!headless) args.push(`--window-size=${b.viewport.width + 16},${b.viewport.height + 88}`);
  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: b.channel === 'chromium' ? undefined : b.channel,
      executablePath: b.executable_path,
      headless,
      viewport: { width: b.viewport.width, height: b.viewport.height },
      deviceScaleFactor: b.device_scale_factor,
      locale: b.locale,
      timezoneId: config.timezone,
      colorScheme: 'light',
      acceptDownloads: false,
      args,
    });
    context.setDefaultNavigationTimeout(b.navigation_timeout_ms);
    context.setDefaultTimeout(15000);
    opts.logger?.info({ profileDir, headless, channel: b.channel }, '瀏覽器已啟動');
    return context;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/profile.*in use|已在使用|SingletonLock|process_singleton/i.test(msg)) {
      throw new Error(`瀏覽器 profile 正被另一個程式使用（${profileDir}）。請先關閉 npm run login 開啟的視窗或其他 watcher 實例。`);
    }
    if (/Executable doesn't exist|browserType.launchPersistentContext: Failed to launch/i.test(msg)) {
      throw new Error(`找不到瀏覽器執行檔。若 browser.channel 為 chromium 請先執行 npx playwright install chromium；若為 msedge/chrome 請確認已安裝。原始錯誤：${msg}`);
    }
    throw e;
  }
}
