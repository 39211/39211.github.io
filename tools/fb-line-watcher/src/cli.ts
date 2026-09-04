#!/usr/bin/env node
import './suppress-warnings.js';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createApp, type App } from './app.js';
import { ConfigError } from './config/load.js';
import { runLoginFlow } from './browser/login.js';
import { acquireSingleInstanceLock, LockHeldError } from './worker/lock.js';
import { Watcher, runMaintenance } from './worker/scheduler.js';
import { buildHealthReport, formatHealthReport } from './worker/health.js';
import { startLineIdsServer } from './line/ids-server.js';
import { lanAddresses, startTriggerServer, type TriggerServerHandle } from './worker/trigger-server.js';
import { startPhoneIngestServer, type PhoneIngestHandle } from './worker/phone-ingest.js';
import { enqueueEvent, processDeliveries } from './line/notifier.js';
import { FacebookSurfaceAdapter } from './adapters/facebook.js';
import { normalizePost } from './extract/fingerprint.js';
import { ensureDir } from './util/fs.js';
import { toFileStamp, toIsoWithOffset } from './util/time.js';
import { randomToken, sha256Hex } from './util/hash.js';
import { errorMessage } from './util/retry.js';
import { preparePage } from './browser/page-prep.js';

const HELP = `fb-line-watcher — Facebook 粉專／社團畫面監看 → 截圖 → LINE 通知（不使用 Facebook API）

用法：npm run <command> [-- 參數]

  login                      開啟專用瀏覽器讓你手動登入 Facebook（不儲存密碼）
  once [--target key]        單次巡邏所有（或指定）target；首次只建立 baseline，不通知
       [--notify-existing]   首次也把既有內容當新事件（預設禁止，會洗版）
       [--baseline-only]     只同步現況、不通知
       [--headless]          不顯示瀏覽器視窗
  watch [--headless]         常駐巡邏（Windows 排程器請用此命令）
  trigger-url                印出手機要打的觸發網址（搭配 poll_mode: triggered）
  phone-url                  印出手機上傳通知／截圖的網址（搭配 phone_ingest）
  baseline [--target key]    重建現況 baseline（等同 once --baseline-only）
  resync [--target key]      Facebook 改版／adapter 更新後重新同步，不把舊內容當新事件
  probe [--target key]       診斷：印出畫面辨識結果與信心，並存截圖到 captures/diagnostics
  health [--json]            顯示各 target 健康狀態、待發送與 dead-letter
  get-line-ids [--port n]    啟動 webhook 接收器，取得 LINE 群組／使用者 ID
  test-line                  發一則測試訊息到 LINE 目的地
  cleanup                    立即清理過期截圖與公開圖片

共用參數：--config <path>（預設 config/targets.yaml）
`;

function print(line = ''): void {
  console.log(line);
}

async function withApp<T>(opts: Parameters<typeof createApp>[0], fn: (app: App) => Promise<T>): Promise<T> {
  const app = await createApp(opts);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

function summarizeCycle(app: App, summary: Awaited<ReturnType<Watcher['runCycle']>>): void {
  print('');
  print(`巡邏結果（${summary.startedAt}）`);
  for (const r of summary.results) {
    const icon = r.status === 'READY' ? '✅' : r.status === 'DEGRADED' ? '🟠' : '❌';
    const scan = r.scan ? `貼文 ${r.scan.posts}、留言 ${r.scan.comments}、信心 ${r.scan.avgConfidence.toFixed(2)}` : '';
    const st = r.stats ? `新貼文 ${r.stats.newPosts}、編輯 ${r.stats.editedPosts}、新留言 ${r.stats.newComments}、回覆 ${r.stats.newReplies}${r.stats.suppressed ? `、過濾 ${r.stats.suppressed}` : ''}${r.stats.awaitingConfirmation ? `、待二次確認 ${r.stats.awaitingConfirmation}` : ''}` : '';
    print(`${icon} ${r.targetKey}：${r.status}／${r.mode}${r.baselineMode ? '（baseline／resync，不通知）' : ''} ${scan}${st ? `｜${st}` : ''}${r.error ? `｜錯誤：${r.error}` : ''}（${r.durationMs} ms）`);
  }
  for (const s of summary.skipped) print(`⏭ ${s}`);
  print(`合併留言群組轉事件 ${summary.flushedGroups}｜LINE 送出 ${summary.deliveries.sent}、待重試 ${summary.deliveries.retried}、失敗 ${summary.deliveries.dead}、額度抑制 ${summary.deliveries.suppressed}`);
  const pendingGroups = app.db.get<{ c: number }>('SELECT COUNT(*) c FROM pending_groups')?.c ?? 0;
  if (pendingGroups) print(`（尚有 ${pendingGroups} 組新留言在合併等待中，下一輪或等待時間到後才會發送）`);
}

async function cmdOnce(configPath: string | undefined, flags: { target?: string; notifyExisting?: boolean; baselineOnly?: boolean; resync?: boolean; headless?: boolean }): Promise<void> {
  await withApp({ configPath, requireLine: true, requireImages: true }, async (app) => {
    await app.publisher.start?.();
    await app.openBrowser({ headless: flags.headless });
    const watcher = new Watcher(app);
    const summary = await watcher.runCycle({ onlyTarget: flags.target, notifyExisting: flags.notifyExisting, baselineOnly: flags.baselineOnly, resync: flags.resync });
    summarizeCycle(app, summary);
  });
}

async function cmdWatch(configPath: string | undefined, flags: { headless?: boolean; notifyExisting?: boolean }): Promise<void> {
  const app = await createApp({ configPath, requireLine: true, requireImages: true, requireTrigger: true, requirePhoneIngest: true });
  const lock = acquireSingleInstanceLock(path.join(app.dataDir, 'watcher.lock'));
  const watcher = new Watcher(app);
  let triggerServer: TriggerServerHandle | undefined;
  let phoneServer: PhoneIngestHandle | undefined;
  let closing = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.logger.info({ sig }, '收到停止訊號，正在關閉');
    watcher.stop();
    setTimeout(() => process.exit(0), 20000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  try {
    if (app.config.targets.some((t) => t.enabled)) await app.openBrowser({ headless: flags.headless });
    else print('目前沒有啟用任何瀏覽器 target，只以手機通知運作（電腦完全不連 Facebook）。');
    if (app.config.phone_ingest.enabled) {
      phoneServer = await startPhoneIngestServer({
        db: app.db,
        config: app.config.phone_ingest,
        token: app.secrets.phoneIngestToken ?? '',
        capturesDir: app.capturesDir,
        timezone: app.config.timezone,
        logger: app.logger,
        now: () => app.clock.now(),
        onAccepted: () => watcher.pokeProcessing(),
      });
      const hosts = lanAddresses();
      print(`手機通知接收器已啟動：http://${hosts[0] ?? '<這台電腦的區網 IP>'}:${phoneServer.port}/phone/notify`);
      print('（完整網址含 token 請執行 npm run phone-url）');
    }
    if (app.config.trigger.enabled) {
      triggerServer = await startTriggerServer({
        port: app.config.trigger.port,
        bind: app.config.trigger.bind,
        token: app.secrets.triggerToken ?? '',
        minIntervalMs: app.config.trigger.min_interval_seconds * 1000,
        logger: app.logger,
        onTrigger: (req) => watcher.requestImmediateCycle(`phone:${req.source}`, req.targetKey),
      });
      const hosts = lanAddresses();
      print(`觸發伺服器已啟動，手機請打：http://${hosts[0] ?? '<這台電腦的區網 IP>'}:${triggerServer.port}/trigger?token=...`);
      print('（完整網址含 token 請執行 npm run trigger-url）');
    }
    app.logger.info(
      { targets: app.config.targets.map((t) => t.key), pollMode: app.config.poll_mode, pollSeconds: app.config.poll_interval_seconds, publisher: app.publisher.name, trigger: app.config.trigger.enabled },
      'watcher 啟動',
    );
    if (flags.notifyExisting) {
      await watcher.runCycle({ notifyExisting: true });
    }
    await watcher.runLoop();
  } finally {
    await triggerServer?.close().catch(() => undefined);
    await phoneServer?.close().catch(() => undefined);
    await app.close();
    lock.release();
  }
}

async function cmdPhoneUrl(configPath: string | undefined): Promise<void> {
  await withApp({ configPath, logToFile: false }, async (app) => {
    const cfg = app.config.phone_ingest;
    if (!cfg.enabled) {
      print('目前 targets.yaml 的 phone_ingest.enabled 為 false。要讓手機把 Facebook 通知送過來，請設定：');
      print('');
      print('  phone_ingest:');
      print('    enabled: true');
      print('    notify_authors: []        # 例：只收群主 → [\'林大明\']');
      print('');
    }
    const token = app.secrets.phoneIngestToken;
    if (!token) {
      print(`還沒有設定 ${cfg.token_env}。請把下面這行加到 .env（這是剛剛產生的隨機密鑰）：`);
      print('');
      print(`  ${cfg.token_env}=${randomToken(24)}`);
      print('');
      print('存檔後再執行一次 npm run phone-url 就會印出完整網址。');
      return;
    }
    const hosts = lanAddresses();
    const host = hosts[0] ?? '<這台電腦的區網 IP>';
    const base = `http://${host}:${cfg.port}/phone/notify`;
    print('MacroDroid 的 HTTP 請求動作填這個網址（方法選 POST）：');
    print('');
    print(`  ${base}?token=${token}&title=[not_title]&text=[notification]&pkg=[not_app_package]`);
    print('');
    print('說明：');
    print('  1. [not_title] 與 [notification] 是 MacroDroid 的魔術文字，長按 URL 欄位可插入。');
    print('  2. 只傳文字就把 body 留空；要附截圖就把 body 設成「檔案內容」指向剛截好的圖片。');
    print('     （MacroDroid 不支援 multipart，所以圖片是以原始位元組當 body 傳送，接收端已配合。）');
    print(`  3. 目前設定：去重視窗 ${cfg.dedup_window_seconds} 秒、合併等待 ${cfg.debounce_seconds} 秒、單則最多列 ${cfg.max_items_per_message} 條。`);
    if (cfg.notify_authors.length) print(`  4. 只通知這些發話者：${cfg.notify_authors.join('、')}`);
    else print('  4. 目前不限發話者。要只收特定人，設定 phone_ingest.notify_authors。');
    print(`  5. 健康檢查：用手機瀏覽器開 http://${host}:${cfg.port}/health 應該看到一行文字。`);
    print('  6. 詳細步驟見 PHONE_INGEST.md。');
  });
}

async function cmdTriggerUrl(configPath: string | undefined): Promise<void> {
  await withApp({ configPath, logToFile: false }, async (app) => {
    const cfg = app.config.trigger;
    if (!cfg.enabled) {
      print('目前 targets.yaml 的 trigger.enabled 為 false。');
      print('要用手機通知觸發，請先在 targets.yaml 設定：');
      print('');
      print('  poll_mode: triggered');
      print('  poll_interval_seconds: 900      # 安全網：補抓不會產生手機通知的留言');
      print('  trigger:');
      print('    enabled: true');
      print('');
    }
    const token = app.secrets.triggerToken;
    if (!token) {
      print(`還沒有設定 ${cfg.token_env}。請把下面這行加到 .env（這是剛剛產生的隨機密鑰）：`);
      print('');
      print(`  ${cfg.token_env}=${randomToken(24)}`);
      print('');
      print('存檔後再執行一次 npm run trigger-url 就會印出完整網址。');
      return;
    }
    const hosts = lanAddresses();
    print('把下面的網址填進手機的 MacroDroid（動作：HTTP 請求 → GET）：');
    print('');
    for (const h of hosts) print(`  http://${h}:${cfg.port}/trigger?token=${token}&source=macrodroid`);
    if (!hosts.length) print(`  http://<這台電腦的區網 IP>:${cfg.port}/trigger?token=${token}&source=macrodroid`);
    print('');
    print('注意事項：');
    print('  1. 手機與這台電腦要在同一個家用 Wi-Fi。');
    print('  2. 電腦的區網 IP 可能會變，建議在路由器設定固定 IP（DHCP 保留）。');
    print(`  3. Windows 防火牆第一次會詢問是否允許 node.exe 連入，請選「允許」，或手動開放 TCP ${cfg.port}（僅限私人網路）。`);
    print('  4. 這是家用網路內的 HTTP，token 就是唯一的保護，不要外流、也不要把這個 port 轉發到網際網路。');
    print('  5. 詳細的 MacroDroid 設定步驟見 PHONE_TRIGGER.md。');
  });
}

async function cmdProbe(configPath: string | undefined, flags: { target?: string; headless?: boolean }): Promise<void> {
  await withApp({ configPath }, async (app) => {
    const browser = await app.openBrowser({ headless: flags.headless });
    const page = await browser.newPage();
    await preparePage(page);
    const dir = ensureDir(path.join(app.capturesDir, 'diagnostics'));
    for (const t of app.config.targets) {
      if (flags.target && t.key !== flags.target) continue;
      print('');
      print(`===== ${t.name}（${t.key}）=====`);
      const adapter = new FacebookSurfaceAdapter(t);
      try {
        const scan = await adapter.scan(page, { timeoutMs: app.config.browser.navigation_timeout_ms, quietMs: app.config.browser.quiet_period_ms });
        const stamp = toFileStamp(app.clock.now(), app.config.timezone);
        const shot = path.join(dir, `probe_${t.key}_${stamp}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        print(`頁面狀態：${scan.health.status}（標記：${scan.health.markers.join(', ') || '無'}）`);
        print(`網址：${scan.navigatedUrl}`);
        print(`頂層 article：${scan.health.articleCount}，feed：${scan.health.feedFound ? '有' : '無'}`);
        if (scan.extract) {
          const d = scan.extract.diagnostics;
          print(`排序標籤：${d.sortLabel ?? '未偵測'}；巢狀 article：${d.nestedArticles}；備註：${d.notes.join(', ') || '無'}`);
          if (scan.expand) print(`展開：查看更多 ${scan.expand.seeMoreClicks} 次、留言展開 ${scan.expand.commentExpanderClicks} 次、排序切換 ${scan.expand.sortSwitched ? '成功' : '未執行／失敗'}${scan.expand.limitReached ? '、達展開上限' : ''}`);
          print(`抽取貼文：${scan.extract.posts.length} 篇`);
          for (const raw of scan.extract.posts) {
            const p = normalizePost(raw, adapter.catalog);
            print(`- [${p.markId}] 信心 ${p.confidence.toFixed(2)} 作者=${p.author ?? '?'} 時間=${p.timeTitle ?? p.timeLabel ?? '?'} permalink=${p.permalink ?? '?'}`);
            print(`    文字(${p.text.length} 字)：${p.text.replace(/\n/g, ' ⏎ ').slice(0, 100)}`);
            print(`    媒體 ${p.media.length}、留言 ${p.comments.length}（回覆 ${p.comments.filter((c) => c.isReply).length}）、完整性 ${p.completeness}、缺少：${p.flags.join(',') || '無'}`);
            for (const c of p.comments.slice(0, 5)) print(`      ${c.isReply ? '↳' : '•'} [${c.markId}] 信心 ${c.confidence.toFixed(2)} ${c.author ?? '?'}：${c.text.replace(/\n/g, ' ').slice(0, 60)} ${c.permalink ? '(有 permalink)' : ''}`);
          }
          const json = path.join(dir, `probe_${t.key}_${stamp}.json`);
          writeFileSync(json, JSON.stringify({ target: t.key, health: scan.health, expand: scan.expand, extract: scan.extract, timings: scan.timings }, null, 2));
          print(`已存：${shot}`);
          print(`已存：${json}（回報問題時請附上這個檔案，內含畫面可見文字，請自行確認可否分享）`);
        } else {
          print(`頁面非 READY，未抽取。截圖：${shot}`);
        }
      } catch (e) {
        print(`❌ 失敗：${errorMessage(e)}`);
      }
    }
    await page.close();
  });
}

async function cmdHealth(configPath: string | undefined, json: boolean): Promise<void> {
  await withApp({ configPath, logToFile: false }, async (app) => {
    const report = buildHealthReport(app.db, app.config, app.clock);
    if (json) print(JSON.stringify(report, null, 2));
    else print(formatHealthReport(report, app.config.timezone));
  });
}

async function cmdGetLineIds(configPath: string | undefined, port: number): Promise<void> {
  await withApp({ configPath, logToFile: false }, async (app) => {
    const seen = new Set<string>();
    const server = await startLineIdsServer({
      port,
      channelSecret: app.secrets.lineChannelSecret,
      logger: app.logger,
      onEvent: (info) => {
        const id = info.groupId ?? info.roomId ?? info.userId;
        const type = info.groupId ? '群組 ID（groupId）' : info.roomId ? '多人聊天室 ID（roomId）' : '使用者 ID（userId）';
        const line = `${type}：${id}`;
        if (!seen.has(line)) {
          seen.add(line);
          print(`✅ 事件 ${info.eventType}（來源 ${info.sourceType}）→ ${line}`);
          if (info.groupId) print(`   → 把這個值填到 .env 的 LINE_DESTINATION_ID，並確認 targets.yaml 的 line.destination_type 為 group`);
        }
      },
    });
    print(`Webhook 接收器已在 http://127.0.0.1:${server.port}/ 等待。${app.secrets.lineChannelSecret ? '（會驗證 LINE 簽章）' : '（未設定 LINE_CHANNEL_SECRET，不驗證簽章）'}`);
    print('');
    print('接下來：');
    print(`  1. 另開一個終端機把它對外：cloudflared tunnel --url http://127.0.0.1:${server.port}`);
    print('     （或 ngrok http ' + server.port + '）。複製顯示的 https://... 網址。');
    print('  2. LINE Developers Console → 你的 channel → Messaging API → Webhook URL 填入該網址（結尾加 /webhook），');
    print('     開啟「Use webhook」並按 Verify。');
    print('  3. 用手機把 LINE 官方帳號加入目標群組（官方帳號需允許加入群組：Messaging API 設定 → Allow bot to join group chats）。');
    print('  4. 在群組裡隨便傳一句話，這裡就會印出群組 ID（C 開頭）。');
    print('  5. 取到 ID 後按 Ctrl+C 結束；正式運作不需要 webhook，可以把 Use webhook 關掉。');
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
    });
    await server.close();
  });
}

async function cmdTestLine(configPath: string | undefined): Promise<void> {
  await withApp({ configPath, requireLine: true, logToFile: false }, async (app) => {
    const info = await app.client.botInfo();
    if (!info.ok) {
      print(`❌ 無法取得官方帳號資訊（HTTP ${info.status}）：${info.body.slice(0, 200)}`);
      print('   請確認 LINE_CHANNEL_ACCESS_TOKEN 正確，且電腦可連到 api.line.me。');
      return;
    }
    print(`✅ 官方帳號：${info.body.slice(0, 200)}`);
    const now = toIsoWithOffset(app.clock.now(), app.config.timezone);
    const eventKey = sha256Hex(`test|${now}`);
    enqueueEvent(app.notifier, { eventKey, targetKey: '_system', entityKey: null, detectionMode: 'SYSTEM', payload: { kind: 'TEST', text: `【fb-line-watcher 測試】\n這是一則測試訊息，時間 ${now}。收到代表 LINE 設定正確。` }, screenshotPath: null, previewPath: null });
    const stats = await processDeliveries({ ...app.notifier, client: app.client, publisher: app.publisher });
    if (stats.sent === 1) print('✅ 測試訊息已送出，請到 LINE 群組確認。');
    else {
      const d = app.db.get<{ last_error: string | null; status: string }>('SELECT last_error, status FROM deliveries WHERE event_key = ?', eventKey);
      print(`❌ 發送失敗：${d?.status} ${d?.last_error ?? ''}`);
    }
  });
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      target: { type: 'string' },
      headless: { type: 'boolean' },
      'notify-existing': { type: 'boolean' },
      'baseline-only': { type: 'boolean' },
      json: { type: 'boolean' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = positionals[0];
  if (!cmd || values.help) {
    print(HELP);
    return 0;
  }
  const configPath = values.config;
  switch (cmd) {
    case 'login':
      await withApp({ configPath, logToFile: false }, async (app) => {
        const ok = await runLoginFlow(app.config, { rootDir: app.rootDir, logger: app.logger });
        if (!ok) process.exitCode = 1;
      });
      return process.exitCode === undefined ? 0 : Number(process.exitCode);
    case 'once':
      await cmdOnce(configPath, { target: values.target, notifyExisting: values['notify-existing'], baselineOnly: values['baseline-only'], headless: values.headless });
      return 0;
    case 'baseline':
      await cmdOnce(configPath, { target: values.target, baselineOnly: true, headless: values.headless });
      return 0;
    case 'resync':
      await cmdOnce(configPath, { target: values.target, resync: true, headless: values.headless });
      return 0;
    case 'watch':
      await cmdWatch(configPath, { headless: values.headless, notifyExisting: values['notify-existing'] });
      return 0;
    case 'trigger-url':
      await cmdTriggerUrl(configPath);
      return 0;
    case 'phone-url':
      await cmdPhoneUrl(configPath);
      return 0;
    case 'probe':
      await cmdProbe(configPath, { target: values.target, headless: values.headless });
      return 0;
    case 'health':
      await cmdHealth(configPath, !!values.json);
      return 0;
    case 'get-line-ids':
      await cmdGetLineIds(configPath, values.port ? Number(values.port) : 3000);
      return 0;
    case 'test-line':
      await cmdTestLine(configPath);
      return 0;
    case 'cleanup':
      await withApp({ configPath, logToFile: false }, async (app) => {
        await runMaintenance(app);
        print('清理完成。');
      });
      return 0;
    default:
      print(`未知命令：${cmd}\n`);
      print(HELP);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    if (e instanceof ConfigError || e instanceof LockHeldError) {
      console.error(`\n${e.message}\n`);
    } else {
      console.error('\n執行失敗：', e instanceof Error ? e.stack ?? e.message : e);
    }
    process.exitCode = 1;
  });
