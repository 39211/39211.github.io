import type { Db } from '../storage/db.js';
import {
  getEntity,
  insertEntity,
  insertSnapshotIfNew,
  setEntityFlags,
  touchEntitySeen,
  updateEntityContent,
  type TargetRow,
} from '../storage/repo.js';
import type { NotifyEventType, TargetConfig } from '../config/schema.js';
import { commentContentHash, commentIdentity, postContentHash, postIdentity, type NormalizedComment, type NormalizedPost } from '../extract/fingerprint.js';
import { matchesAuthorRule } from '../util/text.js';

export interface DiffContext {
  db: Db;
  target: TargetConfig;
  targetRow: TargetRow;
  now: string;
  /** true = 只建立現況、不產生任何事件（首次 baseline、resync、降級模式恢復） */
  baselineMode: boolean;
  /** 低於此信心的實體不建立（預設 0.6） */
  minEntityConfidence?: number;
}

export interface PostChange {
  kind: 'NEW_POST' | 'EDITED_POST';
  post: NormalizedPost;
  entityKey: string;
  contentHash: string;
  previousHash?: string;
  previousText?: string;
  lowConfidence: boolean;
  suppressedReason?: string;
}

export interface CommentChange {
  kind: 'NEW_COMMENT' | 'NEW_REPLY' | 'EDITED_COMMENT';
  post: NormalizedPost;
  postEntityKey: string;
  comment: NormalizedComment;
  entityKey: string;
  suppressedReason?: string;
}

export interface DiffStats {
  posts: number;
  comments: number;
  newPosts: number;
  editedPosts: number;
  newComments: number;
  newReplies: number;
  editedComments: number;
  lowConfidenceSkipped: number;
  awaitingConfirmation: number;
  suppressed: number;
}

export interface DiffResult {
  baselineMode: boolean;
  postChanges: PostChange[];
  commentChanges: CommentChange[];
  seenKeys: string[];
  keyByMark: Map<string, string>;
  markByKey: Map<string, string>;
  stats: DiffStats;
}

function filterReason(target: TargetConfig, kind: NotifyEventType, author: string | undefined): string | undefined {
  if (!target.notify_event_types.includes(kind)) return `event_type_filtered:${kind}`;
  if (target.ignore_authors.some((r) => matchesAuthorRule(author, r))) return 'author_ignored';
  if (target.notify_authors.length > 0 && !target.notify_authors.some((r) => matchesAuthorRule(author, r))) return 'author_not_in_allowlist';
  return undefined;
}

/**
 * 把本輪抽取到的貼文／留言與 SQLite 中的實體比較，回傳應處理的變更。
 * 所有寫入在同一個 transaction 內完成；事件的實際建立與 LINE 發送由呼叫端負責。
 */
export function applyDiff(ctx: DiffContext, posts: NormalizedPost[]): DiffResult {
  const { db, target, now } = ctx;
  const minConf = ctx.minEntityConfidence ?? 0.6;
  const targetKey = target.key;
  const result: DiffResult = {
    baselineMode: ctx.baselineMode,
    postChanges: [],
    commentChanges: [],
    seenKeys: [],
    keyByMark: new Map(),
    markByKey: new Map(),
    stats: { posts: posts.length, comments: 0, newPosts: 0, editedPosts: 0, newComments: 0, newReplies: 0, editedComments: 0, lowConfidenceSkipped: 0, awaitingConfirmation: 0, suppressed: 0 },
  };

  db.transaction(() => {
    for (const post of posts) {
      if (post.confidence < minConf) {
        result.stats.lowConfidenceSkipped++;
        continue;
      }
      const id = postIdentity(targetKey, post);
      const hash = postContentHash(post);
      const existing = getEntity(db, id.key);
      let postIsNew = false;
      const payloadJson = JSON.stringify({ text: post.text, media: post.media, author: post.author, timeLabel: post.timeLabel, timeTitle: post.timeTitle, permalink: post.permalink });

      if (!existing) {
        postIsNew = true;
        const highConf = post.confidence >= target.min_confidence;
        insertEntity(
          db,
          {
            entity_key: id.key,
            target_key: targetKey,
            entity_type: 'post',
            parent_entity_key: null,
            root_post_key: id.key,
            canonical_url: post.permalink ?? null,
            author_display_name: post.author ?? null,
            stable_time_label: post.timeTitle ?? null,
            key_strategy: id.strategy,
            current_content_hash: hash,
            extraction_confidence: post.confidence,
            completeness: post.completeness,
            confirmed: highConf,
            known: ctx.baselineMode,
          },
          now,
        );
        insertSnapshotIfNew(db, id.key, hash, payloadJson, now);
        if (!ctx.baselineMode) {
          if (highConf) {
            const reason = filterReason(target, 'NEW_POST', post.author);
            result.postChanges.push({ kind: 'NEW_POST', post, entityKey: id.key, contentHash: hash, lowConfidence: false, suppressedReason: reason });
            if (reason) result.stats.suppressed++;
            else result.stats.newPosts++;
            setEntityFlags(db, id.key, { known: true });
          } else {
            result.stats.awaitingConfirmation++;
          }
        }
      } else {
        touchEntitySeen(db, id.key, now, {
          confidence: post.confidence,
          completeness: post.completeness,
          canonical_url: post.permalink ?? null,
          author: post.author ?? null,
          stable_time_label: post.timeTitle ?? null,
        });
        if (existing.current_content_hash !== hash) {
          const prevSnapshot = db.get<{ normalized_payload_json: string }>('SELECT normalized_payload_json FROM entity_snapshots WHERE entity_key = ? AND content_hash = ? LIMIT 1', id.key, existing.current_content_hash);
          let previousText: string | undefined;
          try {
            previousText = prevSnapshot ? (JSON.parse(prevSnapshot.normalized_payload_json) as { text?: string }).text : undefined;
          } catch {
            previousText = undefined;
          }
          if (!ctx.baselineMode && existing.known === 1 && existing.confirmed === 1 && target.detect_post_edits) {
            const reason = filterReason(target, 'EDITED_POST', post.author);
            result.postChanges.push({ kind: 'EDITED_POST', post, entityKey: id.key, contentHash: hash, previousHash: existing.current_content_hash, previousText, lowConfidence: false, suppressedReason: reason });
            if (reason) result.stats.suppressed++;
            else result.stats.editedPosts++;
          }
          updateEntityContent(db, id.key, hash, now);
          insertSnapshotIfNew(db, id.key, hash, payloadJson, now);
        }
        if (existing.confirmed === 0) {
          // 第二次取樣確認：上次信心不足，這次再看到就成立
          setEntityFlags(db, id.key, { confirmed: true });
          if (existing.known === 0 && !ctx.baselineMode) {
            const reason = filterReason(target, 'NEW_POST', post.author);
            result.postChanges.push({ kind: 'NEW_POST', post, entityKey: id.key, contentHash: hash, lowConfidence: post.confidence < target.min_confidence, suppressedReason: reason });
            if (reason) result.stats.suppressed++;
            else result.stats.newPosts++;
            setEntityFlags(db, id.key, { known: true });
            postIsNew = true;
          }
        }
        if (existing.known === 0 && ctx.baselineMode) setEntityFlags(db, id.key, { known: true });
      }
      result.seenKeys.push(id.key);
      result.keyByMark.set(post.markId, id.key);
      result.markByKey.set(id.key, post.markId);

      if (!target.detect_comments) continue;
      for (const c of post.comments) {
        if (c.isReply && !target.detect_replies) continue;
        if (c.confidence < minConf) {
          result.stats.lowConfidenceSkipped++;
          continue;
        }
        result.stats.comments++;
        const parentKey = c.parentMarkId ? (result.keyByMark.get(c.parentMarkId) ?? id.key) : id.key;
        const cid = commentIdentity(targetKey, id.key, parentKey, c);
        const chash = commentContentHash(c);
        const existingC = getEntity(db, cid.key);
        const kind: 'NEW_COMMENT' | 'NEW_REPLY' = c.isReply ? 'NEW_REPLY' : 'NEW_COMMENT';
        const cPayload = JSON.stringify({ text: c.text, media: c.media, author: c.author, timeLabel: c.timeLabel, permalink: c.permalink });
        if (!existingC) {
          const known = ctx.baselineMode || postIsNew;
          insertEntity(
            db,
            {
              entity_key: cid.key,
              target_key: targetKey,
              entity_type: c.isReply ? 'reply' : 'comment',
              parent_entity_key: parentKey,
              root_post_key: id.key,
              canonical_url: c.permalink ?? null,
              author_display_name: c.author ?? null,
              stable_time_label: c.timeTitle ?? null,
              key_strategy: cid.strategy,
              current_content_hash: chash,
              extraction_confidence: c.confidence,
              completeness: post.completeness,
              confirmed: true,
              known,
            },
            now,
          );
          insertSnapshotIfNew(db, cid.key, chash, cPayload, now);
          if (!known) {
            const reason = filterReason(target, kind, c.author);
            result.commentChanges.push({ kind, post, postEntityKey: id.key, comment: c, entityKey: cid.key, suppressedReason: reason });
            if (reason) result.stats.suppressed++;
            else if (c.isReply) result.stats.newReplies++;
            else result.stats.newComments++;
            setEntityFlags(db, cid.key, { known: true });
          }
        } else {
          touchEntitySeen(db, cid.key, now, { confidence: c.confidence, canonical_url: c.permalink ?? null, author: c.author ?? null });
          if (existingC.current_content_hash !== chash) {
            if (!ctx.baselineMode && existingC.known === 1 && cid.strategy === 'permalink') {
              const reason = filterReason(target, kind, c.author);
              result.commentChanges.push({ kind: 'EDITED_COMMENT', post, postEntityKey: id.key, comment: c, entityKey: cid.key, suppressedReason: reason });
              if (reason) result.stats.suppressed++;
              else result.stats.editedComments++;
            }
            updateEntityContent(db, cid.key, chash, now);
            insertSnapshotIfNew(db, cid.key, chash, cPayload, now);
          }
          if (existingC.known === 0 && ctx.baselineMode) setEntityFlags(db, cid.key, { known: true });
        }
        result.seenKeys.push(cid.key);
        result.keyByMark.set(c.markId, cid.key);
        result.markByKey.set(cid.key, c.markId);
      }
    }
  });
  return result;
}
