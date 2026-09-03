import type { CommentsEventPayload, CommentItem } from '../events.js';
import type { CommentChange } from './diff.js';
import { textPrefix } from '../extract/normalize.js';
import type { TargetConfig } from '../config/schema.js';

export function commentGroupKey(targetKey: string, rootPostKey: string): string {
  return `${targetKey}|${rootPostKey}|COMMENTS`;
}

/** 把本輪新的留言變更合併進既有的 pending group payload（以 entityKey 去重） */
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
  const seen = new Set(items.map((i) => i.entityKey));
  for (const ch of changes) {
    if (seen.has(ch.entityKey)) continue;
    seen.add(ch.entityKey);
    items.push({
      entityKey: ch.entityKey,
      kind: ch.kind,
      author: ch.comment.author,
      text: ch.comment.text,
      isReply: ch.comment.isReply,
      depth: ch.comment.depth,
      permalink: ch.comment.permalink,
    });
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
