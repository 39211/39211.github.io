import http from 'node:http';
import { PNG } from 'pngjs';
import { makeSurface, nextId, seedSurface, type FxComment, type FxMode, type FxPost, type FxSurface } from './state.js';
import { renderSurface } from './render.js';

export interface FixtureServer {
  port: number;
  baseUrl: string;
  surfaces: Record<'page' | 'group', FxSurface>;
  url(kind: 'page' | 'group'): string;
  control<T = unknown>(kind: 'page' | 'group', action: string, body?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

const imageCache = new Map<string, Buffer>();

function makeImage(key: string, w: number, h: number): Buffer {
  const cacheKey = `${key}:${w}x${h}`;
  const hit = imageCache.get(cacheKey);
  if (hit) return hit;
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const r = 60 + (seed % 160);
  const g = 60 + ((seed >> 8) % 160);
  const b = 60 + ((seed >> 16) % 160);
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const stripe = ((x + y + (seed % 40)) / 40) % 2 < 1;
      const block = x > w * 0.6 && y > h * 0.5 && ((seed >> 4) & 1) === 1;
      png.data[i] = block ? 255 - r : stripe ? r : Math.min(255, r + 50);
      png.data[i + 1] = block ? 255 - g : stripe ? g : Math.min(255, g + 50);
      png.data[i + 2] = block ? 255 - b : stripe ? b : Math.min(255, b + 50);
      png.data[i + 3] = 255;
    }
  }
  const buf = PNG.sync.write(png);
  imageCache.set(cacheKey, buf);
  return buf;
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function findPost(s: FxSurface, id: unknown): FxPost {
  const p = s.posts.find((x) => x.id === Number(id));
  if (!p) throw new Error(`post ${String(id)} not found`);
  return p;
}

function findComment(list: FxComment[], id: number): FxComment | undefined {
  for (const c of list) {
    if (c.id === id) return c;
    const inner = findComment(c.replies, id);
    if (inner) return inner;
  }
  return undefined;
}

function toComment(raw: Record<string, unknown>, minutesAgo = 5): FxComment {
  const replies = Array.isArray(raw.replies) ? (raw.replies as Record<string, unknown>[]).map((r) => toComment(r, minutesAgo)) : [];
  return { id: nextId(), author: String(raw.author ?? '匿名'), text: String(raw.text ?? ''), minutesAgo, replies, hidden: !!raw.hidden, image: raw.image ? nextId() : undefined };
}

function applyAction(s: FxSurface, action: string, body: Record<string, unknown>): unknown {
  switch (action) {
    case 'reset':
      seedSurface(s, Number(body.seed ?? 3));
      s.mode = 'normal';
      s.tick = 0;
      return { posts: s.posts.length };
    case 'add-post': {
      const id = nextId();
      const images = Array.from({ length: Number(body.images ?? 0) }, () => nextId());
      const comments = Array.isArray(body.comments) ? (body.comments as Record<string, unknown>[]).map((c) => toComment(c)) : [];
      const post: FxPost = {
        id,
        author: String(body.author ?? (s.kind === 'page' ? s.name : '林大明')),
        text: String(body.text ?? '新貼文'),
        minutesAgo: Number(body.minutesAgo ?? 2),
        timeTitle: String(body.timeTitle ?? `2026年9月3日 星期三 下午${String(1 + (id % 9))}:${String(id % 60).padStart(2, '0')}`),
        images,
        comments,
        reactions: Number(body.reactions ?? 0),
        edited: false,
        long: !!body.long,
        sponsored: !!body.sponsored,
      };
      if (body.append) s.posts.push(post);
      else s.posts.unshift(post);
      return { id, imageIds: images, commentIds: comments.map((c) => c.id) };
    }
    case 'edit-post': {
      const p = findPost(s, body.id);
      p.text = String(body.text ?? p.text);
      p.edited = true;
      if (body.images !== undefined) p.images = Array.from({ length: Number(body.images) }, () => nextId());
      return { id: p.id };
    }
    case 'remove-post': {
      s.posts = s.posts.filter((p) => p.id !== Number(body.id));
      return { posts: s.posts.length };
    }
    case 'add-comment': {
      const p = findPost(s, body.postId);
      const c = toComment(body);
      p.comments.push(c);
      return { id: c.id };
    }
    case 'add-reply': {
      const p = findPost(s, body.postId);
      const parent = findComment(p.comments, Number(body.commentId));
      if (!parent) throw new Error('comment not found');
      const c = toComment(body);
      parent.replies.push(c);
      return { id: c.id };
    }
    case 'edit-comment': {
      const p = findPost(s, body.postId);
      const c = findComment(p.comments, Number(body.commentId));
      if (!c) throw new Error('comment not found');
      c.text = String(body.text ?? c.text);
      return { id: c.id };
    }
    case 'bump-reactions':
      for (const p of s.posts) p.reactions += Number(body.by ?? 1);
      return { ok: true };
    case 'tick':
      s.tick += Number(body.minutes ?? 1);
      return { tick: s.tick };
    case 'shuffle':
      s.posts.reverse();
      return { order: s.posts.map((p) => p.id) };
    case 'mode':
      s.mode = String(body.mode ?? 'normal') as FxMode;
      return { mode: s.mode };
    case 'state':
      return s;
    default:
      throw new Error(`unknown action ${action}`);
  }
}

export async function startFixtureServer(opts: { port?: number; seedPosts?: number } = {}): Promise<FixtureServer> {
  const surfaces: Record<'page' | 'group', FxSurface> = {
    page: makeSurface('page', '阿爸洗鞋店', 'fixture-page'),
    group: makeSurface('group', '青海路洗鞋交流社團', 'fixture-group'),
  };
  seedSurface(surfaces.page, opts.seedPosts ?? 3);
  seedSurface(surfaces.group, opts.seedPosts ?? 3);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local');
    const p = url.pathname;
    try {
      if (p.startsWith('/__fixture/')) {
        const [, , kind, action] = p.split('/');
        const s = surfaces[kind as 'page' | 'group'];
        if (!s || !action) {
          res.writeHead(404).end();
          return;
        }
        const body = req.method === 'POST' ? await readJson(req) : {};
        const result = applyAction(s, action, body);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
        return;
      }
      if (p.startsWith('/scontent/')) {
        const file = p.split('/').pop() ?? 'x';
        const big = /_1000_2000_n/.test(file);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(makeImage(file, big ? 660 : 200, big ? 330 : 150));
        return;
      }
      if (p.startsWith('/avatar/')) {
        res.writeHead(200, { 'Content-Type': 'image/png' }).end(makeImage(p, 40, 40));
        return;
      }
      let s: FxSurface | undefined;
      if (p === '/fixture-page' || p.startsWith('/fixture-page/')) s = surfaces.page;
      else if (p.startsWith('/groups/fixture-group')) s = surfaces.group;
      if (!s) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      if (s.mode === 'slow') await new Promise((r) => setTimeout(r, 4000));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(renderSurface(s, req.url ?? '/'));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(e instanceof Error ? e.message : String(e));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    port,
    baseUrl,
    surfaces,
    url: (kind) => (kind === 'page' ? `${baseUrl}/fixture-page/` : `${baseUrl}/groups/fixture-group/`),
    async control<T>(kind: 'page' | 'group', action: string, body: Record<string, unknown> = {}): Promise<T> {
      const r = await fetch(`${baseUrl}/__fixture/${kind}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`fixture control ${action} failed: ${r.status} ${await r.text()}`);
      return (await r.json()) as T;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// 直接執行：npm run fixture
const isMain = process.argv[1] && /fixtures[\\/]server\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const port = Number(process.env.FIXTURE_PORT ?? 4310);
  startFixtureServer({ port })
    .then((s) => {
      console.log(`假 Facebook 頁面：${s.url('page')}`);
      console.log(`假 Facebook 社團：${s.url('group')}`);
      console.log(`控制 API：POST ${s.baseUrl}/__fixture/{page|group}/{add-post|add-comment|add-reply|edit-post|bump-reactions|tick|shuffle|mode|reset}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
