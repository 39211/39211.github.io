/* Shared home/standalone reservation; keeps Claude live summary and Codex steps. */
(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const core=window.BookingCore;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const track=(event,source)=>window.gtag?.('event',event,{link_source:source,transport_type:'beacon'});
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const day=`${parts.year}-${parts.month}-${parts.day}`,campaign=core.campaign(day),season=$('[data-season-bar]');
  if(season&&campaign){
    $('[data-season-dates]',season).textContent='當期提醒 '+campaign.start.slice(5).replace('-','/')+'–'+campaign.end.slice(5).replace('-','/');
    $('[data-season-title]',season).textContent=campaign.title;
    season.hidden=false;
  }
  const weekday=new Date(day+'T12:00:00+08:00').getUTCDay(),minutes=Number(parts.hour)*60+Number(parts.minute);
  const open=weekday>0&&minutes>=(weekday===6?720:600)&&minutes<(weekday===6?1080:1200);
  $$('[data-store-day]').forEach(el=>{if(Number(el.dataset.storeDay)===weekday)el.setAttribute('aria-current','date');});
  $$('[data-store-open]').forEach(el=>{el.textContent=open?'現在營業中・歡迎先傳照片詢問':weekday===0?'今天週日公休・可先在 LINE 留下訊息':'目前非營業時間・可先在 LINE 留下訊息';});

  const box=$('[data-booking-root]');
  if(!box)return;
  const homeGuided=box.dataset.bookingMode==='guided',mobile=matchMedia('(max-width:760px)');let guided=homeGuided||mobile.matches;const form=$('#booking-form',box),summary=$('[data-summary]',box),line=$('[data-line-open]',box),quick=$('[data-quick]');
  const params=new URLSearchParams(location.search),pre=core.prefill(params);
  const rawSource=params.get('source')||(guided?'v4-home-booking':'v4-booking');
  const source=/^[a-zA-Z0-9_-]{1,90}$/.test(rawSource)?rawSource:'v4-booking';
  const state={items:pre.items,district:pre.district,quantity:Math.max(1,pre.items.length),handover:'到府收件',time:'平日',note:''};
  const input=name=>form.elements.namedItem(name);
  let step=1;document.body.classList.add('mobile-ready');
  input('quantity').value=state.quantity;
  input('district').value=state.district;
  if(quick)quick.elements.namedItem('district').value=state.district;
  if(pre.warning){$('[data-prefill-warning]',box).hidden=false;$('[data-prefill-warning]',box).textContent=pre.warning;}
  if(pre.items.some(n=>core.items.findIndex(i=>i.name===n)>=6))$('.more-items',form).open=true;

  function read(){
    state.quantity=input('quantity').value===''?NaN:Number(input('quantity').value);
    for(const k of ['district','handover','time','note'])state[k]=input(k).value;
  }
  function sizeQR(){
    const qr=$('[data-booking-qr]',summary),svg=qr?.querySelector('svg');
    if(!svg||!qr.clientWidth)return;
    const cells=Number(qr.dataset.modules)+8;
    const pixels=cells*Math.max(1,Math.floor(qr.clientWidth/cells));
    svg.style.width=pixels+'px';svg.style.height=pixels+'px';
    svg.style.shapeRendering='crispEdges';
  }
  function render(){
    $$('[data-item]',form).forEach(b=>b.setAttribute('aria-pressed',String(state.items.includes(b.dataset.item))));
    $$('[data-quick-item]').forEach(b=>b.setAttribute('aria-pressed',String(state.items.includes(b.dataset.quickItem))));
    $('[data-summary-items]',summary).textContent=state.items.join('、')||'還沒選擇';
    for(const k of ['quantity','district','handover','time'])$('[data-summary-'+k+']',summary).textContent=k==='quantity'?(Number.isInteger(state.quantity)?state.quantity+' 件':'請確認件數'):state[k]||'請選擇區域';
    const error=core.validate(state),draft=core.draft(state);
    $('[data-draft]',summary).textContent=draft;line.href=error?'#':core.lineURL(draft);line.setAttribute('aria-disabled',String(Boolean(error)));
    $('[data-line-error]',summary).textContent=error;
    $('[data-booking-state]',box).textContent=state.items.length?'已選 '+state.items.join('、')+(state.district?' · '+state.district:''):'先選品項，可一次選多種。';
    box.dataset.step=String(step);box.classList.toggle('is-reviewing',step===3);
    if(!guided){$$('[data-form-step]',form).forEach(el=>el.hidden=false);$('[data-step-back]',form).hidden=true;$('[data-next-step]',form).textContent='確認我的訊息 →';}
    if(guided){
      $$('[data-form-step]',form).forEach(el=>{el.hidden=Number(el.dataset.formStep)!==step;});
      $('[data-next-step]',form).textContent=step===1?'下一步，選區域與時段 →':'下一步，確認我的訊息 →';
      $('[data-step-back]',form).hidden=step!==2;
    }
    $$('[data-goto-step]').forEach(btn=>{
      const n=Number(btn.dataset.gotoStep);btn.setAttribute('aria-current',n===step?'step':'false');
      btn.dataset.complete=String(n<step);
    });
    const mobileSummary=$('[data-mobile-summary]',box);if(mobileSummary)mobileSummary.textContent=(state.items.join('、')||'尚未選品項')+' · '+(Number.isInteger(state.quantity)?state.quantity+' 件':'請確認件數')+' · '+(state.district||'尚未選區域');
    const story=$('.mobile-step-story'),active=$('[data-goto-step="'+step+'"]');if(story&&active){const picture=$('img',active);$('[data-step-picture]',story).src=picture.src;$('[data-step-picture]',story).alt=picture.alt;$('[data-step-heading]',story).textContent=['先選想送洗的品項','安排方便的收送方式','確認後，再交給門市'][step-1];$('[data-step-description]',story).textContent=['照片可複選，接著確認件數。','區域、交接方式、時段都能自己選。','訊息已整理好。開啟 LINE 後，再由你送出。'][step-1];}
    const qr=$('[data-booking-qr]',summary);
    if(qr&&window.qrcode){
      const target=error?'':line.href;
      if(qr.dataset.destination!==target){
        qr.innerHTML='';qr.dataset.destination=target;
        const caption=qr.nextElementSibling;
        caption.textContent=error?'選好品項與區域後，產生這份草稿的 QR Code。':'手機掃碼，開啟同一份草稿。';
        if(target){
          let code=window.qrcode(0,'M');
          try{code.addData(target);code.make();}
          catch{code=window.qrcode(0,'M');code.addData('https://lin.ee/w8qGVqM');code.make();qr.dataset.destination='https://lin.ee/w8qGVqM';caption.textContent='訊息較長，請掃碼加入官方 LINE，再複製貼上訊息。';}
          qr.innerHTML=code.createSvgTag({cellSize:3,margin:12,scalable:true});
          qr.dataset.modules=String(code.getModuleCount());sizeQR();
          qr.setAttribute('aria-label',caption.textContent);
        }
      }
    }
  }
  function error(text,field){
    $('[data-form-error]',form).textContent=text;
    if(guided){step=field==='district'?2:1;render();}
    (field==='items'?$('[data-item]',form):input(field)).focus();
  }
  function valid(target){
    read();
    if(!state.items.length){error('請先選擇至少一個送洗品項。','items');return false;}
    if(!Number.isInteger(state.quantity)||state.quantity<1||state.quantity>99){error('件數請填 1 至 99 的整數。','quantity');return false;}
    if(target===3&&!core.districts.includes(state.district)){error('請選擇收送區域。','district');return false;}
    $('[data-form-error]',form).textContent='';return true;
  }
  function go(target,focus=true){
    document.body.classList.add('booking-open');
    if((target===3||(guided&&target===2))&&!valid(target))return false;
    step=target;render();
    if(focus){
      const el=target===3?$('#summary-title',summary):$('[data-form-step="'+target+'"] h2',form);
      el.tabIndex=-1;el.focus({preventScroll:true});
      (guided?$('.visual-progress'):el).scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});
    }
    return true;
  }
  function clearStatus(){
    $('[data-copy-status]',summary).textContent='';$('[data-form-error]',form).textContent='';
    if(quick)$('[data-quick-error]',quick).textContent='';
  }
  function toggle(name){
    const adding=!state.items.includes(name);
    state.items=adding?[...state.items,name]:state.items.filter(n=>n!==name);
    if(adding&&Number.isInteger(state.quantity)&&state.quantity<state.items.length){state.quantity=state.items.length;input('quantity').value=state.quantity;}
    clearStatus();render();
  }
  form.addEventListener('click',e=>{
    const tile=e.target.closest('[data-item]');if(tile){toggle(tile.dataset.item);return;}
    const qty=e.target.closest('[data-quantity]');
    if(qty){const n=Number(input('quantity').value);input('quantity').value=Math.max(1,Math.min(99,(Number.isInteger(n)?n:1)+Number(qty.dataset.quantity)));read();clearStatus();render();}
  });
  function changed(){read();if(quick)quick.elements.namedItem('district').value=state.district;clearStatus();render();}
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  form.addEventListener('submit',e=>{e.preventDefault();go(guided&&step===1?2:3);});
  $('[data-step-back]',form)?.addEventListener('click',()=>go(1));
  $('[data-edit]',summary).addEventListener('click',()=>go(1));
  $$('[data-goto-step]').forEach(btn=>btn.addEventListener('click',()=>go(Number(btn.dataset.gotoStep))));
  line.addEventListener('click',e=>{if(!valid(3)){e.preventDefault();return;}track('line_click',source);});
  $('[data-copy]',summary).addEventListener('click',async()=>{
    if(!valid(3))return;
    try{if(!navigator.clipboard?.writeText)throw new Error('No clipboard');await navigator.clipboard.writeText(core.draft(state));$('[data-copy-status]',summary).textContent='訊息已複製，可以貼到 LINE。';track('line_copy',source);}
    catch{$('[data-copy-status]',summary).textContent='無法自動複製，請選取上方訊息後手動複製。';const range=document.createRange();range.selectNodeContents($('[data-draft]',summary));const sel=getSelection();sel.removeAllRanges();sel.addRange(range);}
  });
  if(quick){
    quick.addEventListener('click',e=>{const tile=e.target.closest('[data-quick-item]');if(tile)toggle(tile.dataset.quickItem);});
    quick.elements.namedItem('district').addEventListener('change',()=>{input('district').value=quick.elements.namedItem('district').value;read();clearStatus();render();});
    quick.addEventListener('submit',e=>{
      e.preventDefault();read();
      if(!state.items.length){$('[data-quick-error]',quick).textContent='請先點選至少一張品項照片。';$('[data-quick-item]',quick).focus();return;}
      if(!state.district){$('[data-quick-error]',quick).textContent='請選擇你所在的區域。';quick.elements.namedItem('district').focus();return;}
      go(2);track('booking_step','v4-home-quick');
    });
    const bar=$('[data-mobile-cta]');
    if(bar){
      $('a',bar).href='#start';$('a',bar).addEventListener('click',e=>{e.preventDefault();go(step);});
      const seen=new Map(),sections=[quick,box,$('.home-hero')].filter(Boolean);sections.forEach(s=>seen.set(s,false));const observer=new IntersectionObserver(entries=>{entries.forEach(e=>seen.set(e.target,e.isIntersecting));bar.classList.toggle('is-visible',![...seen.values()].some(Boolean));});sections.forEach(s=>observer.observe(s));
    }
  }
  // Motion enhances existing content; it never hides information if JS or observers fail.
  if(!reduced.matches){
    const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('arrived');observer.unobserve(e.target);}}),{threshold:.12});
    $$('.principle-story,.handover-grid li,.service-info').forEach(el=>observer.observe(el));
  }
  $('[data-open-booking]')?.addEventListener('click',()=>go(1));
  mobile.addEventListener('change',()=>{guided=homeGuided||mobile.matches;render();});
  render();document.addEventListener('DOMContentLoaded',render);
  if(window.ResizeObserver)new ResizeObserver(sizeQR).observe($('[data-booking-qr]',summary));
})();
