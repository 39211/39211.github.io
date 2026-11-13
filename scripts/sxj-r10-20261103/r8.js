(()=>{'use strict';
 document.body.classList.add('r8-enhanced');
 document.querySelectorAll('.r8-photo-guide').forEach(guide=>{
  const output=guide.querySelector('[data-photo-tip-output]');
  guide.querySelectorAll('[data-photo-tip]').forEach(button=>{button.disabled=false;button.addEventListener('click',()=>{
   guide.querySelectorAll('[data-photo-tip]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
   const template=guide.querySelector('[data-tip-copy="'+button.dataset.photoTip+'"]');
   output.textContent=template.content.textContent;
  });});
 });
})();
