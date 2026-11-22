/* Preserve useful v4 price, service and business controls in the shared preview. */
(()=>{
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)],core=window.BookingCore;
  const contextual=$$('[data-context-current]').map(a=>[a,a.href]);
  function context(text){contextual.forEach(([a,original])=>a.href=text?core.lineURL(text):original);}
  const track=(event,source)=>window.gtag?.('event',event,{source,link_source:source,transport_type:'beacon'});
  function status(after){const p=document.createElement('p');p.className='legacy-status';p.setAttribute('role','status');after.after(p);return p;}
  async function copy(text,output,source){
    try{if(!navigator.clipboard?.writeText)throw new Error('Unavailable');await navigator.clipboard.writeText(text);output.textContent='訊息已複製。';track('line_copy',source);}
    catch{output.textContent='無法自動複製，請選取訊息後手動複製。';}
  }
  function open(text,source){if(window.SXJContact)window.SXJContact.open(core.lineURL(text),{source});else{track('line_click',source);window.open(core.lineURL(text),'_blank','noopener');}}
  $$('[data-line-builder]').forEach(box=>{
    const out=$('[data-line-text]',box),link=$('[data-line-open]',box),btn=$('[data-line-copy]',box),src=box.dataset.source||'v4-guide';
    const output=status(btn||link||box);let text='',valid=false;
    function render(fromUser=false){
      const lines=[box.dataset.head||'你好，我想詢問送洗：'];let selected=0;
      $$('[data-group],[data-field]',box).forEach(group=>{
        if(group.hasAttribute('data-field')){if(group.value.trim())lines.push(group.dataset.field+'：'+group.value);return;}
        const on=$$('[aria-pressed=true]',group).map(b=>b.textContent.trim());selected+=on.length;
        if(group.dataset.multi==='1'){const fmt=group.dataset.fmt||'・{v}';if(on.length)on.forEach(v=>lines.push(fmt.replace('{v}',v)));}
        else if(on[0])lines.push(group.dataset.group+'：'+on[0]);
      });
      lines.push(...(box.dataset.tail||'照片另傳。').split('|'));text=lines.filter(x=>!x.includes('＿＿')).join('\n');valid=true;
      if(out)out.textContent=text;
      if(link){link.href=core.lineURL(text);link.removeAttribute('aria-disabled');link.dataset.lineSource=src;}
      output.textContent='';if(fromUser)context(text);
    }
    box.addEventListener('click',e=>{const b=e.target.closest('[aria-pressed]');if(!b||!box.contains(b))return;const group=b.closest('[data-group]'),on=b.getAttribute('aria-pressed')!=='true';if(group&&group.dataset.multi!=='1')$$('[aria-pressed]',group).forEach(x=>x.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed',String(on));render(true);});
    box.addEventListener('change',e=>{const map=$('[data-map-select]');if(e.target.matches('[data-field=區域]')&&map&&core.districts.includes(e.target.value)&&map.value!==e.target.value){map.value=e.target.value;map.dispatchEvent(new Event('change',{bubbles:true}));}render(true);});
    document.addEventListener('sxj:campaign-detail',()=>{const section=box.closest('[data-campaign]');if(section&&!section.hidden)render(true);});
    link?.addEventListener('click',e=>{if(!valid){e.preventDefault();output.textContent='請先選擇至少一項。';return;}track('line_click',src);});
    btn?.addEventListener('click',()=>{if(!valid){output.textContent='請先選擇至少一項。';return;}copy(text,output,src);});
    render();
  });
  const rows=$$('[data-key]');
  if(rows.length){
    const count=$('#est-count'),subtotal=$('#est-sub'),send=$('#est-send'),clear=$('#est-clear'),output=status(send),quantities=new Map();let text='';
    function render(){let qty=0,sum=0;const lines=[];rows.forEach(r=>{const n=quantities.get(r.dataset.key)||0;$('[data-qty]',r).textContent=n;if(n){qty+=n;sum+=n*Number(r.dataset.price);lines.push('・'+r.dataset.name+' × '+n);}});count.textContent=qty;subtotal.textContent='$'+sum.toLocaleString();send.disabled=!qty;text='你好，我想詢問送洗：\n'+lines.join('\n')+'\n參考小計 $'+sum+'（水洗參考價，實際報價由門市確認）\n照片另傳。';output.textContent='';context(qty?text:null);}
    rows.forEach(r=>{const key=r.dataset.key;$('[data-inc]',r).addEventListener('click',()=>{quantities.set(key,Math.min(999,(quantities.get(key)||0)+1));render();});$('[data-dec]',r).addEventListener('click',()=>{quantities.set(key,Math.max(0,(quantities.get(key)||0)-1));render();});});
    clear.addEventListener('click',()=>{quantities.clear();render();});
    send.addEventListener('click',()=>{if(send.disabled)return;open(text,'v4-prices-estimate');});render();
  }
  const biz=$('#biz-rows');
  if(biz){
    const template=$('[data-biz-row]',biz).cloneNode(true),out=$('#biz-text'),send=$('#biz-send'),output=status(send);let valid=false;
    function build(){let bad=false;const entries=[];$$('[data-biz-row]',biz).forEach(r=>{const input=$('[data-f=qty]',r),raw=input.value.trim(),n=Number(raw);if(raw&&(!Number.isInteger(n)||n<1||n>9999||!$('[data-f=item]',r).value))bad=true;else if(raw)entries.push('・'+$('[data-f=item]',r).value+' × '+n+'（'+($('[data-f=freq]',r).value||'頻率待確認')+'）');});valid=entries.length>0&&!bad;out.textContent='你好，我想詢問店家／公司大量送洗。\n行業：'+($('input[name=bizind]:checked')?.value||'待確認')+'\n品項：\n'+entries.join('\n')+'\n交接方式：'+($('#biz-handover').value||'待確認')+'\n區域：'+($('#biz-district').value||'待確認')+($('#biz-note').value.trim()?'\n備註：'+$('#biz-note').value.trim():'')+'\n照片另傳，收送時間與報價請門市確認。';const rs=$$('[data-biz-row]',biz);rs.forEach(r=>$('[data-remove]',r).disabled=rs.length<=1);send.disabled=!valid;output.textContent=bad?'每列請選品項，件數填 1 至 9999 的整數。':entries.length?'':'要傳清單時再填品項與件數，也可以直接點上方 LINE 詢問。';context(valid?out.textContent:null);}
    function wire(r){for(const [key,label] of [['item','送洗品項'],['qty','件數'],['freq','送洗頻率']])$('[data-f='+key+']',r).setAttribute('aria-label',label);const input=$('[data-f=qty]',r);input.type='number';input.min='1';input.max='9999';input.step='1';$('[data-remove]',r).addEventListener('click',()=>{if($$('[data-biz-row]',biz).length>1){r.remove();build();}});}
    $$('[data-biz-row]',biz).forEach(wire);$('#biz-add').addEventListener('click',()=>{const row=template.cloneNode(true);$('[data-f=qty]',row).value='';biz.appendChild(row);wire(row);build();});
    $('#biz-form').addEventListener('input',build);$('#biz-form').addEventListener('change',build);
    send.addEventListener('click',()=>{if(!valid)return;open(out.textContent,'v4-business-list');});build();
  }
  function qr(){if(!window.qrcode)return;$$('[data-line-qr]').forEach(el=>{const code=window.qrcode(0,'M');code.addData('https://lin.ee/w8qGVqM');code.make();el.innerHTML=code.createSvgTag({cellSize:3,margin:3,scalable:true});});}
  document.addEventListener('DOMContentLoaded',qr);qr();
})();
