export interface FxComment {
  id: number;
  author: string;
  text: string;
  minutesAgo: number;
  replies: FxComment[];
  hidden?: boolean;
  image?: number;
}

export interface FxPost {
  id: number;
  author: string;
  text: string;
  minutesAgo: number;
  timeTitle: string;
  images: number[];
  comments: FxComment[];
  reactions: number;
  edited: boolean;
  long: boolean;
  sponsored?: boolean;
}

export type FxMode = 'normal' | 'login' | 'checkpoint' | 'permission' | 'skeleton' | 'noroles' | 'slow' | 'blank';

export interface FxSurface {
  kind: 'page' | 'group';
  name: string;
  slug: string;
  posts: FxPost[];
  mode: FxMode;
  tick: number;
  seq: number;
}

let globalSeq = 1000;

export function nextId(): number {
  globalSeq += 7;
  return globalSeq;
}

export function makeSurface(kind: 'page' | 'group', name: string, slug: string): FxSurface {
  return { kind, name, slug, posts: [], mode: 'normal', tick: 0, seq: 0 };
}

export function seedSurface(s: FxSurface, count: number): void {
  s.posts = [];
  for (let i = 0; i < count; i++) {
    const id = nextId();
    s.posts.push({
      id,
      author: s.kind === 'page' ? s.name : ['林大明', '陳美玲', '王志豪'][i % 3] ?? '林大明',
      text: `這是第 ${i + 1} 篇既有貼文。今天天氣很好，歡迎大家來店裡逛逛！#台中 #洗鞋`,
      minutesAgo: 60 * (i + 2),
      timeTitle: `2026年9月${3 - Math.min(2, i)}日 星期${['三', '二', '一'][Math.min(2, i)]} 上午10:${String(10 + i).padStart(2, '0')}`,
      images: i % 2 === 0 ? [id + 1] : [],
      comments: [
        { id: id + 2, author: '張小華', text: `好棒！第 ${i + 1} 篇留言一`, minutesAgo: 50, replies: [{ id: id + 3, author: s.kind === 'page' ? s.name : '林大明', text: '謝謝支持！', minutesAgo: 40, replies: [] }] },
        { id: id + 4, author: '李阿姨', text: '請問營業時間？', minutesAgo: 30, replies: [] },
      ],
      reactions: 12 + i,
      edited: false,
      long: false,
    });
  }
}
