import type { CommentsEventPayload, CommentItem } from '../events.js';
import type { CommentChange } from './diff.js';
import { commentContentHash } from '../extract/fingerprint.js';
import { textPrefix } from '../extract/normalize.js';
import type { TargetConfig } from '../config/schema.js';
import { sha256Hex } from '../util/hash.js';

export function commentGroupKey(targetKey: string, rootPostKey: string): string {
  return `${targetKey}|${rootPostKey}|COMMENTS`;
}

/**
 * 留言合併群組的事件鍵：必須能區分「同一組 entity 的不同內容版本」。
 * 不得含 wall-clock 時間，否則重啟會重送。
 */
export function commentGroupEventKey(targetKey: string, rootPostKey: string, items: CommentItem[]): string {
  const itemKeys = items
    .map((i) => `${i.entityKey}:${i.kind}:${i.contentHash ?? ''}`)
    .sort()
    .join(',');
  return sha256Hex(`${targetKey}|COMMENTS|${rootPostKey}|${itemKeys}`);
}

function toItem(ch: CommentChange): CommentItem {
  return {
    entityKey: ch.entityKey,
    kind: ch.kind,
    author: ch.comment.author,
    text: ch.comment.text,
    isReply: ch.comment.isReply,
    depth: ch.comment.depth,
    permalink: ch.comment.permalink,
    contentHash: commentContentHash(ch.comment),
  };
}

/** 把本輪新的留言變更合併進既有的 pending group payload（同一 entityKey 以最新內容覆寫） */
export function mergeCommentGroup(
  existing: CommentsEventPayload | undefined,
  changes: CommentChange[],
  target: TargetConfig,
  sourceUrl: string,
  now: string,
): CommentsEventPayload {
  const first = changes[0];
  if (!first) throw new Error('mergeCommentGroup 需要至少一筆變更');
  const post = first.post;
  const items: CommentItem[] = existing ? [...existing.items] : [];
  for (const ch of changes) {
    const item = toItem(ch);
    const idx = items.findIndex((i) => i.entityKey === ch.entityKey);
    if (idx >= 0) items[idx] = item;
    else items.push(item);
  }
  return {
    kind: 'NEW_COMMENTS',
    targetKey: target.key,
    targetName: target.name,
    targetType: target.type,
    rootPostKey: first.postEntityKey,
    post: {
      author: post.author,
      textPrefix: textPrefix(post.text, 80),
      permalink: post.permalink,
      timeLabel: post.timeLabel,
      timeTitle: post.timeTitle,
    },
    items,
    completeness: post.completeness,
    sourceUrl: post.permalink ?? sourceUrl,
    firstDetectedAt: existing?.firstDetectedAt ?? now,
    detectedAt: now,
  };
}

export function summarizeItems(items: CommentItem[]): string {
  const c = items.filter((i) => i.kind === 'NEW_COMMENT').length;
  const r = items.filter((i) => i.kind === 'NEW_REPLY').length;
  const e = items.filter((i) => i.kind === 'EDITED_COMMENT').length;
  const parts: string[] = [];
  if (c) parts.push(`新增留言 ${c} 則`);
  if (r) parts.push(`回覆 ${r} 則`);
  if (e) parts.push(`編輯留言 ${e} 則`);
  return parts.join('、') || '留言變更';
}
