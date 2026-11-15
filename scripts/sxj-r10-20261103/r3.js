// Desktop keeps all six recent cards visible; mobile starts with three and a disclosure.
(()=>{
 const more=document.querySelector('.journal-more');if(!more)return;
 const phone=matchMedia('(max-width:760px)');let expanded=false;
 function layout(){more.open=phone.matches?expanded:true;}
 more.addEventListener('toggle',()=>{if(phone.matches)expanded=more.open;});phone.addEventListener('change',layout);layout();
})();
// Mobile price workbench: keep the current subtotal in view while editing a long list.
(()=>{
 const table=document.querySelector('#est'),count=document.querySelector('#est-count'),sum=document.querySelector('#est-sub');if(!table||!count||!sum)return;
 const bar=document.createElement('div');bar.className='mobile-estimate-status';bar.setAttribute('role','status');
 const label=document.createElement('span'),link=document.createElement('a');link.textContent='查看清單 ↓';link.href='#estimate-summary';bar.append(label,link);table.prepend(bar);
 count.parentElement.id='estimate-summary';
 function update(){label.textContent='已選 '+count.textContent+' 件 · 參考 '+sum.textContent;}
 const observer=new MutationObserver(update);observer.observe(count,{childList:true,characterData:true,subtree:true});observer.observe(sum,{childList:true,characterData:true,subtree:true});update();
})();
