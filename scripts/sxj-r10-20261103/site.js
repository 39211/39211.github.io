/* Shared interaction for the integrated static preview. No form data is persisted. */
(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const core=window.BookingCore, reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const track=(name,source)=>window.gtag?.('event',name,{source,link_source:source,transport_type:'beacon'});
  const menu=$('.menu-button'),nav=$('#navigation');
  function closeMenu(){menu.setAttribute('aria-expanded','false');nav.classList.remove('is-open');}
  menu.addEventListener('click',()=>{const on=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(on));nav.classList.toggle('is-open',on);});
  nav.addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('is-open')){closeMenu();menu.focus();}});

  const dated=$$('[data-campaign][data-start][data-end]');
  if(dated.length){
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    let active=false;dated.forEach(s=>{const on=today>=s.dataset.start&&today<=s.dataset.end;s.hidden=!on;active=active||on;});
    if(!active){const p=document.createElement('p');p.className='season-fallback';p.textContent='日常洗護持續提供，先傳物件照片，讓門市和你一起確認處理方向。';dated[0].before(p);}
  }

  const map=$('[data-sxj-map]');
  if(map){
    const name=$('[data-mi-name]',map),link=$('[data-mi-line]',map),select=$('[data-map-select]',map),mapLinks=$$('[data-mi-line],[data-map-book]',map);
    let mapChosen=false,lastDistrict='';
    function syncMap(){const d=name?.textContent.trim();if(!d||!core.districts.includes(d))return;if(lastDistrict&&lastDistrict!==d)mapChosen=true;lastDistrict=d;mapLinks.forEach(a=>{a.href=core.lineURL('你好，我想預約收送：\n區域：'+d+'\n我會傳照片，請協助確認費用及收送時間。');a.dataset.lineSource='v4-map';a.textContent='LINE 詢問'+d+'收送 ↗';});if(select)select.value=d;if(mapChosen){const fields=$$('[data-line-builder] [data-field=區域]');if(fields.length)fields.forEach(field=>{field.value=d;field.dispatchEvent(new Event('change',{bubbles:true}));});else $$('[data-context-current]').forEach(a=>a.href=link.href);}$$('[data-d]',map).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.d===d)));}
    if(name)new MutationObserver(syncMap).observe(name,{childList:true,characterData:true,subtree:true});
    select?.addEventListener('change',()=>{mapChosen=true;$$('[data-d]',map).find(b=>b.dataset.d===select.value)?.click();syncMap();});
    map.addEventListener('click',e=>{if(e.target.closest('[data-d],svg')){mapChosen=true;syncMap();}});
    document.addEventListener('DOMContentLoaded',syncMap);syncMap();
  }
})();
