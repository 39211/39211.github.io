/* Optional selections only. No step gate between the visitor and the shop. */
(()=>{
 'use strict';
 const root=document.querySelector('[data-fast-root]');if(!root)return;
 const core=window.BookingCore,form=root.querySelector('form'),params=new URLSearchParams(location.search),pre=core.prefill(params);
 const state={items:pre.items,district:pre.district};
 const field=n=>form.elements.namedItem(n);
 if(field('district'))field('district').value=state.district;
 if(pre.warning){root.querySelector('[data-fast-warning]').textContent=pre.warning;}
 if(pre.items.some(n=>core.items.findIndex(i=>i.name===n)>=6)){const more=root.querySelector('.fast-more');if(more)more.open=true;}
 function draft(){
  const lines=['你好，我想詢問洗護與預約收送：'];
  if(state.items.length)lines.push('品項：'+state.items.join('、'));
  if(state.district)lines.push('區域：'+state.district);
  const raw=field('quantity')?.value||'',n=Number(raw),good=raw&&Number.isInteger(n)&&n>=1&&n<=99;
  if(good)lines.push('合計件數：'+n+' 件');
  const error=root.querySelector('[data-fast-error]');if(error)error.textContent=raw&&!good?'件數尚未加入訊息，請留空或填 1 至 99 的整數。':'';
  for(const [name,label] of [['handover','交接方式'],['time','方便時段'],['note','備註']]){const value=field(name)?.value.trim();if(value)lines.push(label+'：'+value.slice(0,200));}
  lines.push('我會補上物件與洗標照片，請協助確認費用及收送時間。');return lines.join('\n');
 }
 window.SXJFast={url:()=>core.lineURL(draft())};
 function render(){
  root.querySelectorAll('[data-fast-item]').forEach(b=>b.setAttribute('aria-pressed',String(state.items.includes(b.dataset.fastItem))));
  const text=draft(),url=core.lineURL(text);
  document.querySelectorAll('[data-fast-current]').forEach(a=>a.href=url);
  root.querySelectorAll('[data-fast-secondary]').forEach(a=>{const q=new URLSearchParams();if(state.items.length)q.set('item',state.items.join(','));if(state.district)q.set('district',state.district);a.href='/booking/'+(q.size?'?'+q:'');});
  root.querySelectorAll('[data-fast-draft]').forEach(p=>p.textContent=text);
  const status=root.querySelector('[data-fast-selection]');if(status)status.textContent=state.items.length?'已選：'+state.items.join('、'):'不確定品項也沒關係，直接傳照片給我們。';
 }
 root.addEventListener('click',e=>{const b=e.target.closest('[data-fast-item]');if(!b)return;const n=b.dataset.fastItem;state.items=state.items.includes(n)?state.items.filter(x=>x!==n):[...state.items,n];render();});
 form.addEventListener('input',()=>{state.district=field('district')?.value||'';render();});
 form.addEventListener('change',()=>{state.district=field('district')?.value||'';render();});
 form.addEventListener('submit',e=>{e.preventDefault();window.SXJContact.open(core.lineURL(draft()),{source:'fast-booking',from:document.activeElement});});
 render();
})();
