import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../../fixtures/server.js';
import { TMP_ROOT } from './harness.js';

function run(args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('npx', ['tsx', path.resolve('src/cli.ts'), ...args], { cwd, env: { ...process.env, ...env }, timeout: 170_000 }, (err, stdout, stderr) => {
      resolve({ code: err && 'code' in err ? Number(err.code) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

describe('CLI', () => {
  let fixture: FixtureServer;
  let dir: string;
  beforeAll(async () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    dir = mkdtempSync(path.join(TMP_ROOT, 'cli-'));
    fixture = await startFixtureServer({ seedPosts: 2 });
    mkdirSync(path.join(dir, 'config'));
    writeFileSync(
      path.join(dir, 'config', 'targets.yaml'),
      `browser:\n  headed: false\n  quiet_period_ms: 100\n  navigation_timeout_ms: 20000\ntargets:\n  - key: page\n    name: 測試粉專\n    type: facebook_page\n    url: ${fixture.url('page')}\n    max_scrolls: 0\n`,
    );
    writeFileSync(path.join(dir, '.env'), 'LINE_CHANNEL_ACCESS_TOKEN=\nLINE_DESTINATION_ID=\n');
  });
  afterAll(async () => {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('無參數印出說明', async () => {
    const r = await run([], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('用法');
  });

  it('once 缺少 LINE 設定時 fail fast 並指出環境變數', async () => {
    const r = await run(['once', '--headless'], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('LINE_CHANNEL_ACCESS_TOKEN');
    expect(r.out).toContain('LINE_DESTINATION_ID');
  });

  it('設定檔錯誤時 fail fast', async () => {
    const bad = mkdtempSync(path.join(TMP_ROOT, 'cli-bad-'));
    mkdirSync(path.join(bad, 'config'));
    writeFileSync(path.join(bad, 'config', 'targets.yaml'), 'targets:\n  - key: x\n    name: X\n    type: facebook_group\n    url: https://www.facebook.com/notagroup\n');
    const r = await run(['health'], bad);
    expect(r.code).toBe(1);
    expect(r.out).toContain('設定檔驗證失敗');
    rmSync(bad, { recursive: true, force: true });
  });

  it('probe 不需要 LINE 設定，會印出辨識結果並存診斷檔', async () => {
    const r = await run(['probe', '--headless'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('頁面狀態：READY');
    expect(r.out).toContain('抽取貼文：2 篇');
    expect(r.out).toMatch(/信心 1\.00/);
    const diag = path.join(dir, 'captures', 'diagnostics');
    expect(existsSync(diag)).toBe(true);
    expect(readdirSync(diag).some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('health 可在尚未巡邏時執行', async () => {
    const r = await run(['health'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('fb-line-watcher 健康報告');
  });
});
