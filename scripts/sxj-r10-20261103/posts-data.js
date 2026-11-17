/* Read the publishing pipeline's public article index; seed holds curated thumbnails and old social URLs. */
(()=>{'use strict';
const safeArticle=v=>/^\/?posts\/[A-Za-z0-9_-]+\.html$/.test(v||'')?'/'+v.replace(/^\//,''):'';
const safeMedia=v=>{if(!v)return "";try{const u=new URL(v,location.origin);return (u.origin===location.origin||['sixiangjialaundry.com','i.ytimg.com'].includes(u.hostname))&&['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const category=t=>/嬰|幼兒|推車|汽座|安全座椅|娃娃/.test(t)?'baby':/被|寢具|床|枕|窗簾|地毯|布品/.test(t)?'home':/鞋|靴|包|皮件/.test(t)?'accessories':'clothing';
async function json(url){const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('index');return r.json();}
// Card-only derivative: keep original media URLs for previews, articles and sharing.
const thumbnail=value=>{try{const u=new URL(value,location.origin);if(u.origin!==location.origin&&u.origin!=='https://sixiangjialaundry.com')return value;if(!/^\/assets\/\d{4}-\d{2}-\d{2}\/slot-\d{2}\.png$/.test(u.pathname)||u.search||u.hash)return value;u.pathname=u.pathname.replace(/\.png$/,'.webp');return u.href;}catch{return value;}};
const api={thumbnail,stale:false,async load(){
 const [current,seedResult]=await Promise.allSettled([json('/social-posts.json'),json('/scripts/sxj-r10-20261103/r6-posts.json')]);
 const seed=seedResult.status==='fulfilled'&&Array.isArray(seedResult.value)?seedResult.value:[];
 if(current.status!=='fulfilled'||!Array.isArray(current.value.article_posts)){api.stale=true;if(!seed.length)throw Error('index unavailable');return seed;}
 const old=new Map(seed.map(p=>[p.article,p])),unique=new Map();
 for(const p of current.value.article_posts){const article=safeArticle(p.article_path);if(!article||!/^\d{4}-\d{2}-\d{2}$/.test(p.date||''))continue;
 const o=old.get(article)||{},title=p.editorial_title||o.title||p.topic||p.title||'洗護紀錄';
 unique.set(article,{...o,id:article.split('/').pop().replace(/\.html$/,''),article,title,date:p.date,category:o.category||category(title),image:safeMedia(o.image||p.image_url),imageAlt:o.imageAlt||'洗護圖文配圖；來源與說明請見完整紀錄',facebookCaption:p.facebook_caption||o.facebookCaption||'',instagramCaption:p.instagram_caption||o.instagramCaption||'',facebook:p.facebook_post_url||o.facebook||'',youtube:p.youtube_video?.watch_url||o.youtube||'',localVideo:safeMedia(p.video_url||o.localVideo||'')});}
 if(!unique.size)throw Error('empty public index');
 return [...unique.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
}};window.SXJPosts=api;
})();
