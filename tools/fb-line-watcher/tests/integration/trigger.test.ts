import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, waitFor, type Harness } from './harness.js';
import { startTriggerServer, type TriggerServerHandle } from '../../src/worker/trigger-server.js';

const TOKEN = 't'.repeat(32);

/**
 * 驗證「手機通知觸發」這條路：watcher 平常不巡邏（安全網間隔設 1 小時），
 * 收到觸發後幾秒內就完成一次巡邏並發出 LINE。
 */
describe('手機觸發模式（poll_mode: triggered）', () => {
  let h: Harness;
  let server: TriggerServerHandle;
  let loop: Promise<void>;
  let triggerUrl: string;

  const scans = (): number => h.app.db.get<{ c: number }>('SELECT COUNT(*) c FROM extractor_health')?.c ?? 0;

  beforeAll(async () => {
    h = await setupHarness({
      targets: ['page'],
      configOverrides: {
        poll_mode: 'triggered',
        poll_interval_seconds: 3600, // 安全網：測試期間絕不會自己到期
        comment_debounce_seconds: 0,
        trigger: { enabled: true, port: 8799, bind: '127.0.0.1', min_interval_seconds: 0, delay_seconds: 0 },
      },
    });
    await h.cycle(); // baseline
    server = await startTriggerServer({
      port: 0,
      bind: '127.0.0.1',
      token: TOKEN,
      minIntervalMs: 0,
      logger: h.app.logger,
      onTrigger: (req) => h.watcher.requestImmediateCycle(`phone:${req.source}`, req.targetKey),
    });
    triggerUrl = `http://127.0.0.1:${server.port}/trigger?token=${TOKEN}&source=macrodroid`;
    loop = h.watcher.runLoop();
    await waitFor('runLoop 的第一輪巡邏完成', () => scans() >= 2);
  }, 180_000);

  afterAll(async () => {
    h.watcher.stop();
    await loop.catch(() => undefined);
    await server.close();
    await h.close();
  });

  it('沒有觸發時不會自己巡邏（安全網間隔還沒到）', async () => {
    const before = scans();
    await new Promise((r) => setTimeout(r, 3000));
    expect(scans()).toBe(before);
    expect(h.line.accepted).toHaveLength(0);
  });

  it('新貼文 + 手機觸發 → 數秒內收到 LINE 通知', async () => {
    await h.fixture.control('page', 'add-post', { text: '手機通知觸發後才抓到的新貼文', images: 1 });
    const before = scans();
    const res = await fetch(triggerUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('accepted');
    await waitFor('觸發後的巡邏完成', () => scans() > before, 60_000);
    await waitFor('LINE 收到通知', () => h.line.accepted.length >= 1, 60_000);
    expect(h.line.accepted).toHaveLength(1);
    const text = h.line.accepted[0]!.body.messages![0]!.text!;
    expect(text).toContain('【Facebook 新貼文】');
    expect(text).toContain('手機通知觸發後才抓到的新貼文');
  });

  it('沒有新內容時觸發不會產生通知', async () => {
    const before = scans();
    expect((await fetch(triggerUrl)).status).toBe(200);
    await waitFor('第二次觸發的巡邏完成', () => scans() > before, 60_000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(h.line.accepted).toHaveLength(1);
  });

  it('token 錯誤的觸發不會讓 watcher 動作', async () => {
    const before = scans();
    const res = await fetch(`http://127.0.0.1:${server.port}/trigger?token=wrong`);
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 3000));
    expect(scans()).toBe(before);
  });
});
