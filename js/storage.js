/* storage.js — IndexedDB layer (with localStorage fallback) */
(function(global){
'use strict';
const DB='xhamia-ratkoc-db',V=3;
const SP='preferences',SR='prayerCache',SN='notifications',SM='meta',SQ='quranCache';
const DEFAULTS=Object.freeze({
  notificationsEnabled:false,adhanEnabled:false,hapticEnabled:true,
  prayerSource:'bik',theme:'dark',
  location:{name:'Ratkoc, Rahovec, Kosove',lat:42.40,lng:20.65,tz:'Europe/Belgrade',cityOffset:0},
  lastSync:null,installDismissed:false,bikDataVersion:null,
  // Kurani
  quran:{
    translation:'ahmeti',reciter:'alafasy',fontScale:1,focusMode:false,
    showArabic:true,playbackRate:1,
    bookmarks:[],favorites:[],recent:[],
    progress:{},        // {surahNumber: maxAyahRead}
    lastRead:null,      // {surah, ayah, scroll}
    stats:{opens:0,totalMs:0,perSurah:{},streak:0,lastReadDay:null}
  }
});
let dbP=null;const mem={prefs:null};
function openDB(){
  if(dbP)return dbP;
  if(!('indexedDB' in global))return Promise.resolve(null);
  dbP=new Promise(function(res){
    let r;try{r=indexedDB.open(DB,V)}catch(e){res(null);return}
    r.onupgradeneeded=function(ev){
      const db=ev.target.result;
      if(!db.objectStoreNames.contains(SP))db.createObjectStore(SP,{keyPath:'key'});
      if(!db.objectStoreNames.contains(SR))db.createObjectStore(SR,{keyPath:'id'});
      if(!db.objectStoreNames.contains(SN))db.createObjectStore(SN,{keyPath:'id'});
      if(!db.objectStoreNames.contains(SM))db.createObjectStore(SM,{keyPath:'key'});
      if(!db.objectStoreNames.contains(SQ))db.createObjectStore(SQ,{keyPath:'id'});
    };
    r.onsuccess=function(){res(r.result)};
    r.onerror=function(){res(null)};
    r.onblocked=function(){res(null)};
  });
  return dbP;
}
function tx(s,m){return openDB().then(function(d){if(!d)return null;try{return d.transaction(s,m).objectStore(s)}catch(e){return null}})}
const lsK=function(s,k){return'xr.'+s+'.'+k};
const lsG=function(s,k){try{const r=localStorage.getItem(lsK(s,k));return r?JSON.parse(r):null}catch(e){return null}};
const lsS=function(s,k,v){try{localStorage.setItem(lsK(s,k),JSON.stringify(v))}catch(e){}};
const lsD=function(s,k){try{localStorage.removeItem(lsK(s,k))}catch(e){}};

async function put(s,v){
  const t=await tx(s,'readwrite');
  if(!t){lsS(s,v.key||v.id,v);return v}
  return new Promise(function(res){const r=t.put(v);r.onsuccess=function(){res(v)};r.onerror=function(){lsS(s,v.key||v.id,v);res(v)}});
}
async function get(s,k){
  const t=await tx(s,'readonly');
  if(!t)return lsG(s,k);
  return new Promise(function(res){const r=t.get(k);r.onsuccess=function(){res(r.result||null)};r.onerror=function(){res(lsG(s,k))}});
}
async function getAll(s){
  const t=await tx(s,'readonly');
  if(!t)return[];
  return new Promise(function(res){const r=t.getAll();r.onsuccess=function(){res(r.result||[])};r.onerror=function(){res([])}});
}
async function del(s,k){
  const t=await tx(s,'readwrite');
  if(!t){lsD(s,k);return}
  return new Promise(function(res){const r=t.delete(k);r.onsuccess=function(){res()};r.onerror=function(){lsD(s,k);res()}});
}
async function clr(s){
  const t=await tx(s,'readwrite');
  if(!t)return;
  return new Promise(function(res){const r=t.clear();r.onsuccess=function(){res()};r.onerror=function(){res()}});
}

async function getPrefs(){
  if(mem.prefs)return Object.assign({},DEFAULTS,mem.prefs);
  const rec=await get(SP,'main');
  const p=rec&&rec.value?Object.assign({},DEFAULTS,rec.value):Object.assign({},DEFAULTS);
  // Deep-merge nested objects so new default fields survive upgrades.
  p.quran=Object.assign({},DEFAULTS.quran,(rec&&rec.value&&rec.value.quran)||{});
  p.quran.stats=Object.assign({},DEFAULTS.quran.stats,p.quran.stats||{});
  p.location=Object.assign({},DEFAULTS.location,(rec&&rec.value&&rec.value.location)||{});
  mem.prefs=p;return p;
}
async function setPrefs(partial){
  const cur=await getPrefs();
  const nxt=Object.assign({},cur,partial);
  if(partial.location)nxt.location=Object.assign({},cur.location,partial.location);
  if(partial.quran)nxt.quran=Object.assign({},cur.quran,partial.quran);
  mem.prefs=nxt;
  await put(SP,{key:'main',value:nxt});
  document.dispatchEvent(new CustomEvent('prefs:changed',{detail:nxt}));
  return nxt;
}
async function resetPrefs(){mem.prefs=Object.assign({},DEFAULTS);await put(SP,{key:'main',value:Object.assign({},DEFAULTS)});return Object.assign({},DEFAULTS)}

async function savePrayerDay(r){if(!r||!r.id)return;return put(SR,Object.assign({},r,{savedAt:Date.now()}))}
async function getPrayerDay(id){return get(SR,id)}
async function getAllPrayers(){return getAll(SR)}
async function purgeOldPrayers(days){days=days||14;const a=await getAllPrayers();const cut=Date.now()-days*86400000;for(const r of a){if(!r.savedAt||r.savedAt<cut)await del(SR,r.id)}}

async function saveNotification(r){if(!r||!r.id)return;return put(SN,r)}
async function getPendingNotifications(){const a=await getAll(SN);const n=Date.now();return a.filter(function(x){return !x.fired && x.fireAt>n}).sort(function(a,b){return a.fireAt-b.fireAt})}
async function markNotificationFired(id){const r=await get(SN,id);if(r){r.fired=true;r.firedAt=Date.now();await put(SN,r)}}
async function clearAllNotifications(){return clr(SN)}
async function purgeFiredNotifications(){const a=await getAll(SN);for(const n of a){if(n.fired&&n.firedAt&&(Date.now()-n.firedAt>86400000))await del(SN,n.id)}}

async function setMeta(k,v){return put(SM,{key:k,value:v,ts:Date.now()})}
async function getMeta(k){const r=await get(SM,k);return r?r.value:null}

/* ---- Kurani: cache i sureve ---- */
async function saveQuranSurah(r){if(!r||!r.id)return;return put(SQ,Object.assign({},r,{savedAt:Date.now()}))}
async function getQuranSurah(id){return get(SQ,id)}
async function getAllQuranSurahs(){return getAll(SQ)}
async function deleteQuranSurah(id){return del(SQ,id)}
async function clearQuranCache(){return clr(SQ)}

async function clearAll(){await clr(SP);await clr(SR);await clr(SN);await clr(SM);await clr(SQ);mem.prefs=null;try{Object.keys(localStorage).filter(function(k){return k.indexOf('xr.')===0}).forEach(function(k){localStorage.removeItem(k)})}catch(e){}}

global.XR_Storage={DEFAULTS:DEFAULTS,getPrefs:getPrefs,setPrefs:setPrefs,resetPrefs:resetPrefs,savePrayerDay:savePrayerDay,getPrayerDay:getPrayerDay,getAllPrayers:getAllPrayers,purgeOldPrayers:purgeOldPrayers,saveNotification:saveNotification,getPendingNotifications:getPendingNotifications,markNotificationFired:markNotificationFired,clearAllNotifications:clearAllNotifications,purgeFiredNotifications:purgeFiredNotifications,setMeta:setMeta,getMeta:getMeta,saveQuranSurah:saveQuranSurah,getQuranSurah:getQuranSurah,getAllQuranSurahs:getAllQuranSurahs,deleteQuranSurah:deleteQuranSurah,clearQuranCache:clearQuranCache,clearAll:clearAll};
})(window);
