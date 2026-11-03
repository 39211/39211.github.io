import { describe, expect, it } from 'vitest';
import { commentGroupEventKey, mergeCommentGroup } from '../../src/detect/groups.js';
import type { CommentChange } from '../../src/detect/diff.js';
import type { NormalizedComment, NormalizedPost } from '../../src/extract/fingerprint.js';
import { commentContentHash } from '../../src/extract/fingerprint.js';
import { parseConfigObject } from '../../src/config/load.js';
import type { CommentItem } from '../../src/events.js';

const target = parseConfigObject({
  targets: [{ key: 'g', name: '社團', type: 'facebook_group', url: 'https://www.facebook.com/groups/1' }],
}).targets[0]!;

function comment(text: string, permalink = 'https://www.facebook.com/groups/1/posts/9/?comment_id=1'): NormalizedComment {
  return {
    markId: 'c1',
    parentMarkId: null,
    depth: 0,
    isReply: false,
    permalink,
    author: '客人',
    text,
    media: [],
    confidence: 1,
    flags: [],
  };
}

function post(): NormalizedPost {
  return {
    markId: 'p1',
    index: 0,
    permalink: 'https://www.facebook.com/groups/1/posts/9/',
    author: '林大明',
    text: '公告',
    media: [],
    comments: [],
    confidence: 1,
    completeness: 'COMPLETE_VISIBLE_SET',
    remainingExpanders: 0,
    flags: [],
  };
}

function change(kind: CommentChange['kind'], text: string): CommentChange {
  const c = comment(text);
  return {
    kind,
    post: post(),
    postEntityKey: 'post-key',
    comment: c,
    entityKey: 'comment-key',
    commit: { entityKey: 'comment-key', contentHash: commentContentHash(c) },
  };
}

describe('commentGroupEventKey', () => {
  const a: CommentItem = { entityKey: 'c1', kind: 'NEW_COMMENT', text: '你們幾點開門？', isReply: false, depth: 0, contentHash: 'aaa' };
  const b: CommentItem = { ...a, kind: 'EDITED_COMMENT', text: '你們幾點開門？（週日呢）', contentHash: 'bbb' };

  it('同一批 items 的同一份內容得到同一把 key（冪等）', () => {
    const k1 = commentGroupEventKey('g', 'post', [a]);
    const k2 = commentGroupEventKey('g', 'post', [a]);
    expect(k1).toBe(k2);
  });

  it('同一批 entity 但內容不同 → 不同的 key', () => {
    expect(commentGroupEventKey('g', 'post', [a])).not.toBe(commentGroupEventKey('g', 'post', [b]));
  });

  it('key 不含 wall-clock 時間字串', () => {
    const k = commentGroupEventKey('g', 'post', [a]);
    expect(k).not.toMatch(/2026|T\d{2}:/);
  });
});

describe('mergeCommentGroup', () => {
  it('同一 entityKey 再次出現時覆寫 kind／文字／contentHash，而不是略過', () => {
    const first = mergeCommentGroup(undefined, [change('NEW_COMMENT', '你們幾點開門？')], target, 'https://x', 't1');
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.kind).toBe('NEW_COMMENT');
    const second = mergeCommentGroup(first, [change('EDITED_COMMENT', '你們幾點開門？（週日呢）')], target, 'https://x', 't2');
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.kind).toBe('EDITED_COMMENT');
    expect(second.items[0]!.text).toContain('週日');
    expect(second.items[0]!.contentHash).toBeTruthy();
    expect(second.items[0]!.contentHash).not.toBe(first.items[0]!.contentHash);
    expect(commentGroupEventKey('g', 'post-key', first.items)).not.toBe(commentGroupEventKey('g', 'post-key', second.items));
  });
});
