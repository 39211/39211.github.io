/**
 * 長時間壓力測試：用 fixture Facebook 與 mock LINE，把 watcher 的完整循環反覆跑滿指定時間。
 *
 * 這支腳本存在的理由是「發布前的最小再驗 gate」要能在 Linux 與 Windows 各重跑一次，
 * 而且任何人都能重跑得到同一份判定，不必依賴某一次驗證環境。
 *
 *   npm run soak                 # 預設 30 分鐘
 *   npm run soak -- --minutes 5  # 短跑（開發時）
 *   npm run soak -- --json out.json
 *
 * 結束時所有 gate 必須為 PASS，否則以 exit code 1 結束。
 */
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { startFixtureServer } from '../fixtures/server.js';
import { startMockLine } from '../fixtures/mock-line.js';
import { createApp, type App } from '../src/app.js';
import { parseConfigObject } from '../src/config/load.js';
import type { Secrets } from '../src/config/schema.js';
import { createLogger } from '../src/logger.js';
import { Watcher } from '../src/worker/scheduler.js';
import { processDeliveries } from '../src/line/notifier.js';
import { startPhoneIngestServer, type PhoneIngestHandle } from '../src/worker/phone-ingest.js';
import { startTriggerServer, type TriggerServerHandle } from '../src/worker/trigger-server.js';
import { TINY_JPEG } from '../fixtures/images.js';

interface Args {
  minutes: number;
  json?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { minutes: 30 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--minutes') a.minutes = Number(argv[++i]);
    else if (argv[i] === '--json') a.json = argv[++i];
  }
  if (!Number.isFinite(a.minutes) || a.minutes <= 0) throw new Error('--minutes 必須是正數');
  return a;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

const TOKEN = 't'.repeat(32);
const PHONE_TOKEN = 'p'.repeat(32);
const PKG = 'com.facebook.katana';

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

interface Counters {
  iterations: number;
  cycles: number;
  restarts: number;
  lineAccepted: number;
  triggerRequests: number;
  phoneAccepted: number;
  phoneDuplicate: number;
  falsePositives: number;
  errors: string[];
  latencies: number[];
  maxPages: number;
  rssStart: number;
  rssEnd: number;
  rssMax: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'fblw-soak-'));
  const fixture = await startFixtureServer({ seedPosts: 3 });
  const line = await startMockLine();
  const triggerPort = await freePort();
  const phonePort = await freePort();

  const config = parseConfigObject({
    poll_interval_seconds: 20,
    comment_debounce_seconds: 0,
    extractor_failure_threshold: 2,
    visual_confirm_after_seconds: 0,
    browser: { headed: false, viewport: { width: 1200, height: 900 }, navigation_timeout_ms: 20000, quiet_period_ms: 150, profile_dir: 'profile' },
    line: { api_base_url: line.baseUrl, retry_schedule_seconds: [1, 1, 1], system_alert_cooldown_minutes: 60 },
    images: { publisher: 'none' },
    trigger: { enabled: true, port: triggerPort, bind: '127.0.0.1', min_interval_seconds: 0, delay_seconds: 0 },
    phone_ingest: { enabled: true, port: phonePort, bind: '127.0.0.1', debounce_seconds: 0, dedup_window_seconds: 600 },
    targets: [
      { key: 'page', name: '阿爸洗鞋店', type: 'facebook_page', url: fixture.url('page'), scan_latest_posts: 6, max_scrolls: 1 },
      { key: 'group', name: '青海路洗鞋交流社團', type: 'facebook_group', url: fixture.url('group'), scan_latest_posts: 6, max_scrolls: 1 },
    ],
  });
  const secrets: Secrets = { lineAccessToken: 'soak-token-abcdef', lineDestinationId: `C${'a'.repeat(32)}`, publicBaseUrl: 'https://img.example.test', triggerToken: TOKEN, phoneIngestToken: PHONE_TOKEN };
  const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
  mkdirSync(rootDir, { recursive: true });
  const logStream = createWriteStream(path.join(rootDir, 'soak.log'), { flags: 'a' });
  const logger = createLogger({ stream: logStream, level: 'info' });

  let app: App = await createApp({ config, secrets, rootDir, logger, clock, logToFile: false });
  let watcher = new Watcher(app);
  let trigger: TriggerServerHandle | undefined;
  let phone: PhoneIngestHandle | undefined;

  const c: Counters = {
    iterations: 0,
    cycles: 0,
    restarts: 0,
    lineAccepted: 0,
    triggerRequests: 0,
    phoneAccepted: 0,
    phoneDuplicate: 0,
    falsePositives: 0,
    errors: [],
    latencies: [],
    maxPages: 0,
    rssStart: process.memoryUsage().rss,
    rssEnd: 0,
    rssMax: 0,
  };

  const startServers = async (): Promise<void> => {
    trigger = await startTriggerServer({
      port: 0,
      bind: '127.0.0.1',
      token: TOKEN,
      minIntervalMs: 0,
      logger: app.logger,
      onTrigger: () => undefined,
    });
    phone = await startPhoneIngestServer({
      db: app.db,
      config: app.config.phone_ingest,
      token: PHONE_TOKEN,
      capturesDir: app.capturesDir,
      timezone: app.config.timezone,
      logger: app.logger,
      now: () => app.clock.now(),
      port: 0,
      bind: '127.0.0.1',
    });
  };
  const stopServers = async (): Promise<void> => {
    await trigger?.close().catch(() => undefined);
    await phone?.close().catch(() => undefined);
    trigger = undefined;
    phone = undefined;
  };

  const cycle = async (): Promise<void> => {
    const t0 = Date.now();
    const s = await watcher.runCycle();
    c.cycles += s.results.length;
    c.latencies.push((Date.now() - t0) / 1000);
    for (const r of s.results) if (r.error) c.errors.push(`cycle ${r.targetKey}: ${r.error}`);
    c.lineAccepted = line.accepted.length;
    const pages = app.browser?.pages().length ?? 0;
    if (pages > c.maxPages) c.maxPages = pages;
  };

  /** 沒有任何變更時再跑一輪，必須 0 事件；有事件就是誤報 */
  const expectQuiet = async (): Promise<void> => {
    const s = await watcher.runCycle();
    c.cycles += s.results.length;
    for (const r of s.results) {
      if (r.eventsCreated > 0 || r.groupsUpdated > 0) {
        c.falsePositives++;
        c.errors.push(`false positive on ${r.targetKey}: events=${r.eventsCreated} groups=${r.groupsUpdated}`);
      }
    }
  };

  const restart = async (): Promise<void> => {
    watcher.stop();
    await stopServers();
    await app.close();
    app = await createApp({ config, secrets, rootDir, logger, clock, logToFile: false });
    watcher = new Watcher(app);
    await startServers();
    c.restarts++;
  };

  await startServers();
  await watcher.runCycle(); // baseline
  const deadline = Date.now() + args.minutes * 60_000;
  let round = 0;

  try {
    while (Date.now() < deadline) {
      round++;
      const kind = round % 2 === 0 ? 'page' : 'group';

      // 1. 新貼文
      await fixture.control(kind, 'add-post', { text: `壓測第 ${round} 輪的新貼文`, images: round % 3 === 0 ? 1 : 0 });
      await cycle();

      // 2. 編輯貼文
      const state = await fixture.control<{ posts: { id: number; text: string }[] }>(kind, 'state');
      const target = state.posts.find((p) => p.text.includes(`第 ${round} 輪`));
      if (target) {
        await fixture.control(kind, 'edit-post', { id: target.id, text: `壓測第 ${round} 輪的新貼文（已編輯）` });
        await cycle();

        // 3. 新留言 + 新回覆
        const cid = await fixture.control<{ id: number }>(kind, 'add-comment', { postId: target.id, author: '陳美玲', text: `第 ${round} 輪留言` });
        await cycle();
        await fixture.control(kind, 'add-reply', { postId: target.id, commentId: cid.id, author: '王志豪', text: `第 ${round} 輪回覆` });
        await cycle();
      }

      // 4. 無變更重跑 → 不得產生事件
      await expectQuiet();

      // 5. 相對時間、反應數、排序改變 → 不得產生事件
      await fixture.control(kind, 'tick', { minutes: 3 });
      await fixture.control(kind, 'bump-reactions', { by: 2 });
      await fixture.control(kind, 'shuffle');
      await expectQuiet();

      // 6. 突發貼文
      for (let i = 0; i < 3; i++) await fixture.control(kind, 'add-post', { text: `突發第 ${round}-${i}` });
      await cycle();

      // 7. LINE 500 之後必須重試成功
      line.failNext(500, 1);
      await fixture.control(kind, 'add-post', { text: `重試測試第 ${round} 輪` });
      await cycle();
      for (let i = 0; i < 5; i++) {
        const st = await processDeliveries({ ...app.notifier, client: app.client, publisher: app.publisher });
        if (st.dead > 0) c.errors.push(`delivery dead letter on round ${round}`);
        if (st.processed === 0) break;
      }

      // 8. trigger 併發
      const triggerUrl = `http://127.0.0.1:${trigger!.port}/trigger?token=${TOKEN}`;
      const triggerResults = await Promise.all(Array.from({ length: 20 }, () => fetch(triggerUrl, { method: 'POST' }).then((r) => r.status).catch(() => 0)));
      c.triggerRequests += triggerResults.length;
      for (const st of triggerResults) if (st !== 200 && st !== 429) c.errors.push(`trigger unexpected status ${st}`);

      // 9. 手機通知併發去重（同一則送 10 次，只能接受 1 次）
      const phoneUrl = `http://127.0.0.1:${phone!.port}/phone/notify`;
      const q = new URLSearchParams({ token: PHONE_TOKEN, pkg: PKG, title: '林大明', text: `手機通知第 ${round} 輪` }).toString();
      const phoneResults = await Promise.all(
        Array.from({ length: 10 }, (_, i) => fetch(`${phoneUrl}?${q}`, { method: 'POST', ...(i === 0 ? { body: TINY_JPEG } : {}) }).then((r) => r.text()).catch(() => 'error')),
      );
      const acc = phoneResults.filter((r) => r === 'accepted').length;
      const dup = phoneResults.filter((r) => r.startsWith('duplicate')).length;
      c.phoneAccepted += acc;
      c.phoneDuplicate += dup;
      if (acc !== 1) c.errors.push(`phone dedup: expected 1 accepted, got ${acc} (round ${round})`);
      if (acc + dup !== phoneResults.length) c.errors.push(`phone unexpected responses: ${JSON.stringify([...new Set(phoneResults)])}`);
      await cycle();

      // 10. 每 5 輪重啟一次，驗證重啟後不重送、未送出的補送
      if (round % 5 === 0) {
        await restart();
        await cycle();
      }

      const rss = process.memoryUsage().rss;
      if (rss > c.rssMax) c.rssMax = rss;
      c.iterations++;
      const left = Math.max(0, deadline - Date.now());
      process.stdout.write(`\r[soak] 第 ${c.iterations} 輪完成，剩餘 ${(left / 60_000).toFixed(1)} 分鐘，LINE ${c.lineAccepted} 則，錯誤 ${c.errors.length}   `);
    }
  } catch (e) {
    c.errors.push(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }

  process.stdout.write('\n');
  // 收尾：把還在等待的通知全部送完
  for (let i = 0; i < 10; i++) {
    const st = await processDeliveries({ ...app.notifier, client: app.client, publisher: app.publisher });
    if (st.processed === 0) break;
  }
  c.rssEnd = process.memoryUsage().rss;
  c.lineAccepted = line.accepted.length;

  const db = app.db;
  const pending = db.get<{ c: number }>("SELECT COUNT(*) c FROM deliveries WHERE status IN ('PENDING','FAILED_RETRYABLE')")?.c ?? 0;
  const dead = db.get<{ c: number }>("SELECT COUNT(*) c FROM deliveries WHERE status = 'DEAD_LETTER'")?.c ?? 0;
  const events = db.get<{ c: number }>('SELECT COUNT(*) c FROM events')?.c ?? 0;
  const deliveries = db.get<{ c: number }>('SELECT COUNT(*) c FROM deliveries')?.c ?? 0;
  const sent = db.get<{ c: number }>("SELECT COUNT(*) c FROM deliveries WHERE status = 'SENT'")?.c ?? 0;
  const uncommitted = db.get<{ c: number }>('SELECT COUNT(*) c FROM entities WHERE known = 0 AND active = 1')?.c ?? 0;
  const sortedLat = [...c.latencies].sort((a, b) => a - b);

  const mib = (n: number): number => Math.round((n / 1024 / 1024) * 10) / 10;
  const gates: { name: string; pass: boolean; detail: string }[] = [
    { name: '零錯誤', pass: c.errors.length === 0, detail: `${c.errors.length}` },
    { name: '零誤報', pass: c.falsePositives === 0, detail: `${c.falsePositives}` },
    { name: '零 pending delivery', pass: pending === 0, detail: `${pending}` },
    { name: '零 dead letter', pass: dead === 0, detail: `${dead}` },
    { name: 'event 與 delivery 一致', pass: events === deliveries && deliveries === sent, detail: `events=${events} deliveries=${deliveries} sent=${sent}` },
    { name: '沒有未提交的偵測狀態殘留', pass: uncommitted === 0, detail: `${uncommitted}` },
    { name: '瀏覽器頁數受控（<= 6）', pass: c.maxPages <= 6, detail: `${c.maxPages}` },
    { name: '記憶體無明顯洩漏（結束 < 起始 + 300 MiB）', pass: c.rssEnd < c.rssStart + 300 * 1024 * 1024, detail: `${mib(c.rssStart)} → ${mib(c.rssEnd)} MiB（最大 ${mib(c.rssMax)}）` },
    { name: '至少跑滿指定時間', pass: c.iterations > 0, detail: `${c.iterations} 輪` },
  ];

  const report = {
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    minutes: args.minutes,
    iterations: c.iterations,
    cycles: c.cycles,
    restarts: c.restarts,
    lineAccepted: c.lineAccepted,
    triggerRequests: c.triggerRequests,
    phone: { accepted: c.phoneAccepted, duplicate: c.phoneDuplicate },
    falsePositives: c.falsePositives,
    pending,
    dead,
    events,
    deliveries,
    sent,
    uncommitted,
    latencySeconds: { p50: pct(sortedLat, 50), p95: pct(sortedLat, 95), p99: pct(sortedLat, 99), max: sortedLat.at(-1) ?? 0 },
    rssMiB: { start: mib(c.rssStart), end: mib(c.rssEnd), max: mib(c.rssMax) },
    maxBrowserPages: c.maxPages,
    gates,
    errors: c.errors.slice(0, 50),
  };

  console.log('\n===== 壓測結果 =====');
  console.log(JSON.stringify(report, null, 2));
  for (const g of gates) console.log(`${g.pass ? 'PASS' : 'FAIL'}  ${g.name}：${g.detail}`);
  if (args.json) await writeFile(args.json, JSON.stringify(report, null, 2), 'utf8');

  watcher.stop();
  await stopServers();
  await app.close().catch(() => undefined);
  await fixture.close();
  await line.close();
  logStream.end();
  if (process.env.FBLW_KEEP_TMP !== '1') rmSync(rootDir, { recursive: true, force: true });

  const failed = gates.filter((g) => !g.pass);
  if (failed.length) {
    console.error(`\n壓測未通過：${failed.map((g) => g.name).join('、')}`);
    process.exitCode = 1;
  } else {
    console.log('\n所有壓測 gate 通過。');
  }
}

await main();
