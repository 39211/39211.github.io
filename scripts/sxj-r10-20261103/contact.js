/* One contact action: phone opens LINE; desktop shows a scannable draft. */
(()=>{
 'use strict';
 const OA='https://lin.ee/w8qGVqM';
 const mobile=()=>/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const isLine=url=>{try{const u=new URL(url,location.href);return /^https:$/.test(u.protocol)&&['line.me','lin.ee'].includes(u.hostname);}catch{return false;}};
 let dialog,trigger;
 function create(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.id='line-contact';dialog.setAttribute('aria-labelledby','line-contact-title');
  dialog.innerHTML='<button type="button" class="contact-close" aria-label="關閉 LINE 視窗">×</button><p class="eyebrow">SI XIANG JIA / LINE</p><h2 id="line-contact-title"></h2><p class="contact-help"></p><div class="contact-layout"><div class="contact-code"><div data-contact-qr></div><p data-qr-caption></p><strong>官方帳號 @454foyks</strong></div><div class="contact-message"><p>已幫你準備的訊息</p><pre data-contact-draft></pre><button type="button" class="btn contact-copy">複製訊息</button><p data-contact-status role="status"></p><a class="text-link" data-contact-fallback href="https://lin.ee/w8qGVqM" target="_blank" rel="noopener">開啟官方 LINE 帳號 ↗</a></div></div><p class="contact-local" hidden>本機預覽：沒有開啟 LINE，也沒有送出訊息。</p>';
  document.body.append(dialog);
  dialog.querySelector('.contact-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});});
  dialog.querySelector('.contact-copy').addEventListener('click',async()=>{
   const text=dialog.querySelector('[data-contact-draft]').textContent,status=dialog.querySelector('[data-contact-status]');
   try{await navigator.clipboard.writeText(text);status.textContent='訊息已複製，到 LINE 貼上即可。';}catch{status.textContent='請選取上方訊息，手動複製到 LINE。';}
  });
 }
 function open(url,{source='website-line',preview=!!window.SXJ_PREVIEW,from=null}={}){
  if(!isLine(url))return;
  document.querySelectorAll('dialog[open] video').forEach(v=>v.pause());
  window.gtag?.('event','line_click',{link_source:source,transport_type:'beacon'});
  if(mobile()&&!preview){location.href=url;return;}
  create();if(!dialog.open)trigger=from||document.activeElement;
  let text='你好，我想詢問洗護與預約收送，我會傳照片請你們評估。';
  try{const u=new URL(url);if(u.pathname.includes('/oaMessage/')&&u.search.length>1)text=decodeURIComponent(u.search.slice(1));}catch{}
  dialog.querySelector('#line-contact-title').textContent=mobile()?'開啟官方 LINE':'手機掃一下，直接和我們聊';
  dialog.querySelector('.contact-help').textContent=mobile()?'訊息會先填入 LINE 對話，確認後再由你送出。':'用手機相機或 LINE 掃描，帶著這份訊息開啟官方帳號。';
  dialog.querySelector('[data-contact-draft]').textContent=text;
  dialog.querySelector('[data-contact-status]').textContent='';
  dialog.querySelector('.contact-local').hidden=!preview;
  const qr=dialog.querySelector('[data-contact-qr]'),caption=dialog.querySelector('[data-qr-caption]');qr.replaceChildren();
  let destination=url;
  if(window.qrcode){
   let code=window.qrcode(0,'M');
   try{code.addData(destination);code.make();caption.textContent='掃碼開啟同一份訊息。';}
   catch{destination=OA;code=window.qrcode(0,'M');code.addData(destination);code.make();caption.textContent='訊息較長：掃碼加入官方帳號，再複製訊息貼上。';dialog.querySelector('.contact-help').textContent='訊息較長，請掃碼開啟官方帳號，再複製下方訊息貼上。';}
   qr.innerHTML=code.createSvgTag({cellSize:4,margin:16,scalable:true});
   qr.dataset.destination=destination;qr.dataset.modules=String(code.getModuleCount());
  }else caption.textContent='可用官方帳號 @454foyks 搜尋，或點下方官方 LINE 連結。';
  document.documentElement.dataset.qaDestination=url;
  if(!dialog.open)dialog.showModal();
  const svg=qr.querySelector('svg');if(svg){const cells=Number(qr.dataset.modules)+8,px=cells*Math.max(1,Math.floor(qr.clientWidth/cells));svg.style.width=px+'px';svg.style.height=px+'px';svg.style.shapeRendering='crispEdges';}
 }
 window.SXJContact={open,isMobile:mobile};
 document.addEventListener('click',e=>{
  const a=e.target.closest('a[href]');if(!a||!isLine(a.href)||a.getAttribute('aria-disabled')==='true')return;
  if(a.hasAttribute('data-contact-fallback')&&!window.SXJ_PREVIEW)return;
  e.preventDefault();e.stopImmediatePropagation();
  open(a.href,{source:a.dataset.lineSource||'website-line',from:a});
 },true);
})();
