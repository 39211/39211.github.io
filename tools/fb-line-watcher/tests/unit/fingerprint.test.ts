import { describe, expect, it } from 'vitest';
import { commentIdentity, normalizePost, postContentHash, postIdentity } from '../../src/extract/fingerprint.js';
import { DEFAULT_CATALOG } from '../../src/adapters/catalog.js';
import type { RawPost } from '../../src/adapters/types.js';

function rawPost(over: Partial<RawPost> = {}): RawPost {
  return {
    markId: 'p0',
    index: 0,
    permalink: 'https://www.facebook.com/page/posts/abc123',
    author: '阿爸洗鞋店',
    timeLabel: '2 分鐘',
    timeTitle: '2026年9月3日 星期三 上午10:32',
    edited: false,
    sponsored: false,
    text: '今天天氣很好\n讚\n回覆\n2 分鐘',
    media: [{ type: 'image', fingerprint: '111_222_333', alt: '可能是圖像' }],
    comments: [],
    remainingExpanders: 0,
    confidence: 1,
    flags: [],
    ...over,
  };
}

describe('post identity / content hash', () => {
  it('permalink 相同、內容改變 → 同一 entity、不同 content hash（EDITED_POST）', () => {
    const a = normalizePost(rawPost(), DEFAULT_CATALOG);
    const b = normalizePost(rawPost({ text: '今天天氣很好（已更新）' }), DEFAULT_CATALOG);
    expect(postIdentity('t', a).key).toBe(postIdentity('t', b).key);
    expect(postIdentity('t', a).strategy).toBe('permalink');
    expect(postContentHash(a)).not.toBe(postContentHash(b));
  });
  it('相對時間與反應數變化不改變 content hash', () => {
    const a = normalizePost(rawPost({ timeLabel: '2 分鐘', reactionText: '全部心情：12' }), DEFAULT_CATALOG);
    const b = normalizePost(rawPost({ timeLabel: '3 分鐘', reactionText: '全部心情：13', text: '今天天氣很好\n讚\n回覆\n3 分鐘' }), DEFAULT_CATALOG);
    expect(postContentHash(a)).toBe(postContentHash(b));
  });
  it('沒有 permalink 時用作者＋絕對時間＋文字前綴，相對時間改變仍穩定', () => {
    const a = normalizePost(rawPost({ permalink: undefined, timeLabel: '2 分鐘' }), DEFAULT_CATALOG);
    const b = normalizePost(rawPost({ permalink: undefined, timeLabel: '5 分鐘' }), DEFAULT_CATALOG);
    expect(postIdentity('t', a)).toEqual(postIdentity('t', b));
    expect(postIdentity('t', a).strategy).toBe('author_time_text');
  });
  it('圖片替換會改變 content hash', () => {
    const a = normalizePost(rawPost(), DEFAULT_CATALOG);
    const b = normalizePost(rawPost({ media: [{ type: 'image', fingerprint: '999_888_777' }] }), DEFAULT_CATALOG);
    expect(postContentHash(a)).not.toBe(postContentHash(b));
  });
  it('不同 target 的相同 permalink 是不同 entity', () => {
    const a = normalizePost(rawPost(), DEFAULT_CATALOG);
    expect(postIdentity('t1', a).key).not.toBe(postIdentity('t2', a).key);
  });
});

describe('comment identity', () => {
  it('有 comment permalink 時以 permalink 為準', () => {
    const c = normalizePost(rawPost({ comments: [{ markId: 'c0', parentMarkId: null, depth: 1, isReply: false, permalink: 'https://www.facebook.com/page/posts/abc?comment_id=555', author: '張三', text: '哈囉', media: [], confidence: 1, flags: [] }] }), DEFAULT_CATALOG).comments[0]!;
    const id = commentIdentity('t', 'rootkey', null, c);
    expect(id.strategy).toBe('permalink');
    const c2 = { ...c, text: '哈囉（改）' };
    expect(commentIdentity('t', 'rootkey', null, c2).key).toBe(id.key);
  });
  it('沒有 permalink 時以父鍵＋作者＋文字前綴組成', () => {
    const c = normalizePost(rawPost({ comments: [{ markId: 'c0', parentMarkId: null, depth: 1, isReply: false, author: '張三', text: '哈囉', media: [], confidence: 1, flags: [] }] }), DEFAULT_CATALOG).comments[0]!;
    const a = commentIdentity('t', 'root', null, c);
    const b = commentIdentity('t', 'root', 'parentX', c);
    expect(a.strategy).toBe('parent_author_text');
    expect(a.key).not.toBe(b.key);
  });
});
