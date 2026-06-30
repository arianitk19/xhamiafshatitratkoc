/* prayer-engine.js — BIK Kosovo primary + Aladhan/Diyanet fallback
 *
 * BIK source strategy:
 *  1. Fetch official JSON from drilonjaha/kohet-e-namazit-kosove-json on first load
 *     (cached forever — same data every year per BIK methodology).
 *  2. If GitHub unreachable: compute locally with BIK parameters
 *     (Fajr 18 deg, Isha 17 deg, Hanafi school, +6 min Temkin, Decan reference).
 *  3. Cached in IndexedDB after first successful fetch.
 *
 * Aladhan & Diyanet: live API queries via api.aladhan.com (method 3 / method 13).
 */
(function(global){
'use strict';

const LABELS={Fajr:'Sabahu',Sunrise:'Lindja',Dhuhr:'Dreka',Asr:'Ikindia',Maghrib:'Akshami',Isha:'Jacia'};
const ORDER=['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'];
const PRAYER_ORDER=['Fajr','Dhuhr','Asr','Maghrib','Isha']; // Sunrise is informational
const SOURCES={
  bik:{label:'BIK',primary:true,method:'github+local',timezone:'Europe/Belgrade'},
  aladhan:{label:'Aladhan',method:3,school:0,timezone:'Europe/Belgrade'},
  diyanet:{label:'Diyanet',method:13,school:0,timezone:'Europe/Belgrade'}
};
const BIK_JSON_URL='https://raw.githubusercontent.com/drilonjaha/kohet-e-namazit-kosove-json/main/kosovo-prayer-times.min.json';
const MONTH_EN=['January','February','March','April','May','June','July','August','September','October','November','December'];
const HIJRI_MONTHS_SQ=['Muharrem','Safer','Rebiul-Evvel','Rebiul-Ahir','Xhumadel-Ula','Xhumadel-Ahire','Rexheb','Shaban','Ramazan','Sheval','Dhul-Kade','Dhul-Hixhe'];

let currentSource='bik';
let bikDataCache=null;

function setSource(s){if(SOURCES[s])currentSource=s}
function getSource(){return currentSource}
function pad2(n){return String(n).padStart(2,'0')}
function ymd(d){return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())}
function parseTimeToDate(base,hhmm){
  if(!hhmm||typeof hhmm!=='string'){return null}
  const m=hhmm.match(/^(\d{1,2})[:.]?(\d{2})/);
  if(!m)return null;
  const dt=new Date(base);
  dt.setHours(parseInt(m[1],10),parseInt(m[2],10),0,0);
  return dt;
}
function formatTime(d){if(!d)return'--:--';return pad2(d.getHours())+':'+pad2(d.getMinutes())}
function formatCountdown(ms){
  if(!isFinite(ms)||ms<0)ms=0;
  const t=Math.floor(ms/1000),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60;
  if(h>0)return h+':'+pad2(m)+':'+pad2(s);
  return pad2(m)+':'+pad2(s);
}

/* ---------- Astronomical fallback (matches BIK methodology) ---------- */
function toRad(d){return d*Math.PI/180}
function toDeg(r){return r*180/Math.PI}
function normHr(h){return((h%24)+24)%24}
function julianDay(y,m,d){if(m<=2){y-=1;m+=12}const A=Math.floor(y/100),B=2-A+Math.floor(A/4);return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5}
function sunPosition(jd){
  const D=jd-2451545.0;
  const g=toRad((357.529+0.98560028*D)%360);
  const q=(280.459+0.98564736*D)%360;
  const L=toRad((q+1.915*Math.sin(g)+0.020*Math.sin(2*g))%360);
  const e=toRad(23.439-0.00000036*D);
  const RA=toDeg(Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L)))/15;
  const decl=toDeg(Math.asin(Math.sin(e)*Math.sin(L)));
  const EqT=q/15-normHr(RA);
  return{decl:decl,EqT:EqT};
}
function computeTime(jd,lat,lng,angle,dir,baseHrs){
  let t=baseHrs/24;
  for(let i=0;i<3;i++){
    const sp=sunPosition(jd+t);
    const cosH=(-Math.sin(toRad(angle))-Math.sin(toRad(lat))*Math.sin(toRad(sp.decl)))/(Math.cos(toRad(lat))*Math.cos(toRad(sp.decl)));
    if(cosH>1||cosH<-1)return null;
    const H=toDeg(Math.acos(cosH))/15;
    const noon=12-sp.EqT-lng/15;
    t=(dir==='before'?noon-H:noon+H)/24;
  }
  return normHr(t*24);
}
function asrHr(jd,lat,lng,factor){
  let t=13/24;
  for(let i=0;i<3;i++){
    const sp=sunPosition(jd+t);
    const A=factor+Math.tan(toRad(Math.abs(lat-sp.decl)));
    const ang=-toDeg(Math.atan(1/A));
    const cosH=(-Math.sin(toRad(ang))-Math.sin(toRad(lat))*Math.sin(toRad(sp.decl)))/(Math.cos(toRad(lat))*Math.cos(toRad(sp.decl)));
    if(cosH>1||cosH<-1)return null;
    const H=toDeg(Math.acos(cosH))/15;
    const noon=12-sp.EqT-lng/15;
    t=(noon+H)/24;
  }
  return normHr(t*24);
}
function hoursToHHMM(hrs,tz,addMin){
  if(hrs==null)return null;
  addMin=addMin||0;
  const h=normHr(hrs+tz)+addMin/60;
  let H=Math.floor(h),M=Math.round((h-H)*60);
  if(M===60){M=0;H=(H+1)%24}
  return pad2(H)+':'+pad2(M);
}
function computeLocalBIK(date,lat,lng,school){
  // Uses BIK parameters: 18 deg Fajr, 17 deg Isha, Hanafi (asr factor 2), +6 min Temkin
  const tz=-date.getTimezoneOffset()/60;
  const jd=julianDay(date.getFullYear(),date.getMonth()+1,date.getDate());
  const TEMKIN=6;
  const asrFactor=school===0?1:2;
  const fajrH=computeTime(jd,lat,lng,18,'before',5);
  const sunriseH=computeTime(jd,lat,lng,0.833,'before',6);
  const sp=sunPosition(jd+0.5);
  const dhuhrH=normHr(12-sp.EqT-lng/15);
  const asrH=asrHr(jd,lat,lng,asrFactor);
  const maghribH=computeTime(jd,lat,lng,0.833,'after',18);
  const ishaH=computeTime(jd,lat,lng,17,'after',19);
  return{
    Fajr:hoursToHHMM(fajrH,tz,TEMKIN),
    Sunrise:hoursToHHMM(sunriseH,tz),
    Dhuhr:hoursToHHMM(dhuhrH,tz,TEMKIN),
    Asr:hoursToHHMM(asrH,tz,TEMKIN),
    Maghrib:hoursToHHMM(maghribH,tz,TEMKIN),
    Isha:hoursToHHMM(ishaH,tz,TEMKIN)
  };
}

/* ---------- Hijri (Kuwaiti algorithm) ---------- */
function gregorianToHijri(date){
  const day=date.getDate(),month=date.getMonth()+1,year=date.getFullYear();
  let jd=Math.floor(julianDay(year,month,day)+0.5);
  const l=jd-1948440+10632;
  const n=Math.floor((l-1)/10631);
  const l2=l-10631*n+354;
  const j=Math.floor((10985-l2)/5316)*Math.floor((50*l2)/17719)+Math.floor(l2/5670)*Math.floor((43*l2)/15238);
  const l3=l2-Math.floor((30-j)/15)*Math.floor((17719*j)/50)-Math.floor(j/16)*Math.floor((15238*j)/43)+29;
  const mH=Math.floor((24*l3)/709);
  const dH=l3-Math.floor((709*mH)/24);
  const yH=30*n+j-30;
  return{day:dH,month:mH,year:yH};
}
function formatHijriSq(h){if(!h)return'';return h.day+' '+HIJRI_MONTHS_SQ[h.month-1]+' '+h.year+' h.'}

/* ---------- BIK: fetch from GitHub JSON ---------- */
async function loadBIKData(){
  if(bikDataCache)return bikDataCache;
  // Try cached in IndexedDB first
  const stored=await global.XR_Storage.getMeta('bikData');
  if(stored&&stored.prayer_times){bikDataCache=stored;return stored}
  if(!navigator.onLine)return null;
  try{
    const ctrl=new AbortController();
    const tm=setTimeout(function(){ctrl.abort()},10000);
    const res=await fetch(BIK_JSON_URL,{signal:ctrl.signal,cache:'force-cache'});
    clearTimeout(tm);
    if(!res.ok)return null;
    const data=await res.json();
    if(!data||!data.prayer_times)return null;
    bikDataCache=data;
    try{await global.XR_Storage.setMeta('bikData',data)}catch(e){}
    try{await global.XR_Storage.setPrefs({bikDataVersion:data.metadata&&data.metadata.year?data.metadata.year:'unknown'})}catch(e){}
    return data;
  }catch(e){return null}
}

function bikLookup(data,date){
  if(!data||!data.prayer_times)return null;
  const monthName=MONTH_EN[date.getMonth()];
  const arr=data.prayer_times[monthName];
  if(!arr)return null;
  const day=date.getDate();
  const entry=arr.find(function(d){return d.day===day});
  if(!entry)return null;
  return{
    Fajr:String(entry.fajr).replace('.',':'),
    Sunrise:String(entry.sunrise).replace('.',':'),
    Dhuhr:String(entry.dhuhr).replace('.',':'),
    Asr:String(entry.asr).replace('.',':'),
    Maghrib:String(entry.maghrib).replace('.',':'),
    Isha:String(entry.isha).replace('.',':')
  };
}

function applyCityOffset(times,offsetMin){
  if(!offsetMin||!times)return times;
  const out={};
  for(const k in times){
    const v=times[k];if(!v){out[k]=v;continue}
    const parts=v.split(':');
    if(parts.length<2){out[k]=v;continue}
    const total=parseInt(parts[0],10)*60+parseInt(parts[1],10)+offsetMin;
    const norm=((total%1440)+1440)%1440;
    out[k]=pad2(Math.floor(norm/60))+':'+pad2(norm%60);
  }
  return out;
}

/* Rregulli: Sabahu = Lindja e diellit - 40 minuta.
 * Lindja mbetet vlera reale (nga burimi); Sabahu llogaritet 40 min para saj.
 * Dinamike per cdo burim — nuk prek asnje kohe tjeter. */
const FAJR_BEFORE_SUNRISE=40;
function hhmmToMin(v){
  if(!v||typeof v!=='string')return null;
  const m=v.match(/^(\d{1,2})[:.](\d{2})/);
  if(!m)return null;
  return parseInt(m[1],10)*60+parseInt(m[2],10);
}
function minToHHMM(total){
  const norm=((total%1440)+1440)%1440;
  return pad2(Math.floor(norm/60))+':'+pad2(norm%60);
}
function enforceSunriseRule(times){
  if(!times)return times;
  // Sabahu = Lindja (e diellit) - 40 min. Lindja mbetet e pandryshuar.
  const sunrise=hhmmToMin(times.Sunrise);
  if(sunrise==null)return times;
  times.Fajr=minToHHMM(sunrise-FAJR_BEFORE_SUNRISE);
  return times;
}

/* ---------- Aladhan API ---------- */
function buildAladhanURL(date,lat,lng,m,sch,tz){
  const dd=pad2(date.getDate()),mm=pad2(date.getMonth()+1),yy=date.getFullYear();
  const u=new URL('https://api.aladhan.com/v1/timings/'+dd+'-'+mm+'-'+yy);
  u.searchParams.set('latitude',String(lat));
  u.searchParams.set('longitude',String(lng));
  u.searchParams.set('method',String(m));
  u.searchParams.set('school',String(sch));
  if(tz)u.searchParams.set('timezonestring',tz);
  u.searchParams.set('iso8601','false');
  return u.toString();
}
async function fetchFromAladhan(date,lat,lng,m,sch,tz){
  try{
    const ctrl=new AbortController();
    const tm=setTimeout(function(){ctrl.abort()},8000);
    const res=await fetch(buildAladhanURL(date,lat,lng,m,sch,tz),{signal:ctrl.signal,cache:'no-cache'});
    clearTimeout(tm);
    if(!res.ok)return null;
    const j=await res.json();
    if(!j||!j.data||!j.data.timings)return null;
    const t=j.data.timings;
    const strip=function(s){return typeof s==='string'?s.split(' ')[0]:s};
    return{Fajr:strip(t.Fajr),Sunrise:strip(t.Sunrise),Dhuhr:strip(t.Dhuhr),Asr:strip(t.Asr),Maghrib:strip(t.Maghrib),Isha:strip(t.Isha)};
  }catch(e){return null}
}

/* ---------- Main API ---------- */
async function getForDate(date){
  const prefs=await global.XR_Storage.getPrefs();
  const source=currentSource||prefs.prayerSource||'bik';
  const id=ymd(date)+':'+source;
  const cfg=SOURCES[source];
  let times=null;
  let networkUsed=false;
  let verified=false;

  if(source==='bik'){
    const data=await loadBIKData();
    if(data){
      times=bikLookup(data,date);
      if(times){
        verified=true;
        times=applyCityOffset(times,prefs.location.cityOffset||0);
      }
    }
    if(!times){
      times=computeLocalBIK(date,prefs.location.lat,prefs.location.lng,1);
      times=applyCityOffset(times,prefs.location.cityOffset||0);
    }
  }else{
    if(navigator.onLine){
      times=await fetchFromAladhan(date,prefs.location.lat,prefs.location.lng,cfg.method,cfg.school,prefs.location.tz||cfg.timezone);
      if(times)networkUsed=true;
    }
    if(!times){
      const c=await global.XR_Storage.getPrayerDay(id);
      if(c&&c.times)times=c.times;
    }
    if(!times)times=computeLocalBIK(date,prefs.location.lat,prefs.location.lng,cfg.school);
  }

  // Rregulli i fiksuar: Lindja = Sabahu + 40 min (dinamike, per cdo burim).
  times=enforceSunriseRule(times);

  const hijri=gregorianToHijri(date);
  const rec={
    id:id,date:ymd(date),source:source,
    times:times,
    hijri:hijri,hijriSq:formatHijriSq(hijri),
    location:prefs.location,
    verified:verified,
    computed:!networkUsed&&!verified
  };
  if(networkUsed||verified){
    // Fire-and-forget: mos e blloko kthimin nese IndexedDB ngec (p.sh. ne file://).
    try{global.XR_Storage.savePrayerDay(rec).catch(function(){})}catch(e){}
    try{global.XR_Storage.setPrefs({lastSync:Date.now()}).catch(function(){})}catch(e){}
  }
  return rec;
}

async function getToday(){return getForDate(new Date())}

function currentAndNext(rec,now){
  if(!rec)return{current:null,next:null};
  now=now||new Date();
  const t0=new Date(now);t0.setHours(0,0,0,0);
  const entries=PRAYER_ORDER.map(function(k){return{key:k,label:LABELS[k],date:parseTimeToDate(t0,rec.times[k])}}).filter(function(e){return e.date});
  let cur=null,nxt=null;
  for(let i=0;i<entries.length;i++){
    if(now<entries[i].date){nxt=entries[i];cur=i>0?entries[i-1]:Object.assign({},entries[entries.length-1],{previousDay:true});break}
  }
  if(!nxt){cur=entries[entries.length-1];nxt={key:'Fajr',label:LABELS.Fajr,date:null,tomorrow:true}}
  return{current:cur,next:nxt};
}

async function nextPrayer(now){
  const today=await getToday();
  const cn=currentAndNext(today,now);
  if(cn.next&&cn.next.tomorrow){
    const t=new Date();t.setDate(t.getDate()+1);
    const tom=await getForDate(t);
    const t0=new Date(t);t0.setHours(0,0,0,0);
    cn.next={key:'Fajr',label:LABELS.Fajr,date:parseTimeToDate(t0,tom.times.Fajr),tomorrow:true};
  }
  return cn.next;
}
async function currentPrayer(now){const t=await getToday();return currentAndNext(t,now).current}

async function preloadBIKData(){return loadBIKData()}

global.XR_Prayer={PRAYER_LABELS:LABELS,SOURCES:SOURCES,ORDER:ORDER,PRAYER_ORDER:PRAYER_ORDER,setSource:setSource,getSource:getSource,getForDate:getForDate,getToday:getToday,nextPrayer:nextPrayer,currentPrayer:currentPrayer,currentAndNext:currentAndNext,formatTime:formatTime,formatCountdown:formatCountdown,parseTimeToDate:parseTimeToDate,gregorianToHijri:gregorianToHijri,formatHijriSq:formatHijriSq,ymd:ymd,preloadBIKData:preloadBIKData,BIK_JSON_URL:BIK_JSON_URL};
})(window);
