/* sw-register.js — Service Worker registration */
(function(global){
'use strict';
if(!('serviceWorker' in navigator)){console.info('SW not supported');return}
function notifyUpdate(){if(global.XR_UI&&global.XR_UI.toast)global.XR_UI.toast('Versioni i ri eshte gati. Ringarko.','info',4000)}
async function register(){
  try{
    const reg=await navigator.serviceWorker.register('service-worker.js',{scope:'./'});
    reg.addEventListener('updatefound',function(){
      const nw=reg.installing;if(!nw)return;
      nw.addEventListener('statechange',function(){if(nw.state==='installed'&&navigator.serviceWorker.controller)notifyUpdate()});
    });
    try{if('sync' in reg)await reg.sync.register('xr-prayer-refresh')}catch(e){}
    try{if('periodicSync' in reg)await reg.periodicSync.register('xr-prayer-periodic',{minInterval:12*60*60*1000})}catch(e){}
  }catch(e){console.warn('SW registration failed',e)}
}
if(document.readyState==='complete')register();
else global.addEventListener('load',register);
})(window);
