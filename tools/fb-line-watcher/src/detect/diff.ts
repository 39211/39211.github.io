import type { Db } from '../storage/db.js';
import {
  getEntity,
  insertEntity,
  insertSnapshotIfNew,
  resetCaptureFailures,
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

/**
 * 偵測狀態的「提交」內容。
 *
 * applyDiff 只負責偵測，不會替仍待通知的實體推進 known／content hash；
 * 呼叫端要等事件真的寫進 events／pending_groups（durable）之後才呼叫 commitChange，
 * 中途截圖或存檔失敗時狀態維持不變，下一輪會重新偵測到同一筆並補送。
 */
export interface PendingCommit {
  entityKey: string;
  /** 提交時把 known 設為 1（代表這筆內容已經有對應的持久化事件） */
  known?: boolean;
  /** 提交時才推進 current_content_hash（編輯事件用） */
  contentHash?: string;
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
  commit: PendingCommit;
}

export interface CommentChange {
  kind: 'NEW_COMMENT' | 'NEW_REPLY' | 'EDITED_COMMENT';
  post: NormalizedPost;
  postEntityKey: string;
  comment: NormalizedComment;
  entityKey: string;
  suppressedReason?: string;
  commit: PendingCommit;
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
  /** 上一輪偵測到但事件未能建立、本輪重新補送的變更數 */
  redetected: number;
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
 * 事件已經持久化之後才推進偵測狀態。
 * 呼叫端負責交易邊界（applyDiff 內部已在交易中，故此函式自己不開交易）。
 */
export function commitChange(db: Db, now: string, commit: PendingCommit): void {
  if (commit.contentHash) updateEntityContent(db, commit.entityKey, commit.contentHash, now);
  if (commit.known) setEntityFlags(db, commit.entityKey, { known: true });
  resetCaptureFailures(db, commit.entityKey);
}

/**
 * 把本輪抽取到的貼文／留言與 SQLite 中的實體比較，回傳應處理的變更。
 *
 * 現況（snapshot、last_seen_at、confirmed）在同一個 transaction 內寫入；
 * 但「這筆內容已通知過」的狀態（known／current_content_hash）刻意留給呼叫端，
 * 必須等事件寫入 events／pending_groups 之後再用 commitChange 提交。
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
    stats: { posts: posts.length, comments: 0, newPosts: 0, editedPosts: 0, newComments: 0, newReplies: 0, editedComments: 0, lowConfidenceSkipped: 0, awaitingConfirmation: 0, suppressed: 0, redetected: 0 },
  };

  const pushPost = (change: PostChange): void => {
    result.postChanges.push(change);
    if (change.suppressedReason) {
      // 被設定過濾＝這輩子都不會通知，直接提交，否則每一輪都會重新偵測到
      result.stats.suppressed++;
      commitChange(db, now, change.commit);
      return;
    }
    if (change.kind === 'NEW_POST') result.stats.newPosts++;
    else result.stats.editedPosts++;
  };

  const pushComment = (change: CommentChange): void => {
    result.commentChanges.push(change);
    if (change.suppressedReason) {
      result.stats.suppressed++;
      commitChange(db, now, change.commit);
      return;
    }
    if (change.kind === 'EDITED_COMMENT') result.stats.editedComments++;
    else if (change.kind === 'NEW_REPLY') result.stats.newReplies++;
    else result.stats.newComments++;
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
      const lowConfidence = post.confidence < target.min_confidence;

      if (!existing) {
        postIsNew = true;
        const highConf = !lowConfidence;
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
            pushPost({
              kind: 'NEW_POST',
              post,
              entityKey: id.key,
              contentHash: hash,
              lowConfidence: false,
              suppressedReason: filterReason(target, 'NEW_POST', post.author),
              commit: { entityKey: id.key, known: true },
            });
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
        const hashChanged = existing.current_content_hash !== hash;
        if (hashChanged) insertSnapshotIfNew(db, id.key, hash, payloadJson, now);
        if (existing.confirmed === 0) {
          // 第二次取樣確認：上次信心不足，這次再看到就成立
          setEntityFlags(db, id.key, { confirmed: true });
        }

        if (existing.known === 0) {
          // known = 0 代表「偵測到了，但還沒有對應的持久化事件」：
          // 可能是第一次信心不足待確認，也可能是上一輪截圖／存檔失敗需要補送。
          if (ctx.baselineMode) {
            setEntityFlags(db, id.key, { known: true });
            if (hashChanged) updateEntityContent(db, id.key, hash, now);
          } else {
            if (existing.confirmed === 1) result.stats.redetected++;
            pushPost({
              kind: 'NEW_POST',
              post,
              entityKey: id.key,
              contentHash: hash,
              lowConfidence,
              suppressedReason: filterReason(target, 'NEW_POST', post.author),
              commit: { entityKey: id.key, known: true, contentHash: hashChanged ? hash : undefined },
            });
            postIsNew = true;
          }
        } else if (hashChanged) {
          if (!ctx.baselineMode && existing.confirmed === 1 && target.detect_post_edits) {
            const prevSnapshot = db.get<{ normalized_payload_json: string }>('SELECT normalized_payload_json FROM entity_snapshots WHERE entity_key = ? AND content_hash = ? LIMIT 1', id.key, existing.current_content_hash);
            let previousText: string | undefined;
            try {
              previousText = prevSnapshot ? (JSON.parse(prevSnapshot.normalized_payload_json) as { text?: string }).text : undefined;
            } catch {
              previousText = undefined;
            }
            pushPost({
              kind: 'EDITED_POST',
              post,
              entityKey: id.key,
              contentHash: hash,
              previousHash: existing.current_content_hash,
              previousText,
              lowConfidence: false,
              suppressedReason: filterReason(target, 'EDITED_POST', post.author),
              commit: { entityKey: id.key, contentHash: hash },
            });
          } else {
            updateEntityContent(db, id.key, hash, now);
          }
        }
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
        // 貼文本身這一輪會被通知（截圖已含留言），底下的留言就不另外通知
        const coveredByPost = ctx.baselineMode || postIsNew;
        if (!existingC) {
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
              known: coveredByPost,
            },
            now,
          );
          insertSnapshotIfNew(db, cid.key, chash, cPayload, now);
          if (!coveredByPost) {
            pushComment({
              kind,
              post,
              postEntityKey: id.key,
              comment: c,
              entityKey: cid.key,
              suppressedReason: filterReason(target, kind, c.author),
              commit: { entityKey: cid.key, known: true },
            });
          }
        } else {
          touchEntitySeen(db, cid.key, now, { confidence: c.confidence, canonical_url: c.permalink ?? null, author: c.author ?? null });
          const chashChanged = existingC.current_content_hash !== chash;
          if (chashChanged) insertSnapshotIfNew(db, cid.key, chash, cPayload, now);
          if (existingC.known === 0) {
            if (coveredByPost) {
              setEntityFlags(db, cid.key, { known: true });
              if (chashChanged) updateEntityContent(db, cid.key, chash, now);
            } else {
              result.stats.redetected++;
              pushComment({
                kind,
                post,
                postEntityKey: id.key,
                comment: c,
                entityKey: cid.key,
                suppressedReason: filterReason(target, kind, c.author),
                commit: { entityKey: cid.key, known: true, contentHash: chashChanged ? chash : undefined },
              });
            }
          } else if (chashChanged) {
            if (!ctx.baselineMode && cid.strategy === 'permalink') {
              pushComment({
                kind: 'EDITED_COMMENT',
                post,
                postEntityKey: id.key,
                comment: c,
                entityKey: cid.key,
                suppressedReason: filterReason(target, kind, c.author),
                commit: { entityKey: cid.key, contentHash: chash },
              });
            } else {
              updateEntityContent(db, cid.key, chash, now);
            }
          }
        }
        result.seenKeys.push(cid.key);
        result.keyByMark.set(c.markId, cid.key);
        result.markByKey.set(cid.key, c.markId);
      }
    }
  });
  return result;
}
