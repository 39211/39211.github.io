/* Shared interaction layer for the new static design. No form data is stored. */
(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const OA='https://line.me/R/oaMessage/%40454foyks/?';
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const phone=matchMedia('(max-width: 600px)');
  const track=(event,source)=>{ if(typeof window.gtag==='function') window.gtag('event',event,{source,link_source:source,transport_type:'beacon'}); };
  const menu=$('.menu-toggle');
  menu?.addEventListener('click',()=>{ const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));$('#site-menu').classList.toggle('open',open); });
  $('#site-menu')?.addEventListener('click',()=>{menu.setAttribute('aria-expanded','false');$('#site-menu').classList.remove('open');});

  const carousel=$('[data-carousel]');
  if(carousel){
    const slides=$$('[data-slide]',carousel), count=$('[data-slide-count]',carousel), pause=$('[data-pause]',carousel);
    let current=0,timer=null,playing=!phone.matches&&!motion.matches,touch=null;
    function update(){slides.forEach((e,i)=>e.hidden=i!==current);count.textContent=String(current+1).padStart(2,'0')+' / 03';carousel.dataset.current=String(current);}
    function stop(){clearInterval(timer);timer=null;}
    function timerStart(){stop();if(playing&&!document.hidden)timer=setInterval(()=>{current=(current+1)%slides.length;update();},7500);}
    function state(on){playing=on;pause.textContent=on?'暫停輪播':'播放輪播';pause.setAttribute('aria-label',pause.textContent);count.setAttribute('aria-live',on?'off':'polite');carousel.dataset.playing=String(on);timerStart();}
    function advance(delta){state(false);current=(current+delta+slides.length)%slides.length;update();}
    $('[data-prev]',carousel).addEventListener('click',()=>advance(-1));
    $('[data-next]',carousel).addEventListener('click',()=>advance(1));
    pause.addEventListener('click',()=>state(!playing));
    carousel.addEventListener('focusin',e=>{if(e.target!==pause)state(false);});
    carousel.addEventListener('mouseenter',()=>{if(playing)state(false);});
    carousel.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();advance(1);}if(e.key==='ArrowLeft'){e.preventDefault();advance(-1);}});
    carousel.addEventListener('touchstart',e=>{touch={x:e.changedTouches[0].clientX,y:e.changedTouches[0].clientY};},{passive:true});
    carousel.addEventListener('touchend',e=>{if(!touch)return;const dx=e.changedTouches[0].clientX-touch.x,dy=e.changedTouches[0].clientY-touch.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)advance(dx<0?1:-1);touch=null;},{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else timerStart();});
    motion.addEventListener('change',()=>{if(motion.matches)state(false);});
    phone.addEventListener('change',()=>{if(phone.matches)state(false);});
    state(playing);update();
  }

  const box=$('[data-booking]');
  if(!box)return;
  const form=$('#booking-form'), district=$('#booking-district'), draft=$('[data-draft]'), link=$('[data-line-open]'), error=$('[data-error]'), qr=$('[data-booking-qr]');
  const source=box.dataset.source;
  let valid=false;
  const selected=()=>$$('input[name=item]:checked',form).map(i=>i.value);
  function message(){
    const items=selected();
    const lines=['你好，我想詢問送洗：','品項：'+(items.join('、')||'＿＿'),'區域：'+(district.value||'＿＿'),'交接方式：'+form.elements.handover.value,'方便時段：'+form.elements.time.value];
    if(form.elements.quantity.value)lines.push('件數：'+form.elements.quantity.value);
    if(form.elements.note.value.trim())lines.push('備註：'+form.elements.note.value.trim());
    lines.push('照片另傳。');return lines.join('\n');
  }
  function render(){
    valid=selected().length>0&&district.value!==''&&form.elements.quantity.checkValidity();
    $('[data-selection]').textContent=selected().join(' ＋ ')||'尚未選擇';
    const text=message();draft.textContent=text;link.href=OA+encodeURIComponent(text);link.setAttribute('aria-disabled',String(!valid));
    if(valid)error.textContent='';
    if(qr){qr.innerHTML='';if(valid&&window.qrcode){const q=window.qrcode(0,'M');q.addData(link.href);q.make();qr.innerHTML=q.createSvgTag({cellSize:3,margin:4,scalable:true});qr.setAttribute('aria-label','開啟目前草稿的 LINE 二維碼');}}
  }
  function validate(){
    render();if(valid)return true;
    error.textContent=selected().length===0?'請先選擇至少一個送洗品項。':!district.value?'請選擇收送區域。':'件數請填 1 至 999 的整數，或留空。';
    box.dataset.step='choose';
    const control=selected().length===0?$('input[name=item]',form):!district.value?district:form.elements.quantity;control.focus();return false;
  }
  function review(){if(!validate())return;box.dataset.step='review';if(phone.matches){$('#review-h').focus();box.scrollIntoView({behavior:motion.matches?'instant':'smooth',block:'start'});}else $('[data-booking-review]').scrollIntoView({behavior:motion.matches?'instant':'smooth',block:'center'});}
  form.addEventListener('submit',e=>{e.preventDefault();review();});
  form.addEventListener('input',render);form.addEventListener('change',render);
  $('[data-edit]').addEventListener('click',()=>{box.dataset.step='choose';$('input[name=item]',form).focus();});
  link.addEventListener('click',e=>{if(!validate()){e.preventDefault();return;}track('line_click',source);});
  $('[data-copy]').addEventListener('click',async e=>{if(!validate())return;try{await navigator.clipboard.writeText(message());e.target.textContent='已複製訊息';}catch{e.target.textContent='請選取上方草稿後複製';const range=document.createRange();range.selectNodeContents(draft);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);}track('line_copy',source);});
  $('[data-quick]')?.addEventListener('submit',e=>{e.preventDefault();const q=e.currentTarget;if(q.elements.quickitem.value){const vals=q.elements.quickitem.value.split('、');$$('input[name=item]',form).forEach(i=>i.checked=vals.includes(i.value));}if(q.elements.quickdistrict.value)district.value=q.elements.quickdistrict.value;box.dataset.step='choose';render();box.scrollIntoView({behavior:motion.matches?'instant':'smooth'});if(selected().length&&district.value)review();});
  // Only selection state is shared with the map. Opening LINE remains an explicit click.
  const map=$('[data-sxj-map]');
  if(map){
    const mapSelect=$('[data-map-select]',map), name=$('[data-mi-name]',map), mapLink=$('[data-mi-line]',map);
    function sync(){const value=name.textContent.trim();if($$('option',district).some(o=>o.value===value)){district.value=value;mapSelect.value=value;render();}$$('[data-d]',map).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.d===value)));}
    new MutationObserver(sync).observe(name,{childList:true,characterData:true,subtree:true});
    mapSelect.addEventListener('change',()=>{const button=$$('[data-d]',map).find(b=>b.dataset.d===mapSelect.value);button?.click();sync();});
    district.addEventListener('change',()=>{if(district.value&&name.textContent.trim()!==district.value){$$('[data-d]',map).find(b=>b.dataset.d===district.value)?.click();sync();}});
    map.addEventListener('click',e=>{if(e.target.closest('.store')){$('[data-d="西屯區"]',map).click();sync();}});
    $('[data-map-book]').addEventListener('click',()=>{sync();box.dataset.step='choose';});
    // Override the map's simple draft with selected items when those are available.
    mapLink.addEventListener('click',e=>{
      sync();
      if(selected().length&&!validate()){e.preventDefault();e.stopImmediatePropagation();return;}
      const text=selected().length?message():'你好，我在'+district.value+'，想預約收送。\n件數：＿＿\n方便時段：＿＿\n照片另傳。';
      mapLink.href=OA+encodeURIComponent(text);
    },true);
    sync();
  }
  $$('a[href="#line-guide"]').forEach(a=>a.addEventListener('click',()=>{box.dataset.step='choose';}));
  render();
})();
