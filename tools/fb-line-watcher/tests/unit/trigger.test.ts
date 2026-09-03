import { afterEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { clearSecretsForTest, createLogger, registerSecret } from '../../src/logger.js';
import { startTriggerServer, type TriggerRequest, type TriggerServerHandle } from '../../src/worker/trigger-server.js';
import { parseConfigObject } from '../../src/config/load.js';

const TOKEN = 'a'.repeat(32);
const lines: string[] = [];
const sink = new Writable({
  write(c, _e, cb) {
    lines.push(c.toString());
    cb();
  },
});

let server: TriggerServerHandle | undefined;
let now = 1_000_000;
let received: TriggerRequest[] = [];

async function start(minIntervalMs = 20_000): Promise<TriggerServerHandle> {
  received = [];
  lines.length = 0;
  clearSecretsForTest();
  registerSecret(TOKEN);
  server = await startTriggerServer({
    port: 0,
    bind: '127.0.0.1',
    token: TOKEN,
    minIntervalMs,
    logger: createLogger({ stream: sink, level: 'debug' }),
    now: () => now,
    onTrigger: (r) => received.push(r),
  });
  return server;
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('觸發伺服器', () => {
  it('token 正確才接受；錯誤或缺少一律 401 且不觸發', async () => {
    const s = await start();
    expect(s.handle(TOKEN, { source: 'macrodroid' })).toMatchObject({ status: 200, verdict: 'accepted' });
    expect(received).toHaveLength(1);
    now += 60_000;
    expect(s.handle('b'.repeat(32), { source: 'x' }).status).toBe(401);
    expect(s.handle(undefined, { source: 'x' }).status).toBe(401);
    expect(s.handle('short', { source: 'x' }).status).toBe(401);
    expect(received).toHaveLength(1);
  });

  it('最小間隔內的重複觸發回 throttled，不會排隊重複巡邏', async () => {
    const s = await start(20_000);
    expect(s.handle(TOKEN, { source: 'a' }).verdict).toBe('accepted');
    now += 5_000;
    const second = s.handle(TOKEN, { source: 'b' });
    expect(second.verdict).toBe('throttled');
    expect(second.status).toBe(200);
    expect(second.message).toContain('15s');
    now += 16_000;
    expect(s.handle(TOKEN, { source: 'c' }).verdict).toBe('accepted');
    expect(received.map((r) => r.source)).toEqual(['a', 'c']);
  });

  it('經由真實 HTTP 傳入 query 參數，並支援 header 帶 token', async () => {
    const s = await start(0);
    const base = `http://127.0.0.1:${s.port}/trigger`;
    const r1 = await fetch(`${base}?token=${TOKEN}&source=macrodroid&target=group&text=${encodeURIComponent('林大明 在社團中發佈了貼文')}`);
    expect(r1.status).toBe(200);
    expect(await r1.text()).toBe('accepted');
    expect(received[0]).toMatchObject({ source: 'macrodroid', targetKey: 'group', text: '林大明 在社團中發佈了貼文' });

    const r2 = await fetch(base, { method: 'POST', headers: { 'X-Trigger-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'tasker' }) });
    expect(r2.status).toBe(200);
    expect(received[1]?.source).toBe('tasker');

    expect((await fetch(`${base}?token=wrong`)).status).toBe(401);
    expect((await fetch(base, { method: 'DELETE' })).status).toBe(405);
  });

  it('token 不會出現在日誌中', async () => {
    const s = await start(0);
    await fetch(`http://127.0.0.1:${s.port}/trigger?token=${TOKEN}&source=macrodroid`);
    await fetch(`http://127.0.0.1:${s.port}/trigger?token=wrong-token-value`);
    await new Promise((r) => setTimeout(r, 50));
    const out = lines.join('');
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('收到手機觸發');
  });
});

describe('poll_mode 設定驗證', () => {
  const targets = [{ key: 'a', name: 'A', type: 'facebook_page', url: 'https://www.facebook.com/a' }];
  it('triggered 模式必須同時開啟 trigger.enabled', () => {
    expect(() => parseConfigObject({ poll_mode: 'triggered', targets })).toThrow(/trigger\.enabled/);
    const ok = parseConfigObject({ poll_mode: 'triggered', poll_interval_seconds: 900, trigger: { enabled: true }, targets });
    expect(ok.trigger.port).toBe(8799);
    expect(ok.trigger.min_interval_seconds).toBe(20);
    expect(ok.trigger.delay_seconds).toBe(8);
  });
  it('預設仍是固定週期模式，且觸發預設關閉', () => {
    const c = parseConfigObject({ targets });
    expect(c.poll_mode).toBe('interval');
    expect(c.trigger.enabled).toBe(false);
  });
});
