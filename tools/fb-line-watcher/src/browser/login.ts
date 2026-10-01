import type { AppConfig } from '../config/schema.js';
import type { Logger } from '../logger.js';
import { launchPersistentBrowser } from './profile.js';
import { classifySurface, hasFacebookLoginCookie } from './session-health.js';
import { DEFAULT_CATALOG, mergeCatalog, withGroupSort } from '../adapters/catalog.js';
import { sleep } from '../util/time.js';
import { installStabilizers, waitForSurface } from './stabilize.js';
import { preparePage } from './page-prep.js';

export interface LoginFlowOptions {
  rootDir: string;
  logger: Logger;
  /** 等待使用者手動登入的最長時間 */
  maxWaitMs?: number;
  /** 登入後逐一開啟 target 檢查可見性 */
  verifyTargets?: boolean;
  print?: (line: string) => void;
}

/**
 * 首次登入流程：開啟可見的瀏覽器讓使用者自己輸入帳密與完成 2FA。
 * 程式只等待，不代填、不儲存密碼、不處理任何驗證碼。
 */
export async function runLoginFlow(config: AppConfig, opts: LoginFlowOptions): Promise<boolean> {
  const print = opts.print ?? ((l: string) => console.log(l));
  const context = await launchPersistentBrowser(config, { rootDir: opts.rootDir, headless: false, logger: opts.logger });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await preparePage(page);
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    print('');
    print('======================================================');
    print(' 請在剛開啟的瀏覽器視窗中登入 Facebook（含雙重驗證）。');
    print(' 程式不會讀取或儲存你的密碼；登入狀態只保存在專用 profile 資料夾。');
    print(' 登入完成、看到首頁動態後，這裡會自動偵測並繼續。');
    print('======================================================');
    print('');
    const deadline = Date.now() + (opts.maxWaitMs ?? 20 * 60 * 1000);
    let loggedIn = false;
    while (Date.now() < deadline) {
      if (page.isClosed()) break;
      const cookie = await hasFacebookLoginCookie(page);
      const health = await classifySurface(page, DEFAULT_CATALOG);
      if (cookie && health.status !== 'LOGIN_REQUIRED' && health.status !== 'CHECKPOINT') {
        loggedIn = true;
        break;
      }
      await sleep(3000);
    }
    if (!loggedIn) {
      print('❌ 在時限內沒有偵測到成功登入。可以再執行一次 npm run login。');
      return false;
    }
    print('✅ 已偵測到登入狀態，profile 已保存。');

    if (opts.verifyTargets !== false) {
      print('');
      print('接著檢查每個 target 是否能以此帳號看到內容：');
      for (const t of config.targets) {
        const catalog = mergeCatalog(t.adapter_overrides);
        const url = t.type === 'facebook_group' ? withGroupSort(t.url, t.preferred_sort, catalog) : t.url;
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await installStabilizers(page, catalog);
          await waitForSurface(page, catalog, { timeoutMs: 30000, quietMs: 1500 });
          const h = await classifySurface(page, catalog);
          const icon = h.status === 'READY' ? '✅' : '⚠️';
          print(`  ${icon} ${t.name}（${t.key}）：${h.status}，可見貼文 ${h.articleCount} 篇`);
          if (h.status !== 'READY') print(`     診斷：${h.markers.join(', ') || '無'}`);
        } catch (e) {
          print(`  ⚠️ ${t.name}（${t.key}）：無法開啟，${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    print('');
    print('完成。接下來可以執行 npm run once（單次巡邏，第一次只建立 baseline）或 npm run watch。');
    return true;
  } finally {
    await context.close().catch(() => undefined);
  }
}
