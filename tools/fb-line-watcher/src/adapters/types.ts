import type { SelectorCatalog } from './catalog.js';

export interface RawMedia {
  type: 'image' | 'video' | 'link' | 'unknown';
  alt?: string;
  fingerprint: string;
  href?: string;
  width?: number;
  height?: number;
}

export interface RawComment {
  markId: string;
  parentMarkId: string | null;
  depth: number;
  isReply: boolean;
  permalink?: string;
  author?: string;
  timeLabel?: string;
  timeTitle?: string;
  ariaLabel?: string;
  text: string;
  media: RawMedia[];
  confidence: number;
  flags: string[];
}

export interface RawPost {
  markId: string;
  index: number;
  permalink?: string;
  author?: string;
  timeLabel?: string;
  timeTitle?: string;
  edited: boolean;
  sponsored: boolean;
  text: string;
  media: RawMedia[];
  comments: RawComment[];
  visibleCommentCountText?: string;
  reactionText?: string;
  remainingExpanders: number;
  confidence: number;
  flags: string[];
}

export interface ExtractDiagnostics {
  url: string;
  title: string;
  feedFound: boolean;
  topLevelArticles: number;
  nestedArticles: number;
  sortLabel?: string;
  notes: string[];
}

export interface ExtractResult {
  posts: RawPost[];
  diagnostics: ExtractDiagnostics;
}

export interface ExtractArg {
  catalog: SelectorCatalog;
  markAttr: string;
  maxPosts: number;
  skipSponsored: boolean;
}
