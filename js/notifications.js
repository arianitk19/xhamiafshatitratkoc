/* notifications.js — Prayer notifications + tone-only Adhan */
(function(global){
'use strict';
const _rt={timers:new Map(),ctx:null,initialized:false};

function getPermission(){if(!('Notification' in global))return'unsupported';return Notification.permission}
async function requestPermission(){
  if(!('Notification' in global))return'unsupported';
  if(Notification.permission==='granted')return'granted';
  if(Notification.permission==='denied')return'denied';
  try{return await Notification.requestPermission()}catch(e){return'denied'}
}
function vibrate(p){try{if(navigator.vibrate)navigator.vibrate(p)}catch(e){}}

/* Tone-only Adhan: dignified Web Audio sequence */
function playAdhan(){
  try{
    const C=global.AudioContext||global.webkitAudioContext;
    if(!C)return false;
    const ctx=_rt.ctx||new C();
    _rt.ctx=ctx;
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;
    // Three-phase tone pattern — calm and prayerful
    const notes=[
      {f:392.00,t:0.0,d:1.2},
      {f:523.25,t:1.3,d:1.0},
      {f:587.33,t:2.4,d:1.0},
      {f:523.25,t:3.5,d:1.0},
      {f:392.00,t:4.6,d:1.8}
    ];
    const master=ctx.createGain();
    master.gain.value=0.0001;
    master.connect(ctx.destination);
    master.gain.exponentialRampToValueAtTime(0.22,now+0.05);
    master.gain.exponentialRampToValueAtTime(0.0001,now+7);
    notes.forEach(function(n){
      const osc=ctx.createOscillator();
      const g=ctx.createGain();
      osc.type='sine';
      osc.frequency.value=n.f;
      g.gain.value=0.0001;
      g.gain.exponentialRampToValueAtTime(0.5,now+n.t+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001,now+n.t+n.d);
      osc.connect(g).connect(master);
      osc.start(now+n.t);
      osc.stop(now+n.t+n.d+0.05);
    });
    return true;
  }catch(e){return false}
}
function stopAdhan(){try{if(_rt.ctx){_rt.ctx.close();_rt.ctx=null}}catch(e){}}

async function _showNotification(title,body,tag,data){
  const p={body:body,icon:'assets/icons/icon.svg',badge:'assets/icons/icon.svg',tag:tag,data:data,vibrate:[100,50,100],requireInteraction:false,lang:'sq'};
  if('serviceWorker' in navigator && navigator.serviceWorker.controller){
    try{const reg=await navigator.serviceWorker.ready;await reg.showNotification(title,p);return true}catch(e){}
  }
  try{
    if('Notification' in global && Notification.permission==='granted'){
      const n=new Notification(title,p);
      n.onclick=function(){try{global.focus();n.close()}catch(e){}};
      return true;
    }
  }catch(e){}
  return false;
}

function _id(d,p,k){return d+':'+p+':'+k}
function _offset(k){if(k==='pre10')return-10*60000;if(k==='pre5')return-5*60000;return 0}
function _msg(p,k){
  const L=(global.XR_Prayer&&global.XR_Prayer.PRAYER_LABELS[p])||p;
  if(k==='pre10')return{title:L+' - afrohet',body:'Koha e '+L.toLowerCase()+' hyn pas 10 minutash.'};
  if(k==='pre5')return{title:L+' - afrohet',body:'Edhe 5 minuta deri ne kohen e '+L.toLowerCase()+'.'};
  return{title:'Hyri koha e '+L.toLowerCase(),body:'Allahu Ekber! Eja per namaz.'};
}

async function _clearTimers(){for(const id of _rt.timers.keys())clearTimeout(_rt.timers.get(id));_rt.timers.clear()}
async function _scheduleOne(rec,prefs){
  const delay=rec.fireAt-Date.now();
  if(delay<0||delay>86460000)return;
  const tid=setTimeout(async function(){
    try{
      const m=_msg(rec.prayer,rec.kind);
      await _showNotification(m.title,m.body,rec.id,{prayer:rec.prayer,kind:rec.kind});
      vibrate(rec.kind==='onTime'?[180,80,180,80,180]:[120,60,120]);
      if(rec.kind==='onTime'&&prefs.adhanEnabled)playAdhan();
      await global.XR_Storage.markNotificationFired(rec.id);
      document.dispatchEvent(new CustomEvent('prayer:fired',{detail:{rec:rec}}));
    }catch(e){}
  },delay);
  _rt.timers.set(rec.id,tid);
}

async function scheduleForDay(date){
  const prefs=await global.XR_Storage.getPrefs();
  if(!global.XR_Prayer)return;
  const today=await global.XR_Prayer.getForDate(date);
  const dayKey=global.XR_Prayer.ymd(date);
  const order=['Fajr','Dhuhr','Asr','Maghrib','Isha'];
  const d0=new Date(date);d0.setHours(0,0,0,0);
  for(const p of order){
    const dt=global.XR_Prayer.parseTimeToDate(d0,today.times[p]);
    if(!dt)continue;
    for(const k of ['pre10','pre5','onTime']){
      const fireAt=dt.getTime()+_offset(k);
      if(fireAt<Date.now()-60000)continue;
      const id=_id(dayKey,p,k);
      const exist=(await global.XR_Storage.getPendingNotifications()).find(function(n){return n.id===id});
      const rec=exist||{id:id,prayer:p,kind:k,fireAt:fireAt,fired:false,source:today.source};
      rec.fireAt=fireAt;rec.fired=false;
      await global.XR_Storage.saveNotification(rec);
      if(prefs.notificationsEnabled)await _scheduleOne(rec,prefs);
    }
  }
}

async function rebuildSchedule(){
  await _clearTimers();
  await global.XR_Storage.purgeFiredNotifications();
  await scheduleForDay(new Date());
  const tom=new Date();tom.setDate(tom.getDate()+1);
  await scheduleForDay(tom);
  const pend=await global.XR_Storage.getPendingNotifications();
  const prefs=await global.XR_Storage.getPrefs();
  if(prefs.notificationsEnabled){for(const r of pend){if(!_rt.timers.has(r.id))await _scheduleOne(r,prefs)}}
}

async function disableAll(){await _clearTimers();await global.XR_Storage.clearAllNotifications()}
async function enable(){
  const p=await requestPermission();
  if(p!=='granted')return p;
  await global.XR_Storage.setPrefs({notificationsEnabled:true});
  await rebuildSchedule();
  try{if('serviceWorker' in navigator && 'SyncManager' in window){const r=await navigator.serviceWorker.ready;if(r.sync)await r.sync.register('xr-prayer-refresh')}}catch(e){}
  return'granted';
}
async function disable(){await global.XR_Storage.setPrefs({notificationsEnabled:false});await _clearTimers()}
async function testNotification(){const ok=await _showNotification('Xhamia Ratkoc','Njoftim prove - sistemi funksionon.','test',{});vibrate([60,40,60]);return ok}

async function init(){
  if(_rt.initialized)return;
  _rt.initialized=true;
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')rebuildSchedule()});
  document.addEventListener('prefs:changed',function(){rebuildSchedule()});
  document.addEventListener('prayer:source-changed',function(){rebuildSchedule()});
  global.addEventListener('online',function(){rebuildSchedule()});
  await rebuildSchedule();
}

global.XR_Notifications={getPermission:getPermission,requestPermission:requestPermission,enable:enable,disable:disable,rebuildSchedule:rebuildSchedule,disableAll:disableAll,testNotification:testNotification,playAdhan:playAdhan,stopAdhan:stopAdhan,vibrate:vibrate,init:init};
})(window);
