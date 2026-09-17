import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireSingleInstanceLock, LockHeldError } from '../../src/worker/lock.js';
import { verifyLineSignature } from '../../src/line/ids-server.js';
import { createHmac } from 'node:crypto';
import { mergeCommentGroup, summarizeItems } from '../../src/detect/groups.js';
import { TargetSchema } from '../../src/config/schema.js';

describe('單實例鎖', () => {
  it('第二個實例（另一個活著的 PID）會被拒絕；殘留鎖可回收', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fblw-lock-'));
    const lock = path.join(dir, 'watcher.lock');
    const a = acquireSingleInstanceLock(lock, { pid: 111, isAlive: () => true });
    expect(() => acquireSingleInstanceLock(lock, { pid: 222, isAlive: () => true })).toThrow(LockHeldError);
    a.release();
    const b = acquireSingleInstanceLock(lock, { pid: 222, isAlive: () => true });
    b.release();
    // 殘留鎖（PID 已死）
    acquireSingleInstanceLock(lock, { pid: 333, isAlive: () => true });
    const c = acquireSingleInstanceLock(lock, { pid: 444, isAlive: () => false });
    c.release();
  });
});

describe('LINE webhook 簽章', () => {
  it('正確簽章通過、錯誤簽章拒絕', () => {
    const body = Buffer.from('{"events":[]}');
    const sig = createHmac('sha256', 'secret').update(body).digest('base64');
    expect(verifyLineSignature(body, sig, 'secret')).toBe(true);
    expect(verifyLineSignature(body, sig, 'other')).toBe(false);
    expect(verifyLineSignature(body, undefined, 'secret')).toBe(false);
  });
});

describe('留言合併群組', () => {
  it('以 entityKey 去重並保留首次時間', () => {
    const target = TargetSchema.parse({ key: 'g', name: 'G', type: 'facebook_group', url: 'https://www.facebook.com/groups/1' });
    const post = { markId: 'p0', index: 0, text: '父貼文內容', media: [], comments: [], confidence: 1, completeness: 'COMPLETE_VISIBLE_SET' as const, remainingExpanders: 0, flags: [], edited: false, author: '群主' };
    const mk = (key: string, kind: 'NEW_COMMENT' | 'NEW_REPLY') => ({ kind, post, postEntityKey: 'root', entityKey: key, comment: { markId: key, parentMarkId: null, depth: kind === 'NEW_REPLY' ? 2 : 1, isReply: kind === 'NEW_REPLY', text: `t-${key}`, media: [], confidence: 1, flags: [] } });
    const a = mergeCommentGroup(undefined, [mk('k1', 'NEW_COMMENT'), mk('k2', 'NEW_REPLY')], target, 'https://www.facebook.com/groups/1', 'T1');
    const b = mergeCommentGroup(a, [mk('k2', 'NEW_REPLY'), mk('k3', 'NEW_COMMENT')], target, 'https://www.facebook.com/groups/1', 'T2');
    expect(b.items.map((i) => i.entityKey)).toEqual(['k1', 'k2', 'k3']);
    expect(b.firstDetectedAt).toBe('T1');
    expect(b.detectedAt).toBe('T2');
    expect(summarizeItems(b.items)).toBe('新增留言 2 則、回覆 1 則');
  });
});
