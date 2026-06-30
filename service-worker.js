/* service-worker.js — Offline-first cache for Xhamia Ratkoc PWA */
const APP_VERSION='2.1.2';
const STATIC_CACHE='xr-static-'+APP_VERSION;
const RUNTIME_CACHE='xr-runtime-'+APP_VERSION;
const PRAYER_CACHE='xr-prayer-'+APP_VERSION;
const FONT_CACHE='xr-fonts-'+APP_VERSION;
const BIK_CACHE='xr-bik-'+APP_VERSION;
const QURAN_CACHE='xr-quran-'+APP_VERSION;   // teksti i sureve (alquran.cloud)
const AUDIO_CACHE='xr-audio';                // recitimet (i pavarur nga versioni — nuk fshihet ne update)

const PRECACHE=[
  './','./index.html','./manifest.json','./css/styles.css',
  './js/app.js','./js/storage.js','./js/prayer-engine.js','./js/quran-data.js','./js/daily-content.js','./js/notifications.js','./js/quran-controller.js','./js/ui-controller.js','./js/sw-register.js',
  './assets/icons/icon.svg','./assets/icons/maskable.svg'
];

self.addEventListener('install',function(event){
  event.waitUntil((async function(){
    const cache=await caches.open(STATIC_CACHE);
    try{await cache.addAll(PRECACHE)}
    catch(e){for(const url of PRECACHE){try{await cache.add(url)}catch(_){}}}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',function(event){
  event.waitUntil((async function(){
    const keys=await caches.keys();
    await Promise.all(keys.map(function(k){
      if([STATIC_CACHE,RUNTIME_CACHE,PRAYER_CACHE,FONT_CACHE,BIK_CACHE,QURAN_CACHE,AUDIO_CACHE].indexOf(k)<0)return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

function isAladhan(url){return url.hostname==='api.aladhan.com'}
function isQuranAPI(url){return url.hostname==='api.alquran.cloud'}
function isQuranAudio(url){return url.hostname==='cdn.islamic.network' && url.pathname.indexOf('/quran/audio')>=0}
function isBIKGithub(url){return url.hostname==='raw.githubusercontent.com' && url.pathname.indexOf('drilonjaha/kohet-e-namazit-kosove-json')>=0}
function isFont(url){return url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com'}
function isTailwind(url){return url.hostname==='cdn.tailwindcss.com'}
function sameOrigin(url){return url.origin===self.location.origin}
function isNav(req){return req.mode==='navigate'||(req.method==='GET'&&req.headers.get('accept')&&req.headers.get('accept').indexOf('text/html')>=0)}

async function networkFirst(event,cacheName,timeout){
  timeout=timeout||5000;
  const cache=await caches.open(cacheName);
  try{
    const f=fetch(event.request);
    const to=new Promise(function(res){setTimeout(function(){res('__t__')},timeout)});
    const r=await Promise.race([f,to]);
    if(r==='__t__')throw new Error('timeout');
    if(r&&r.ok)cache.put(event.request,r.clone());
    return r;
  }catch(e){
    const c=await cache.match(event.request);
    if(c)return c;
    if(isNav(event.request)){const shell=await cache.match('./index.html');if(shell)return shell}
    throw e;
  }
}
async function cacheFirst(event,cacheName){
  const cache=await caches.open(cacheName);
  const c=await cache.match(event.request);
  if(c){
    event.waitUntil((async function(){try{const f=await fetch(event.request);if(f&&f.ok)cache.put(event.request,f.clone())}catch(_){}})());
    return c;
  }
  try{
    const r=await fetch(event.request);
    if(r&&r.ok)cache.put(event.request,r.clone());
    return r;
  }catch(e){
    if(isNav(event.request)){const shell=await cache.match('./index.html');if(shell)return shell}
    return new Response('',{status:503,statusText:'Offline'});
  }
}
async function staleWhileRevalidate(event,cacheName){
  const cache=await caches.open(cacheName);
  const c=await cache.match(event.request);
  const n=fetch(event.request).then(function(r){if(r&&r.ok)cache.put(event.request,r.clone());return r}).catch(function(){return null});
  return c||(await n)||new Response('',{status:504});
}
/* Audio: prej rrjetit kur online (mbeshtet kerkesat Range per seek/stream),
 * kthen versionin e ruajtur kur offline. Ruan vetem pergjigjet e plota (200). */
async function audioStrategy(event){
  const cache=await caches.open(AUDIO_CACHE);
  try{
    const res=await fetch(event.request);
    if(res&&res.status===200){try{cache.put(event.request,res.clone())}catch(e){}}
    return res;
  }catch(e){
    const c=await cache.match(event.request,{ignoreVary:true});
    if(c)return c;
    const c2=await cache.match(new Request(event.request.url));
    if(c2)return c2;
    return new Response('',{status:504,statusText:'Offline'});
  }
}

self.addEventListener('fetch',function(event){
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(isBIKGithub(url)){event.respondWith(staleWhileRevalidate(event,BIK_CACHE));return}
  if(isQuranAudio(url)){event.respondWith(audioStrategy(event));return}
  if(isQuranAPI(url)){event.respondWith(staleWhileRevalidate(event,QURAN_CACHE));return}
  if(isAladhan(url)){event.respondWith(networkFirst(event,PRAYER_CACHE,6000));return}
  if(isFont(url)){event.respondWith(staleWhileRevalidate(event,FONT_CACHE));return}
  if(isTailwind(url)){event.respondWith(staleWhileRevalidate(event,RUNTIME_CACHE));return}
  if(sameOrigin(url)){event.respondWith(isNav(req)?networkFirst(event,STATIC_CACHE,3500):staleWhileRevalidate(event,STATIC_CACHE));return}
  event.respondWith(staleWhileRevalidate(event,RUNTIME_CACHE));
});

self.addEventListener('sync',function(event){if(event.tag==='xr-prayer-refresh')event.waitUntil(refreshPrayerCache())});
self.addEventListener('periodicsync',function(event){if(event.tag==='xr-prayer-periodic')event.waitUntil(refreshPrayerCache())});

async function refreshPrayerCache(){
  try{
    const url='https://raw.githubusercontent.com/drilonjaha/kohet-e-namazit-kosove-json/main/kosovo-prayer-times.min.json';
    const r=await fetch(url);
    if(r&&r.ok){
      const c=await caches.open(BIK_CACHE);
      await c.put(url,r.clone());
      const clients=await self.clients.matchAll({includeUncontrolled:true});
      clients.forEach(function(cl){cl.postMessage({type:'CACHE_UPDATED',source:'bik-sync'})});
    }
  }catch(e){}
}

self.addEventListener('notificationclick',function(event){
  event.notification.close();
  event.waitUntil((async function(){
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const data=event.notification.data||{};
    const target=data.prayer?'?tab=namazi':'';
    for(const c of all){
      if('focus' in c){
        c.postMessage({type:'PRAYER_FIRED',data:data});
        try{c.navigate('./index.html'+target)}catch(_){}
        return c.focus();
      }
    }
    if(self.clients.openWindow)return self.clients.openWindow('./index.html'+target);
  })());
});

self.addEventListener('message',function(event){const d=event.data||{};if(d.type==='SKIP_WAITING')self.skipWaiting()});
