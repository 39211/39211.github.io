import { sha256Hex } from '../util/hash.js';
import type { RawComment, RawMedia, RawPost } from '../adapters/types.js';
import type { SelectorCatalog } from '../adapters/catalog.js';
import type { Completeness } from '../storage/repo.js';
import { normalizeText, textPrefix } from './normalize.js';

export interface NormalizedMedia {
  type: RawMedia['type'];
  fp: string;
  alt?: string;
}

export interface NormalizedComment {
  markId: string;
  parentMarkId: string | null;
  depth: number;
  isReply: boolean;
  permalink?: string;
  author?: string;
  timeLabel?: string;
  timeTitle?: string;
  text: string;
  media: NormalizedMedia[];
  confidence: number;
  flags: string[];
}

export interface NormalizedPost {
  markId: string;
  index: number;
  permalink?: string;
  author?: string;
  timeLabel?: string;
  timeTitle?: string;
  edited: boolean;
  text: string;
  media: NormalizedMedia[];
  comments: NormalizedComment[];
  confidence: number;
  completeness: Completeness;
  remainingExpanders: number;
  flags: string[];
  visibleCommentCountText?: string;
  reactionText?: string;
}

export interface Identity {
  key: string;
  strategy: 'permalink' | 'author_time_text' | 'author_text' | 'parent_author_text';
}

function normMedia(m: RawMedia[]): NormalizedMedia[] {
  return m.map((x) => ({ type: x.type, fp: `${x.type}:${x.fingerprint}`, alt: x.alt })).sort((a, b) => a.fp.localeCompare(b.fp));
}

export function normalizeComment(raw: RawComment, catalog: SelectorCatalog): NormalizedComment {
  return {
    markId: raw.markId,
    parentMarkId: raw.parentMarkId,
    depth: raw.depth,
    isReply: raw.isReply,
    permalink: raw.permalink,
    author: raw.author?.trim() || undefined,
    timeLabel: raw.timeLabel,
    timeTitle: raw.timeTitle,
    text: normalizeText(raw.text, catalog.uiNoisePatterns),
    media: normMedia(raw.media),
    confidence: raw.confidence,
    flags: raw.flags,
  };
}

export function normalizePost(raw: RawPost, catalog: SelectorCatalog): NormalizedPost {
  return {
    markId: raw.markId,
    index: raw.index,
    permalink: raw.permalink,
    author: raw.author?.trim() || undefined,
    timeLabel: raw.timeLabel,
    timeTitle: raw.timeTitle,
    edited: raw.edited,
    text: normalizeText(raw.text, catalog.uiNoisePatterns),
    media: normMedia(raw.media),
    comments: raw.comments.map((c) => normalizeComment(c, catalog)),
    confidence: raw.confidence,
    completeness: raw.remainingExpanders === 0 ? 'COMPLETE_VISIBLE_SET' : 'PARTIAL_EXPANSION',
    remainingExpanders: raw.remainingExpanders,
    flags: raw.flags,
    visibleCommentCountText: raw.visibleCommentCountText,
    reactionText: raw.reactionText,
  };
}

const mediaKey = (media: NormalizedMedia[]): string => media.map((m) => m.fp).join(',');

export function postIdentity(targetKey: string, p: NormalizedPost): Identity {
  if (p.permalink) return { key: sha256Hex(['post', targetKey, p.permalink].join('|')), strategy: 'permalink' };
  if (p.timeTitle) {
    return { key: sha256Hex(['post', targetKey, p.author ?? '', p.timeTitle, textPrefix(p.text, 60), mediaKey(p.media)].join('|')), strategy: 'author_time_text' };
  }
  return { key: sha256Hex(['post', targetKey, p.author ?? '', textPrefix(p.text, 120), mediaKey(p.media)].join('|')), strategy: 'author_text' };
}

export function postContentHash(p: NormalizedPost): string {
  return sha256Hex(`${p.text}|${mediaKey(p.media)}`);
}

export function commentIdentity(targetKey: string, rootPostKey: string, parentKey: string | null, c: NormalizedComment): Identity {
  if (c.permalink) return { key: sha256Hex(['comment', targetKey, c.permalink].join('|')), strategy: 'permalink' };
  return {
    key: sha256Hex(['comment', targetKey, rootPostKey, parentKey ?? '', c.author ?? '', textPrefix(c.text, 120), mediaKey(c.media)].join('|')),
    strategy: 'parent_author_text',
  };
}

export function commentContentHash(c: NormalizedComment): string {
  return sha256Hex(`${c.text}|${mediaKey(c.media)}`);
}

export function mediaSummary(media: NormalizedMedia[]): string {
  const img = media.filter((m) => m.type === 'image').length;
  const vid = media.filter((m) => m.type === 'video').length;
  const link = media.filter((m) => m.type === 'link').length;
  const parts: string[] = [];
  if (img) parts.push(`圖片 ${img} 張`);
  if (vid) parts.push(`影片 ${vid} 部`);
  if (link) parts.push(`連結 ${link} 個`);
  return parts.length ? parts.join('、') : '無';
}
