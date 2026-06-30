/* ui-controller.js — Xhamia Ratkoc UI */
(function(global){
'use strict';
const $=function(s,r){return(r||document).querySelector(s)};
const $$=function(s,r){return Array.from((r||document).querySelectorAll(s))};

const state={
  activeTab:'xhamia',prefs:null,today:null,
  nextPrayerDate:null,nextPrayerKey:null,
  currentPrayerKey:null,currentPrayerDate:null,
  timers:{clock:null,refresh:null},
  deferredInstallPrompt:null,
  gallery:{images:[],currentIndex:0,touchStartX:0,touchEndX:0}
};

/* ====== GALLERY: edit this array to add your real photos.
 * Each entry can be:
 *   { src: 'https://...', title: '...' }  -- external URL
 *   { src: 'assets/gallery/foto-1.jpg', title: '...' }  -- local file
 *   { src: '', title: '...' }  -- placeholder (shows nice gradient placeholder)
 */
const GALLERY_ITEMS = [
  { src:'assets/gallery/xhamiaa1.jpg', title:'Pamja jashtme' },
  { src:'assets/gallery/xhamiajasht2.jpg', title:'Pamje e Jashtme' },
  { src:'assets/gallery/xhamiabrenda1.jpg', title:'Brenda' },
  { src:'assets/gallery/xhamiabrenda5.jpg', title:'Brenda' },
  { src:'assets/gallery/xhamiabrenda3.jpg', title:'Brenda' },
  { src:'assets/gallery/xhamiajasht1.jpg', title:'Minarja' }
];

function tinyHaptic(){if(!state.prefs||state.prefs.hapticEnabled===false)return;try{if(navigator.vibrate)navigator.vibrate(8)}catch(e){}}
function pulseHaptic(){if(!state.prefs||state.prefs.hapticEnabled===false)return;try{if(navigator.vibrate)navigator.vibrate([14,20,14])}catch(e){}}

function toast(msg,kind,dur){
  kind=kind||'info';dur=dur||2600;
  const host=$('#toastHost');if(!host)return;
  const el=document.createElement('div');
  el.className='toast '+kind;
  const ic=kind==='success'?'✓':kind==='error'?'!':'·';
  el.innerHTML='<span style="opacity:.7">'+ic+'</span><span>'+esc(msg)+'</span>';
  host.appendChild(el);
  setTimeout(function(){el.style.transition='opacity .3s ease,transform .3s ease';el.style.opacity='0';el.style.transform='translateY(10px)';setTimeout(function(){el.remove()},350)},dur);
}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}

function setTab(tab,opts){
  opts=opts||{};
  if(!tab)return;
  if(state.activeTab===tab&&!opts.force)return;
  if(state.activeTab==='kurani'&&tab!=='kurani'&&global.XR_QuranUI&&global.XR_QuranUI.onLeave)global.XR_QuranUI.onLeave();
  state.activeTab=tab;
  $$('#bottomNav .nav-btn').forEach(function(b){const on=b.getAttribute('data-tab')===tab;b.classList.toggle('is-active',on);b.setAttribute('aria-selected',on?'true':'false')});
  $$('.tab-panel').forEach(function(p){p.style.display=p.getAttribute('data-tab')===tab?'':'none'});
  const panel=$('#tab-'+tab);
  if(panel){panel.style.animation='none';void panel.offsetWidth;panel.style.animation=''}
  tinyHaptic();
  try{const u=new URL(global.location.href);u.searchParams.set('tab',tab);history.replaceState(null,'',u.toString())}catch(e){}
  if(tab==='galeria')ensureGalleryRendered();
  if(tab==='namazi')refreshPrayerView();
  if(tab==='xhamia')refreshHomeView();
  if(tab==='kurani'&&global.XR_QuranUI)global.XR_QuranUI.onEnter();
}
function wireNav(){
  $$('#bottomNav .nav-btn').forEach(function(btn){btn.addEventListener('click',function(){setTab(btn.getAttribute('data-tab'))})});
  $$('[data-goto]').forEach(function(btn){btn.addEventListener('click',function(){setTab(btn.getAttribute('data-goto'))})});
}

const WD=['e Diel','e Hene','e Marte','e Merkure','e Enjte','e Premte','e Shtune'];
const MO=['Janar','Shkurt','Mars','Prill','Maj','Qershor','Korrik','Gusht','Shtator','Tetor','Nentor','Dhjetor'];
function pad(n){return String(n).padStart(2,'0')}

function renderClock(){
  const now=new Date();
  const c=$('#clock');if(c)c.textContent=pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
  const dg=$('#dateGregorian');if(dg)dg.textContent=WD[now.getDay()]+' · '+now.getDate()+' '+MO[now.getMonth()]+' '+now.getFullYear();
  if(state.today&&state.today.hijriSq){
    const dh=$('#dateHijri');if(dh)dh.textContent=state.today.hijriSq;
    const ph=$('#prayerHijriLabel');if(ph)ph.textContent=state.today.hijriSq;
  }
  const pd=$('#prayerDateLabel');if(pd)pd.textContent=WD[now.getDay()]+' · '+now.getDate()+' '+MO[now.getMonth()]+' '+now.getFullYear();
  updateCountdowns(now);
}
function updateCountdowns(now){
  if(!state.nextPrayerDate)return;
  const rem=state.nextPrayerDate.getTime()-now.getTime();
  const fmt=global.XR_Prayer.formatCountdown(rem);
  const c1=$('#nextPrayerCountdown');if(c1)c1.textContent='Mbetet '+fmt;
  const c2=$('#currentPrayerCountdown');if(c2)c2.textContent=fmt;
  if(state.currentPrayerDate&&state.nextPrayerDate&&state.currentPrayerDate<state.nextPrayerDate){
    const tot=state.nextPrayerDate-state.currentPrayerDate;
    const dn=Math.max(0,Math.min(tot,now-state.currentPrayerDate));
    const pct=Math.round((dn/tot)*100);
    const bar=$('#nextPrayerProgress');if(bar)bar.style.width=pct+'%';
  }
  if(rem<=0)scheduleSoon(800);
}

const PI={
  Fajr:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.5 5.5 4 4M20 20l-1.5-1.5M5.5 18.5 4 20M20 4l-1.5 1.5"/></svg>',
  Sunrise:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 18h18"/><path d="M5 14a7 7 0 0114 0"/><path d="M12 4v3M5 7l2 2M19 7l-2 2"/></svg>',
  Dhuhr:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2"/></svg>',
  Asr:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M3 17h2M19 17h2"/></svg>',
  Maghrib:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 18h18"/><path d="M5 14a7 7 0 0114 0"/><path d="M12 4v3"/></svg>',
  Isha:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'
};

function renderQuickPrayerList(){
  const host=$('#quickPrayerList');if(!host||!state.today)return;
  const L=global.XR_Prayer.PRAYER_LABELS;
  host.innerHTML=global.XR_Prayer.ORDER.map(function(k){
    const t=state.today.times[k]||'--:--';
    const cur=state.currentPrayerKey===k;
    return '<div class="quick-prayer-item '+(cur?'is-current':'')+'"><div class="qp-name"><span style="color:#BFA46F">'+(PI[k]||'')+'</span>'+L[k]+'</div><div class="qp-time">'+t+'</div></div>';
  }).join('');
}
function renderFullPrayerList(){
  const host=$('#prayerList');if(!host||!state.today)return;
  const L=global.XR_Prayer.PRAYER_LABELS;
  host.innerHTML=global.XR_Prayer.ORDER.map(function(k){
    const t=state.today.times[k]||'--:--';
    const cur=state.currentPrayerKey===k;
    const nx=state.nextPrayerKey===k;
    const tag=cur?'is-current':(nx?'is-next':'');
    return '<div class="prayer-row '+tag+'"><div class="p-name"><div class="p-icon">'+(PI[k]||'')+'</div>'+L[k]+'</div><div class="p-time">'+t+'</div></div>';
  }).join('');
}
function updateNextPrayerHero(){
  if(!state.today)return;
  const nm=$('#nextPrayerName');const nt=$('#nextPrayerTime');
  if(state.nextPrayerKey&&nm)nm.textContent=global.XR_Prayer.PRAYER_LABELS[state.nextPrayerKey];
  if(state.nextPrayerKey&&nt&&state.nextPrayerDate)nt.textContent=pad(state.nextPrayerDate.getHours())+':'+pad(state.nextPrayerDate.getMinutes());
  const cn=$('#currentPrayerName');
  if(cn)cn.textContent=state.currentPrayerKey?global.XR_Prayer.PRAYER_LABELS[state.currentPrayerKey]:'—';
}

async function refreshPrayerData(){
  try{
    global.XR_Prayer.setSource(state.prefs.prayerSource);
    const today=await global.XR_Prayer.getToday();
    state.today=today;
    const now=new Date();
    const cn=global.XR_Prayer.currentAndNext(today,now);
    state.currentPrayerKey=cn.current?cn.current.key:null;
    state.currentPrayerDate=cn.current&&cn.current.date?cn.current.date:null;
    state.nextPrayerKey=cn.next?cn.next.key:null;
    state.nextPrayerDate=cn.next&&cn.next.date?cn.next.date:null;
    if(cn.next&&cn.next.tomorrow){
      const np=await global.XR_Prayer.nextPrayer(now);
      if(np&&np.date){state.nextPrayerKey=np.key;state.nextPrayerDate=np.date}
    }
    const ls=$('#lastSyncLabel');
    if(ls){
      if(today.verified)ls.textContent='Burimi: BIK zyrtar (GitHub)';
      else if(state.prefs.lastSync){const d=new Date(state.prefs.lastSync);ls.textContent='Sinkronizimi: '+pad(d.getHours())+':'+pad(d.getMinutes())+' · '+MO[d.getMonth()]+' '+d.getDate()}
      else ls.textContent=today.computed?'Llogaritje lokale (BIK parametra)':'Sinkronizimi: tani';
    }
    const badge=$('#prayerSourceBadge');
    if(badge){
      badge.textContent=(global.XR_Prayer.SOURCES[state.prefs.prayerSource]||{}).label||'BIK';
      if(today.verified)badge.classList.add('is-verified');else badge.classList.remove('is-verified');
    }
  }catch(e){console.warn('refreshPrayerData',e)}
}
function refreshHomeView(){renderQuickPrayerList();updateNextPrayerHero()}
function refreshPrayerView(){renderFullPrayerList();updateNextPrayerHero()}

let _soon=null;
function scheduleSoon(d){clearTimeout(_soon);_soon=setTimeout(async function(){await refreshPrayerData();refreshHomeView();refreshPrayerView()},d||1500)}

function renderSettings(){
  if(!state.prefs)return;
  const sc=function(id,v){const e=$(id);if(e)e.checked=!!v};
  sc('#setNotifEnabled',state.prefs.notificationsEnabled);
  sc('#setAdhanEnabled',state.prefs.adhanEnabled);
  sc('#setHapticEnabled',state.prefs.hapticEnabled);
  $$('button.src-btn').forEach(function(b){b.classList.toggle('is-active',b.getAttribute('data-source')===state.prefs.prayerSource)});
  $$('button.theme-btn').forEach(function(b){b.classList.toggle('is-active',b.getAttribute('data-theme')===state.prefs.theme)});
  applyTheme(state.prefs.theme);
  const onl=navigator.onLine;
  const dot=$('#onlineDot');if(dot){dot.classList.toggle('online',onl);dot.classList.toggle('offline',!onl)}
  const oi=$('#offlineIndicator');
  if(oi){oi.textContent=onl?'Online':'Offline';oi.style.background=onl?'rgba(52,211,153,.12)':'rgba(245,158,11,.12)';oi.style.color=onl?'#86efac':'#fbbf24';oi.style.borderColor=onl?'rgba(52,211,153,.3)':'rgba(245,158,11,.3)'}
  const ol=$('#offlineLabel');if(ol)ol.textContent=onl?'Statusi: i lidhur':'Statusi: pa internet (cache)';
}
function applyTheme(t){
  const h=document.documentElement;
  h.classList.remove('theme-dark','theme-soft','theme-light');
  h.classList.add('theme-'+t);
  const m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content',t==='light'?'#F4EEDD':(t==='soft'?'#0F1530':'#0B1020'));
}

function wireSettings(){
  const n=$('#setNotifEnabled');
  if(n)n.addEventListener('change',async function(ev){
    if(ev.target.checked){
      const r=await global.XR_Notifications.enable();
      if(r!=='granted'){ev.target.checked=false;toast(r==='denied'?'Lejet u refuzuan.':'Njoftimet nuk mbeshteten.','error')}
      else toast('Njoftimet u aktivizuan.','success');
    }else{await global.XR_Notifications.disable();toast('Njoftimet u caktivizuan.','info')}
    state.prefs=await global.XR_Storage.getPrefs();renderSettings();
  });
  const a=$('#setAdhanEnabled');
  if(a)a.addEventListener('change',async function(ev){
    await global.XR_Storage.setPrefs({adhanEnabled:ev.target.checked});
    state.prefs=await global.XR_Storage.getPrefs();
    toast(ev.target.checked?'Ezani u aktivizua.':'Ezani u caktivizua.','info');
    if(ev.target.checked){try{global.XR_Notifications.playAdhan();setTimeout(function(){global.XR_Notifications.stopAdhan()},800)}catch(e){}}
  });
  const h=$('#setHapticEnabled');
  if(h)h.addEventListener('change',async function(ev){
    await global.XR_Storage.setPrefs({hapticEnabled:ev.target.checked});
    state.prefs=await global.XR_Storage.getPrefs();
    if(ev.target.checked)pulseHaptic();
  });
  $$('button.src-btn').forEach(function(btn){
    btn.addEventListener('click',async function(){
      const src=btn.getAttribute('data-source');
      await global.XR_Storage.setPrefs({prayerSource:src});
      state.prefs=await global.XR_Storage.getPrefs();
      global.XR_Prayer.setSource(src);
      document.dispatchEvent(new CustomEvent('prayer:source-changed'));
      renderSettings();
      await refreshPrayerData();refreshHomeView();refreshPrayerView();
      toast('Burimi: '+((global.XR_Prayer.SOURCES[src]||{}).label||src),'success');
    });
  });
  $$('button.theme-btn').forEach(function(btn){
    btn.addEventListener('click',async function(){
      await global.XR_Storage.setPrefs({theme:btn.getAttribute('data-theme')});
      state.prefs=await global.XR_Storage.getPrefs();renderSettings();
    });
  });
  const rf=$('#btnRefreshPrayer');
  if(rf)rf.addEventListener('click',async function(){
    tinyHaptic();toast('Po rifreskoj...','info',1500);
    await refreshPrayerData();refreshHomeView();refreshPrayerView();renderSettings();
    toast('U rifreskuan.','success');
  });
  const tn=$('#btnTestNotif');
  if(tn)tn.addEventListener('click',async function(){
    tinyHaptic();
    const ok=await global.XR_Notifications.testNotification();
    if(!ok){
      if(global.XR_Notifications.getPermission()!=='granted'){
        const r=await global.XR_Notifications.requestPermission();
        if(r==='granted'){await global.XR_Notifications.testNotification();toast('Njoftim prove u dergua.','success')}
        else toast('Lejet u refuzuan.','error');
      }else toast('Njoftimi nuk u shfaq.','error');
    }else toast('Njoftim prove u dergua.','success');
  });
  const cc=$('#btnClearCache');
  if(cc)cc.addEventListener('click',async function(){
    if(!confirm('Pastro te dhenat e ruajtura?'))return;
    tinyHaptic();await global.XR_Storage.clearAll();
    if('caches' in window){try{const ks=await caches.keys();for(const k of ks)await caches.delete(k)}catch(e){}}
    toast('U pastrua. Po ringarkoj...','success',1200);
    setTimeout(function(){location.reload()},1200);
  });
  const qn=$('#btnNotifQuick');
  if(qn)qn.addEventListener('click',function(){setTab('cilesimet')});
}

/* ====== GALLERY ====== */
let _galRendered=false;
function ensureGalleryRendered(){
  if(_galRendered)return;_galRendered=true;
  state.gallery.images=GALLERY_ITEMS;
  const grid=$('#galleryGrid');const cnt=$('#galleryCount');
  if(cnt)cnt.textContent=GALLERY_ITEMS.length+' fotografi';
  if(!grid)return;
  grid.innerHTML=GALLERY_ITEMS.map(function(it,i){
    const hasSrc=!!it.src;
    return '<button class="gallery-item" data-index="'+i+'" aria-label="'+esc(it.title)+'">'+
      (hasSrc?'<img loading="lazy" data-src="'+esc(it.src)+'" alt="'+esc(it.title)+'" />':'<div class="gi-placeholder"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-9 9"/></svg></div>')+
      '<div class="gi-overlay">'+esc(it.title)+'</div></button>';
  }).join('');
  const imgs=$$('.gallery-item img',grid);
  if('IntersectionObserver' in window && imgs.length){
    const io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){const im=e.target;im.src=im.dataset.src;im.onload=function(){im.classList.add('loaded')};im.onerror=function(){im.style.display='none';const parent=im.parentElement;if(parent&&!parent.querySelector('.gi-placeholder')){const ph=document.createElement('div');ph.className='gi-placeholder';ph.innerHTML='<svg viewBox=\'0 0 24 24\' width=\'28\' height=\'28\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.5\'><rect x=\'3\' y=\'5\' width=\'18\' height=\'14\' rx=\'2\'/><circle cx=\'9\' cy=\'11\' r=\'2\'/><path d=\'m21 17-5-5-9 9\'/></svg>';parent.insertBefore(ph,im)}};io.unobserve(im)}})},{rootMargin:'120px'});
    imgs.forEach(function(i){io.observe(i)});
  }else{
    imgs.forEach(function(i){i.src=i.dataset.src;i.onload=function(){i.classList.add('loaded')}});
  }
  $$('.gallery-item',grid).forEach(function(btn){btn.addEventListener('click',function(){const idx=parseInt(btn.dataset.index,10);if(GALLERY_ITEMS[idx].src)openViewer(idx);else toast('Foto e papercaktuar - shih udhezimet.','info')})});
}
function openViewer(idx){state.gallery.currentIndex=idx;const v=$('#galleryViewer');if(!v)return;v.style.display='';document.body.style.overflow='hidden';renderViewer();pulseHaptic()}
function closeViewer(){const v=$('#galleryViewer');if(!v)return;v.style.display='none';document.body.style.overflow=''}
function renderViewer(){
  const im=$('#viewerImage');const cap=$('#viewerCaption');
  const it=state.gallery.images[state.gallery.currentIndex];
  if(im&&it){im.style.opacity=0;im.src=it.src||'';im.onload=function(){im.style.transition='opacity .3s ease';im.style.opacity=1}}
  if(cap&&it)cap.textContent=(state.gallery.currentIndex+1)+' / '+state.gallery.images.length+' · '+it.title;
}
function nextImg(){let i=state.gallery.currentIndex;for(let k=0;k<state.gallery.images.length;k++){i=(i+1)%state.gallery.images.length;if(state.gallery.images[i].src){state.gallery.currentIndex=i;renderViewer();tinyHaptic();return}}}
function prevImg(){let i=state.gallery.currentIndex;for(let k=0;k<state.gallery.images.length;k++){i=(i-1+state.gallery.images.length)%state.gallery.images.length;if(state.gallery.images[i].src){state.gallery.currentIndex=i;renderViewer();tinyHaptic();return}}}

function wireGalleryViewer(){
  const c=$('#btnCloseViewer');if(c)c.addEventListener('click',closeViewer);
  const n=$('#btnNextImg');if(n)n.addEventListener('click',nextImg);
  const p=$('#btnPrevImg');if(p)p.addEventListener('click',prevImg);
  const v=$('#galleryViewer');
  if(v){
    v.addEventListener('click',function(ev){if(ev.target===v)closeViewer()});
    v.addEventListener('touchstart',function(ev){state.gallery.touchStartX=ev.changedTouches[0].screenX},{passive:true});
    v.addEventListener('touchend',function(ev){state.gallery.touchEndX=ev.changedTouches[0].screenX;const dx=state.gallery.touchEndX-state.gallery.touchStartX;if(Math.abs(dx)>50)(dx<0?nextImg():prevImg())},{passive:true});
  }
  document.addEventListener('keydown',function(ev){const view=$('#galleryViewer');if(!view||view.style.display==='none')return;if(ev.key==='Escape')closeViewer();else if(ev.key==='ArrowRight')nextImg();else if(ev.key==='ArrowLeft')prevImg()});
}

function wireInstall(){
  global.addEventListener('beforeinstallprompt',function(e){e.preventDefault();state.deferredInstallPrompt=e;if(state.prefs&&state.prefs.installDismissed)return;const b=$('#installBanner');if(b)b.style.display=''});
  const btn=$('#btnInstall');
  if(btn)btn.addEventListener('click',async function(){if(!state.deferredInstallPrompt)return;tinyHaptic();state.deferredInstallPrompt.prompt();const ch=await state.deferredInstallPrompt.userChoice;state.deferredInstallPrompt=null;const b=$('#installBanner');if(b)b.style.display='none';if(ch&&ch.outcome==='accepted')toast('Aplikacioni u instalua.','success')});
  const d=$('#btnDismissInstall');
  if(d)d.addEventListener('click',async function(){const b=$('#installBanner');if(b)b.style.display='none';await global.XR_Storage.setPrefs({installDismissed:true})});
  global.addEventListener('appinstalled',function(){toast('Aplikacioni u shtua ne ekranin tuaj.','success')});
}

function wireConnectivity(){
  global.addEventListener('online',function(){renderSettings();toast('Lidhja u rikthye.','success');scheduleSoon(300)});
  global.addEventListener('offline',function(){renderSettings();toast('Pa internet - po perdor cache.','info')});
}
function wireImamVideo(){
  const host=$('#imamRecitim');if(!host)return;
  function load(){
    if(host.querySelector('iframe'))return;
    const id=host.getAttribute('data-yt'),start=host.getAttribute('data-start')||0;
    host.classList.remove('yt-facade');
    host.innerHTML='<iframe src="https://www.youtube-nocookie.com/embed/'+id+'?start='+start+'&autoplay=1&rel=0" title="Recitim - Hoxhe Daim Abazi" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe>';
  }
  host.addEventListener('click',load);
  host.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();load()}});
}
function applyInitialRoute(){
  try{
    const u=new URL(global.location.href);
    const t=u.searchParams.get('tab');
    if(t&&['xhamia','namazi','kurani','rreth','galeria','cilesimet'].indexOf(t)>=0)setTab(t,{force:true});
    else setTab('xhamia',{force:true});
  }catch(e){setTab('xhamia',{force:true})}
}

async function boot(){
  try{state.prefs=await global.XR_Storage.getPrefs()}catch(e){state.prefs=global.XR_Storage.DEFAULTS}
  try{applyTheme(state.prefs.theme)}catch(e){}
  try{wireNav();wireSettings();wireGalleryViewer();wireInstall();wireConnectivity();wireImamVideo()}catch(e){console.warn('wire',e)}
  // Ora dhe navigimi nisin MENJEHERE — pavaresisht nga rrjeti ose te dhenat e namazit.
  try{renderClock();state.timers.clock=setInterval(renderClock,1000)}catch(e){}
  try{renderSettings();applyInitialRoute()}catch(e){}
  // Pjeset qe varen nga rrjeti — te izoluara, qe te mos bllokojne app-in.
  try{if(global.XR_Prayer){global.XR_Prayer.setSource(state.prefs.prayerSource);global.XR_Prayer.preloadBIKData().catch(function(){})}}catch(e){}
  if(global.XR_QuranUI){try{await global.XR_QuranUI.boot()}catch(e){console.warn('Quran UI boot',e)}}
  try{await refreshPrayerData();refreshHomeView();refreshPrayerView();renderSettings()}catch(e){console.warn('prayer',e)}
  state.timers.refresh=setInterval(async function(){try{await refreshPrayerData();refreshHomeView();refreshPrayerView()}catch(e){}},60000);
}

global.XR_UI={boot:boot,setTab:setTab,toast:toast,renderClock:renderClock,refreshPrayerData:refreshPrayerData,state:state,GALLERY_ITEMS:GALLERY_ITEMS};
})(window);
