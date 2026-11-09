/* Photo-led carousels. Automatic on desktop and mobile; no playback toolbar. */
(()=>{
 'use strict';
 const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function carousel(root,slides,dots,onShow,start=0){
  let index=start,timer=null,visible=false,focused=false,touch=null;
  const prime=n=>slides[(n+slides.length)%slides.length].querySelectorAll('img').forEach(img=>img.loading='eager');
  const show=n=>{index=(n+slides.length)%slides.length;prime(index);prime(index+1);slides.forEach((s,i)=>{s.hidden=i!==index;s.setAttribute('aria-hidden',String(i!==index));});dots.forEach((b,i)=>{b.setAttribute('aria-current',String(i===index));});root.dataset.current=String(index);onShow?.(index);};
  const run=()=>{clearInterval(timer);timer=null;const active=visible&&!document.hidden&&!reduced.matches&&!focused;root.dataset.playing=String(active);if(active)timer=setInterval(()=>show(index+1),6000);};
  dots.forEach((b,i)=>b.addEventListener('click',()=>{show(i);run();}));
  root.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)&&!e.target.matches('input,select,textarea')){e.preventDefault();show(index+(e.key==='ArrowRight'?1:-1));dots[index]?.focus({preventScroll:true});run();}});
  root.addEventListener('focusin',e=>{focused=e.target.matches(':focus-visible');run();});
  root.addEventListener('focusout',()=>setTimeout(()=>{focused=root.contains(document.activeElement)&&document.activeElement.matches(':focus-visible');run();},0));
  root.addEventListener('touchstart',e=>{touch=[e.changedTouches[0].clientX,e.changedTouches[0].clientY];},{passive:true});
  root.addEventListener('touchend',e=>{if(!touch)return;const x=e.changedTouches[0].clientX-touch[0],y=e.changedTouches[0].clientY-touch[1];if(Math.abs(x)>45&&Math.abs(x)>Math.abs(y)*1.5){show(index+(x<0?1:-1));run();}touch=null;},{passive:true});
  document.addEventListener('visibilitychange',run);reduced.addEventListener('change',run);
  new IntersectionObserver(es=>{visible=es[0].isIntersecting;run();},{threshold:.15}).observe(root);
  show(start);run();return{show,run};
 }
 const hero=$('.r5-hero');
 if(hero){
  const camp=$('[data-r5-campaign]',hero),active=window.BookingCore.campaign(day);
  if(camp){if(active){$('img',camp).src=({'camp-halloween':'/assets/services/sxj-r10-photos-camp-halloween.webp','camp-winter':'/assets/services/sxj-r10-photos-camp-winter.webp','camp-xmas':'/assets/services/sxj-r10-photos-camp-xmas.webp','camp-newyear':'/assets/services/sxj-r10-photos-camp-newyear.webp'})[active.image]||'/assets/services/sxj-r10-photos-camp-winter.webp';$('[data-r5-title]',camp).textContent=active.title;$('[data-r5-caption]',camp).textContent=active.label;}else camp.remove();}
  const slides=$$('[data-r5-slide]',hero),bar=$('[data-r5-dots]',hero);
  slides.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','顯示'+s.dataset.label);b.innerHTML='<span></span>';bar.append(b);});
  carousel(hero,slides,$$('button',bar),i=>{$('[data-r5-count]',hero).textContent=String(i+1).padStart(2,'0')+' / '+String(slides.length).padStart(2,'0');});
 }
 const season=$('[data-season-carousel]');
 if(season){
  const slides=$$('[data-season-slide]',season),details=$$('[data-campaign][data-start]'),active=slides.findIndex(s=>day>=s.dataset.start&&day<=s.dataset.end);
  const q=new URLSearchParams(location.search).get('season'),explicit=details.length&&q!==null&&/^\d$/.test(q)&&Number(q)<slides.length,start=explicit?Number(q):Math.max(0,active);
  const status=(a,b)=>day<a?'即將到來':day>b?'往期洗護':'當期提醒';
  slides.forEach(s=>{$('[data-season-status]',s).textContent=status(s.dataset.start,s.dataset.end)+' '+s.dataset.start.slice(5).replace('-','/')+'–'+s.dataset.end.slice(5).replace('-','/');});
  const bar=document.createElement('div');bar.className='r5-season-dots';season.append(bar);
  slides.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','顯示'+$('h2,h3',s).textContent);b.innerHTML='<span></span>';bar.append(b);});
  carousel(season,slides,$$('button',bar),null,start);
  details.forEach(s=>{$$('[data-detail-status]',s).forEach(e=>e.textContent=status(s.dataset.start,s.dataset.end));$$('[data-calendar-start]',s).forEach(e=>e.textContent=status(e.dataset.calendarStart,e.dataset.calendarEnd));});
  function detail(n,scroll){details.forEach((s,i)=>s.hidden=i!==n);const fallback=$('.season-fallback');if(fallback)fallback.hidden=n>=0;document.dispatchEvent(new CustomEvent('sxj:campaign-detail'));const target=$('#campaign-detail');if(scroll&&target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});}}
  if(details.length){detail(active>=0||explicit?start:-1,false);$$('[data-season-detail]',season).forEach(a=>a.addEventListener('click',e=>{e.preventDefault();detail(Number(a.dataset.seasonDetail),true);}));}
 }
})();
