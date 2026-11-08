(()=>{'use strict';
 const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
 const motion=matchMedia('(prefers-reduced-motion: reduce)'), fine=matchMedia('(min-width:1100px) and (hover:hover) and (pointer:fine)');
 document.body.classList.add('r10-enhanced');
 // Preview never steals pointer, focus, or the chosen service. Escape dismisses it.
 const peek=$('.r10-peek'),tabs=$('.r6-care-tabs');let peekActive=null,peekBlocked=null;
 const closePeek=()=>{if(peek)peek.hidden=true;peekActive=null;};
 function positionPeek(e){if(!peekActive)return;const w=224,h=310,x=e.clientX+w+26<innerWidth?e.clientX+26:e.clientX-w-26;peek.style.left=Math.max(10,Math.min(innerWidth-w-10,x))+'px';peek.style.top=Math.max(82,Math.min(innerHeight-h-12,e.clientY-h/2))+'px';}
 $$('[data-care-tab]').forEach(button=>{
  button.addEventListener('pointerenter',e=>{if(!fine.matches||e.pointerType==='touch'||peekBlocked===button)return;peekActive=button;peek.querySelector('img').src=button.querySelector('img').src;peek.querySelector('figcaption span').textContent=button.getAttribute('aria-label');peek.hidden=false;positionPeek(e);});
  button.addEventListener('pointermove',positionPeek);
  button.addEventListener('pointerleave',()=>{if(peekBlocked===button)peekBlocked=null;closePeek();});
  button.addEventListener('click',()=>{peekBlocked=button;closePeek();});
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){peekBlocked=peekActive;closePeek();}});
 addEventListener('scroll',closePeek,{passive:true});fine.addEventListener('change',closePeek);
 // Optional journey: no state is required to contact LINE and no booking is submitted.
 const journeys=$$('[data-journey]'),note=$('#journey-note'),output=$('[data-journey-output]');
 function journey(index,announce){journeys.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));output.replaceChildren($('[data-journey-copy="'+index+'"]').content.cloneNode(true));const line=output.querySelector('[data-fast-current]'),current=$('[data-fast-current]',$('[data-fast-root]'));if(line&&current)line.href=current.href;$('.r10-journey-number').textContent=String(index+1).padStart(2,'0');$('[data-journey-count]').textContent=(index+1)+' / 4';$('.r10-journey-track').style.setProperty('--step',index+1);note.hidden=false;if(announce)$('.r10-journey-status').textContent='流程導覽第 '+(index+1)+' 步：'+output.querySelector('h3').textContent;}
 journeys.forEach((b,i)=>{b.disabled=false;b.addEventListener('click',()=>journey(i,true));});if(journeys.length)journey(0,false);
 // Three principles retain native details; mobile has a real scrollable photo album.
 const album=$('#principles'),cards=$$('.r10-principle',album),prev=$('[data-album-prev]'),next=$('[data-album-next]');let albumIndex=0,albumTimer=0;
 function albumState(){const left=album.getBoundingClientRect().left;albumIndex=cards.reduce((best,c,i)=>Math.abs(c.getBoundingClientRect().left-left)<Math.abs(cards[best].getBoundingClientRect().left-left)?i:best,0);$('[data-album-count]').textContent=(albumIndex+1)+' / '+cards.length;prev.disabled=albumIndex===0;next.disabled=albumIndex===cards.length-1;}
 function goAlbum(delta){const i=Math.max(0,Math.min(cards.length-1,albumIndex+delta));const left=cards[i].getBoundingClientRect().left-album.getBoundingClientRect().left+album.scrollLeft;album.scrollTo({left,behavior:motion.matches?'instant':'smooth'});}
 prev.addEventListener('click',()=>goAlbum(-1));next.addEventListener('click',()=>goAlbum(1));
 album.addEventListener('scroll',()=>{clearTimeout(albumTimer);albumTimer=setTimeout(albumState,100);},{passive:true});addEventListener('resize',albumState,{passive:true});$('.r10-album-tools').hidden=false;albumState();
 // Content is never hidden by animation setup: no-JS/reduced-motion stays fully readable.
 const ink=$('[data-ink]'),texture=$('.r10-texture'),reading=$('.r10-reading');let queued=false;
 function scrollEffects(){queued=false;const max=document.documentElement.scrollHeight-innerHeight;reading.style.setProperty('--read',Math.max(0,Math.min(1,scrollY/Math.max(1,max))));const r=ink.getBoundingClientRect(),progress=Math.max(0,Math.min(1,(innerHeight*.9-r.top)/(innerHeight*.65)));ink.style.setProperty('--ink',motion.matches?'100%':(progress*100)+'%');const t=texture.getBoundingClientRect();texture.style.setProperty('--drift',motion.matches?'0px':Math.max(-12,Math.min(12,(innerHeight/2-t.top-t.height/2)*.025))+'px');}
 function queueEffects(){if(!queued){queued=true;requestAnimationFrame(scrollEffects);}}
 addEventListener('scroll',queueEffects,{passive:true});addEventListener('resize',queueEffects,{passive:true});motion.addEventListener('change',()=>{document.getAnimations().filter(a=>a.effect?.target?.hasAttribute?.('data-r10-reveal')).forEach(a=>a.finish());queueEffects();});scrollEffects();
 if('IntersectionObserver' in window){const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(!e.isIntersecting)return;if(!motion.matches&&e.target.getBoundingClientRect().top>0)e.target.animate([{clipPath:'inset(0 0 15% 0)',opacity:.72},{clipPath:'inset(0 0 0 0)',opacity:1}],{duration:650,easing:'cubic-bezier(.22,1,.36,1)'});io.unobserve(e.target);}),{threshold:.12});$$('[data-r10-reveal]').forEach(el=>io.observe(el));}
 document.body.dataset.r10Ready='true';
})();
