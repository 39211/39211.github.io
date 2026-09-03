import type { FxComment, FxPost, FxSurface } from './state.js';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rndClass(): string {
  return `x${Math.random().toString(36).slice(2, 8)}`;
}

function rel(minutes: number, tick: number): string {
  const m = minutes + tick;
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小時`;
  return `${Math.floor(m / 60 / 24)} 天`;
}

function postPermalink(s: FxSurface, p: FxPost): string {
  return s.kind === 'group' ? `/groups/${s.slug}/posts/${p.id}/` : `/${s.slug}/posts/pfbid0${p.id}abc`;
}

function renderComment(s: FxSurface, p: FxPost, c: FxComment, roles: boolean, isReply: boolean): string {
  const r = (role: string): string => (roles ? ` role="${role}"` : '');
  const cls = rndClass();
  const permalink = isReply
    ? `${postPermalink(s, p)}?comment_id=${c.id}&reply_comment_id=${c.id}`
    : `${postPermalink(s, p)}?comment_id=${c.id}`;
  const replies = c.replies.length
    ? c.replies.length > 1
      ? `<template data-fx-replies="${c.id}">${c.replies.map((rp) => renderComment(s, p, rp, roles, true)).join('')}</template>
       <div${r('button')} tabindex="0" class="${rndClass()}" data-fx-show-replies="${c.id}">查看全部 ${c.replies.length} 則回覆</div>`
      : `<div class="${rndClass()}">${c.replies.map((rp) => renderComment(s, p, rp, roles, true)).join('')}</div>`
    : '';
  return `<div${r('article')} aria-label="${esc(c.author)} 的${isReply ? '回覆' : '留言'}" class="${cls}" style="${isReply ? 'margin-left:44px;' : ''}padding:6px 0">
    <div class="${rndClass()}" style="display:flex;gap:8px">
      <img src="/avatar/${encodeURIComponent(c.author)}.png" width="32" height="32" alt="" style="border-radius:50%">
      <div>
        <div class="${rndClass()}" style="background:#f0f2f5;border-radius:16px;padding:8px 12px;display:inline-block">
          <a${r('link')} href="/profile.php?id=${c.id}" class="${rndClass()}"><span dir="auto" style="font-weight:600">${esc(c.author)}</span></a>
          <div dir="auto" class="${rndClass()}">${esc(c.text)}</div>
          ${c.image ? `<a href="/photo/?fbid=${c.image}"><img src="/scontent/v/t39.30808-6/${c.image}_500_600_n.jpg?stp=dst" alt="可能是圖像" width="200" height="150"></a>` : ''}
        </div>
        <div class="${rndClass()}" style="font-size:12px;color:#65676b;display:flex;gap:10px;padding:2px 12px">
          <a href="${permalink}" class="${rndClass()}"><span>${rel(c.minutesAgo, s.tick)}</span></a>
          <div${r('button')} tabindex="0">讚</div>
          <div${r('button')} tabindex="0">回覆</div>
        </div>
      </div>
    </div>
    ${replies}
  </div>`;
}

function renderPost(s: FxSurface, p: FxPost, i: number, roles: boolean): string {
  const r = (role: string): string => (roles ? ` role="${role}"` : '');
  const permalink = postPermalink(s, p);
  const visibleComments = p.comments.filter((c) => !c.hidden);
  const hiddenCount = p.comments.length - visibleComments.length;
  const text = esc(p.text);
  const shown = p.long ? `${text.slice(0, 120)}…` : text;
  return `<div${r('article')} aria-posinset="${i + 1}" aria-setsize="${s.posts.length}" aria-labelledby="hdr-${p.id}" aria-describedby="msg-${p.id}" class="${rndClass()}" data-fx-post="${p.id}" style="background:#fff;border-radius:8px;margin:12px 0;padding:12px;box-shadow:0 1px 2px rgba(0,0,0,.2);width:680px">
    <div class="${rndClass()}" style="display:flex;gap:8px;align-items:center">
      <img src="/avatar/${encodeURIComponent(p.author)}.png" width="40" height="40" alt="" style="border-radius:50%">
      <div>
        <h3 id="hdr-${p.id}" class="${rndClass()}" style="margin:0;font-size:15px"><strong><a${r('link')} href="/${encodeURIComponent(p.author)}" class="${rndClass()}">${esc(p.author)}</a></strong>${s.kind === 'group' ? ` <span style="font-weight:400">›</span> <a${r('link')} href="/groups/${s.slug}/">${esc(s.name)}</a>` : ''}</h3>
        <span class="${rndClass()}" style="font-size:13px;color:#65676b">
          ${p.sponsored ? '<span>贊助</span>' : `<a${r('link')} aria-label="${esc(p.timeTitle)}" href="${permalink}" class="${rndClass()}"><span>${rel(p.minutesAgo, s.tick)}</span></a>`}
          ${p.edited ? ' · <span>已編輯</span>' : ''} · <span aria-label="公開">🌐</span>
        </span>
      </div>
    </div>
    <div id="msg-${p.id}" data-ad-preview="message" class="${rndClass()}" style="margin:10px 0;font-size:15px;line-height:1.4">
      <div dir="auto" data-fx-text="${p.id}">${shown}</div>
      ${p.long ? `<div${r('button')} tabindex="0" class="${rndClass()}" data-fx-seemore="${p.id}" data-full="${text}" style="font-weight:600;cursor:pointer">查看更多</div>` : ''}
    </div>
    ${p.images.length ? `<div class="${rndClass()}" style="display:flex;gap:4px;flex-wrap:wrap">${p.images.map((img) => `<a href="/photo/?fbid=${img}&set=a.${p.id}" class="${rndClass()}"><img src="/scontent/v/t39.30808-6/${img}_1000_2000_n.jpg?stp=dst-jpg&_nc_cat=1" alt="可能是文字的圖像" width="${p.images.length > 1 ? 330 : 660}" height="${p.images.length > 1 ? 220 : 330}" style="display:block;border-radius:6px"></a>`).join('')}</div>` : ''}
    <div class="${rndClass()}" style="display:flex;justify-content:space-between;font-size:14px;color:#65676b;padding:8px 0;border-bottom:1px solid #ccd0d5">
      <span class="${rndClass()}">全部心情：${p.reactions}</span>
      <span class="${rndClass()}">${p.comments.reduce((n, c) => n + 1 + c.replies.length, 0)} 則留言</span>
    </div>
    <div class="${rndClass()}" style="display:flex;gap:24px;padding:6px 0;border-bottom:1px solid #ccd0d5">
      <div${r('button')} tabindex="0">讚</div><div${r('button')} tabindex="0">留言</div><div${r('button')} tabindex="0">分享</div>
    </div>
    <div class="${rndClass()}" data-fx-comments="${p.id}">
      <div style="padding:8px 0"><div${r('button')} tabindex="0" class="${rndClass()} fx-sort" data-fx-sort="${p.id}" style="font-weight:600;display:inline-block">最相關</div></div>
      ${hiddenCount > 0 ? `<div${r('button')} tabindex="0" class="${rndClass()}" data-fx-more-comments="${p.id}" style="font-weight:600;color:#65676b">查看更多留言</div>` : ''}
      ${p.comments.map((c) => (c.hidden ? `<template data-fx-hidden-comment="${p.id}">${renderComment(s, p, c, roles, false)}</template>` : renderComment(s, p, c, roles, false))).join('')}
    </div>
  </div>`;
}

const SCRIPT = `
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const seeMore = t.closest('[data-fx-seemore]');
  if (seeMore) { const id = seeMore.getAttribute('data-fx-seemore'); const el = document.querySelector('[data-fx-text="' + id + '"]'); if (el) el.textContent = seeMore.getAttribute('data-full'); seeMore.remove(); return; }
  const more = t.closest('[data-fx-more-comments]');
  if (more) { const id = more.getAttribute('data-fx-more-comments'); document.querySelectorAll('template[data-fx-hidden-comment="' + id + '"]').forEach((el) => el.replaceWith(el.content)); more.remove(); return; }
  const rep = t.closest('[data-fx-show-replies]');
  if (rep) { const id = rep.getAttribute('data-fx-show-replies'); const tpl = document.querySelector('template[data-fx-replies="' + id + '"]'); if (tpl) tpl.replaceWith(tpl.content); rep.remove(); return; }
  const sort = t.closest('[data-fx-sort]');
  if (sort) {
    document.querySelectorAll('[role="menu"]').forEach((m) => m.remove());
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #ccc;padding:6px;z-index:10';
    for (const label of ['最相關', '最新', '所有留言']) { const it = document.createElement('div'); it.setAttribute('role', 'menuitem'); it.textContent = label; it.style.padding = '4px 8px'; it.addEventListener('click', () => { sort.textContent = label; sort.setAttribute('data-fx-sorted', label); menu.remove(); }); menu.appendChild(it); }
    sort.parentElement.appendChild(menu); return;
  }
});
`;

export function renderSurface(s: FxSurface, reqUrl = '/'): string {
  const roles = s.mode !== 'noroles';
  const title = `${s.name} | Facebook`;
  let main: string;
  switch (s.mode) {
    case 'login':
      return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>登入 Facebook</title></head><body style="font-family:sans-serif;background:#f0f2f5">
        <div style="max-width:400px;margin:80px auto;background:#fff;padding:20px;border-radius:8px"><h1 style="font-size:20px">登入 Facebook</h1>
        <form action="/login/device-based/regular/login/" method="post" id="login_form"><input name="email" type="text" placeholder="電子郵件或電話號碼"><input name="pass" type="password" placeholder="密碼"><button type="submit">登入</button></form></div></body></html>`;
    case 'checkpoint':
      return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>Facebook</title></head><body style="font-family:sans-serif"><div role="main"><h1>安全檢查</h1><p>為了保護你的帳號，請驗證你的身分。</p><input name="approvals_code"></div></body></html>`;
    case 'permission':
      main = `<div role="main"><div style="padding:40px;text-align:center"><h2>此內容目前無法顯示</h2><p>發生這種情況通常是因為擁有者只分享給少數人、變更了內容的分享對象，或是內容已遭刪除。</p></div></div>`;
      break;
    case 'skeleton':
      main = `<div role="main"><div role="feed" aria-label="動態消息" style="width:680px;margin:0 auto">${[0, 1, 2].map(() => `<div class="${rndClass()}" style="background:#fff;height:180px;margin:12px 0;border-radius:8px"><div style="background:#e4e6eb;height:14px;width:40%;margin:16px"></div><div style="background:#e4e6eb;height:14px;width:70%;margin:16px"></div></div>`).join('')}</div></div>`;
      break;
    default: {
      const r = (role: string): string => (roles ? ` role="${role}"` : '');
      main = `<div${r('main')}><div${r('feed')} aria-label="${s.kind === 'group' ? '社團貼文' : '貼文'}" style="width:680px;margin:0 auto">
        ${s.kind === 'group' ? `<div style="padding:8px 0"><div${r('button')} tabindex="0" style="display:inline-block;font-weight:600">${new URL(reqUrl, 'http://fixture.local').searchParams.get('sorting_setting') === 'CHRONOLOGICAL' ? '最新貼文' : '最相關'}</div></div>` : ''}
        ${s.posts.map((p, i) => renderPost(s, p, i, roles)).join('')}
      </div></div>`;
    }
  }
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{margin:0;background:#f0f2f5;font-family:"Noto Sans TC","WenQuanYi Zen Hei",Segoe UI,Helvetica,Arial,sans-serif;color:#050505} a{color:inherit;text-decoration:none} [role=button]{cursor:pointer} .fx-sort::after{content:' ▾'}</style></head>
  <body>
  <div role="banner" style="position:sticky;top:0;background:#fff;height:56px;box-shadow:0 1px 2px rgba(0,0,0,.1);display:flex;align-items:center;padding:0 16px;font-weight:700;color:#1877f2">facebook（測試用假頁面）</div>
  <div style="display:flex">
    <div role="navigation" style="width:280px;padding:16px">左側選單</div>
    ${main}
    <div role="complementary" style="width:280px;padding:16px">右側欄／聊天室</div>
  </div>
  <script>${SCRIPT}</script>
  </body></html>`;
}
