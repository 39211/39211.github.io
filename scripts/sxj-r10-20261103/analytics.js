(()=>{'use strict';
const live=['sixiangjialaundry.com','www.sixiangjialaundry.com'].includes(location.hostname);
window.SXJ_PREVIEW=!live;
if(!live){window.gtag=()=>{};return;}
window.dataLayer=window.dataLayer||[];
window.gtag=function(){window.dataLayer.push(arguments);};
window.gtag('js',new Date());window.gtag('config','G-ZKHW4MTBZJ');
const s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-ZKHW4MTBZJ';document.head.append(s);
})();
