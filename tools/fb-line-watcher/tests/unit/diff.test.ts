import { describe, expect, it, beforeEach } from 'vitest';
import { Db } from '../../src/storage/db.js';
import { getEntity, upsertTarget, countEntities, type TargetRow } from '../../src/storage/repo.js';
import { applyDiff } from '../../src/detect/diff.js';
import { TargetSchema, type TargetConfig } from '../../src/config/schema.js';
import type { NormalizedComment, NormalizedPost } from '../../src/extract/fingerprint.js';

function target(over: Record<string, unknown> = {}): TargetConfig {
  return TargetSchema.parse({ key: 't1', name: 'T', type: 'facebook_page', url: 'https://www.facebook.com/x', ...over });
}

function post(over: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    markId: 'p0',
    index: 0,
    permalink: 'https://www.facebook.com/x/posts/1',
    author: '店家',
    timeLabel: '2 分鐘',
    timeTitle: '2026年9月3日 上午10:00',
    edited: false,
    text: '貼文一',
    media: [],
    comments: [],
    confidence: 1,
    completeness: 'COMPLETE_VISIBLE_SET',
    remainingExpanders: 0,
    flags: [],
    ...over,
  };
}

function comment(over: Partial<NormalizedComment> = {}): NormalizedComment {
  return { markId: 'c0', parentMarkId: null, depth: 1, isReply: false, permalink: 'https://www.facebook.com/x/posts/1?comment_id=10', author: '客人', text: '留言', media: [], confidence: 1, flags: [], ...over };
}

let db: Db;
let row: TargetRow;
const t = target();

beforeEach(() => {
  db = new Db(':memory:');
  row = upsertTarget(db, { key: t.key, name: t.name, type: t.type, url: t.url, enabled: true }, 'v1');
});

const T1 = '2026-09-03T10:00:00+08:00';
const T2 = '2026-09-03T10:03:00+08:00';
const T3 = '2026-09-03T10:06:00+08:00';

describe('applyDiff', () => {
  it('baseline 模式只建立現況，不產生事件', () => {
    const r = applyDiff({ db, target: t, targetRow: row, now: T1, baselineMode: true }, [post({ comments: [comment()] })]);
    expect(r.postChanges).toHaveLength(0);
    expect(r.commentChanges).toHaveLength(0);
    expect(countEntities(db, 't1')).toBe(2);
    expect(getEntity(db, r.seenKeys[0]!)?.known).toBe(1);
  });

  it('同樣內容重跑不產生事件；新貼文產生 NEW_POST；排序改變不算新增', () => {
    applyDiff({ db, target: t, targetRow: row, now: T1, baselineMode: true }, [post(), post({ markId: 'p1', permalink: 'https://www.facebook.com/x/posts/2', text: '貼文二' })]);
    let r = applyDiff({ db, target: t, targetRow: row, now: T2, baselineMode: false }, [post({ markId: 'p1', permalink: 'https://www.facebook.com/x/posts/2', text: '貼文二' }), post()]);
    expect(r.postChanges).toHaveLength(0);
    r = applyDiff({ db, target: t, targetRow: row, now: T3, baselineMode: false }, [post({ markId: 'p9', permalink: 'https://www.facebook.com/x/posts/3', text: '全新貼文' }), post(), post({ markId: 'p1', permalink: 'https://www.facebook.com/x/posts/2', text: '貼文二' })]);
    expect(r.postChanges.map((c) => c.kind)).toEqual(['NEW_POST']);
    expect(r.stats.newPosts).toBe(1);
    // 再跑一次不重複
    r = applyDiff({ db, target: t, targetRow: row, now: T3, baselineMode: false }, [post({ markId: 'p9', permalink: 'https://www.facebook.com/x/posts/3', text: '全新貼文' })]);
    expect(r.postChanges).toHaveLength(0);
  });

  it('相對時間與反應數變化不產生事件；文字改變產生 EDITED_POST 並帶原文', () => {
    applyDiff({ db, target: t, targetRow: row, now: T1, baselineMode: true }, [post()]);
    let r = applyDiff({ db, target: t, targetRow: row, now: T2, baselineMode: false }, [post({ timeLabel: '5 分鐘', reactionText: '全部心情：99', visibleCommentCountText: '3 則留言' })]);
    expect(r.postChanges).toHaveLength(0);
    r = applyDiff({ db, target: t, targetRow: row, now: T3, baselineMode: false }, [post({ text: '貼文一（已修改）', edited: true })]);
    expect(r.postChanges).toHaveLength(1);
    expect(r.postChanges[0]?.kind).toBe('EDITED_POST');
    expect(r.postChanges[0]?.previousText).toBe('貼文一');
    // detect_post_edits=false 時不通知
    const r2 = applyDiff({ db, target: target({ detect_post_edits: false }), targetRow: row, now: T3, baselineMode: false }, [post({ text: '貼文一（再修改）' })]);
    expect(r2.postChanges).toHaveLength(0);
  });

  it('新留言與回覆分類正確；新貼文附帶的既有留言不另外通知', () => {
    applyDiff({ db, target: t, targetRow: row, now: T1, baselineMode: true }, [post({ comments: [comment()] })]);
    let r = applyDiff({ db, target: t, targetRow: row, now: T2, baselineMode: false }, [
      post({
        comments: [
          comment(),
          comment({ markId: 'c1', permalink: 'https://www.facebook.com/x/posts/1?comment_id=11', text: '第二則' }),
          comment({ markId: 'c2', parentMarkId: 'c1', depth: 2, isReply: true, permalink: 'https://www.facebook.com/x/posts/1?comment_id=11&reply_comment_id=12', text: '回覆' }),
        ],
      }),
    ]);
    expect(r.commentChanges.map((c) => c.kind)).toEqual(['NEW_COMMENT', 'NEW_REPLY']);
    expect(r.stats.newComments).toBe(1);
    expect(r.stats.newReplies).toBe(1);
    const reply = getEntity(db, r.commentChanges[1]!.entityKey);
    expect(reply?.parent_entity_key).toBe(r.commentChanges[0]!.entityKey);
    // 新貼文帶留言：只通知貼文
    r = applyDiff({ db, target: t, targetRow: row, now: T3, baselineMode: false }, [post({ markId: 'p5', permalink: 'https://www.facebook.com/x/posts/5', text: '新的', comments: [comment({ markId: 'c7', permalink: 'https://www.facebook.com/x/posts/5?comment_id=70' })] })]);
    expect(r.postChanges).toHaveLength(1);
    expect(r.commentChanges).toHaveLength(0);
  });

  it('留言排序改變不產生事件；有 permalink 的留言被編輯 → EDITED_COMMENT', () => {
    applyDiff({ db, target: t, targetRow: row, now: T1, baselineMode: true }, [post({ comments: [comment(), comment({ markId: 'c1', permalink: 'https://www.facebook.com/x/posts/1?comment_id=11', text: 'B' })] })]);
    let r = applyDiff({ db, target: t, targetRow: row, now: T2, baselineMode: false }, [post({ comments: [comment({ markId: 'c0', permalink: 'https://www.facebook.com/x/posts/1?comment_id=11', text: 'B' }), comment({ markId: 'c1' })] })]);
    expect(r.commentChanges).toHaveLength(0);
    r = applyDiff({ db, target: t, targetRow: row, now: T3, baselineMode: false }, [post({ comments: [comment({ text: '留言（改）' })] })]);
    expect(r.commentChanges.map((c) => c.kind)).toEqual(['EDITED_COMMENT']);
  });

  it('作者白名單／黑名單與事件類型過濾會標記 suppressedReason 但仍記錄實體', () => {
    const tt = target({ notify_authors: ['群主'], notify_event_types: ['NEW_POST', 'NEW_COMMENT'] });
    applyDiff({ db, target: tt, targetRow: row, now: T1, baselineMode: true }, [post()]);
    const r = applyDiff({ db, target: tt, targetRow: row, now: T2, baselineMode: false }, [
      post({ markId: 'p1', permalink: 'https://www.facebook.com/x/posts/2', author: '路人', text: '路人貼文' }),
      post({ markId: 'p2', permalink: 'https://www.facebook.com/x/posts/3', author: '群主', text: '群主貼文', comments: [] }),
      post({ text: '貼文一（編輯）' }),
    ]);
    const kinds = r.postChanges.map((c) => `${c.kind}:${c.suppressedReason ?? 'ok'}`);
    expect(kinds).toContain('NEW_POST:author_not_in_allowlist');
    expect(kinds).toContain('NEW_POST:ok');
    expect(kinds).toContain('EDITED_POST:event_type_filtered:EDITED_POST');
    expect(r.stats.suppressed).toBe(2);
    expect(r.stats.newPosts).toBe(1);
    // 被過濾的實體仍已記錄，之後不會再觸發
    const again = applyDiff({ db, target: tt, targetRow: row, now: T3, baselineMode: false }, [post({ markId: 'p1', permalink: 'https://www.facebook.com/x/posts/2', author: '路人', text: '路人貼文' })]);
    expect(again.postChanges).toHaveLength(0);
  });

  it('低信心貼文需第二次取樣才通知；極低信心不建立實體', () => {
    applyDiff({ db, target: t, targetRow: row, now: T1, baselineMode: true }, []);
    let r = applyDiff({ db, target: t, targetRow: row, now: T2, baselineMode: false }, [post({ confidence: 0.7 }), post({ markId: 'p1', permalink: undefined, author: undefined, confidence: 0.5, text: '模糊' })]);
    expect(r.postChanges).toHaveLength(0);
    expect(r.stats.awaitingConfirmation).toBe(1);
    expect(r.stats.lowConfidenceSkipped).toBe(1);
    r = applyDiff({ db, target: t, targetRow: row, now: T3, baselineMode: false }, [post({ confidence: 0.7 })]);
    expect(r.postChanges).toHaveLength(1);
    expect(r.postChanges[0]?.lowConfidence).toBe(true);
  });
});
