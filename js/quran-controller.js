/* quran-controller.js — UI e Kuranit: lista, leximi, kerkimi, bookmark,
 * statistika dhe player-i audio (mini + i plote). Modul i pavarur (XR_QuranUI).
 * Nuk prek logjiken ekzistuese te aplikacionit. */
(function(global){
'use strict';
const $=function(s,r){return(r||document).querySelector(s)};
const $$=function(s,r){return Array.from((r||document).querySelectorAll(s))};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
function pad(n){return String(n).padStart(2,'0')}
function fmtTime(sec){sec=Math.max(0,Math.floor(sec||0));const m=Math.floor(sec/60),s=sec%60;return m+':'+pad(s)}
function haptic(p){try{if(navigator.vibrate&&Q.prefs&&Q.prefs!==false)navigator.vibrate(p||8)}catch(e){}}
const BASMALA=/^\s*بِسْمِ\s+ٱ?للَّهِ\s+ٱ?لرَّحْمَٰنِ\s+ٱ?لرَّحِيمِ\s*/;

const Q={
  booted:false,prefs:null,
  view:'list',                 // 'list' | 'reader'
  filter:'all',query:'',
  current:null,                // surah meta currently in reader
  ayahs:null,
  tabActive:false,
  // player
  audio:null,playing:false,curSurah:null,repeat:false,
  progObserver:null,readTimer:null,saveTimer:null,sleepTimer:null,sleepMode:0,
  els:{}
};

/* ============== BOOT ============== */
async function boot(){
  if(Q.booted)return;Q.booted=true;
  Q.prefs=(await global.XR_Storage.getPrefs()).quran;
  Q.filter='all';
  cacheEls();
  Q.audio=$('#quranAudio');
  buildReciterSelect();
  wireList();wireReader();wirePlayer();
  applyReaderPrefs();
  // Player-i NUK shfaqet automatikisht ne hapje — vetem kur perdoruesi shtyp play.
  showMini(false);
  document.addEventListener('visibilitychange',onVisibility);
}
function cacheEls(){
  const ids=['quranListView','quranReaderView','surahList','surahEmpty','surahSearch','surahSearchClear',
    'quranFilters','btnContinueReading','continueLabel','quranStatsRow',
    'readerSurahSq','readerSurahMeta','btnReaderBack','btnReaderFav','btnReaderFont','btnReaderAudio','btnReaderFocus',
    'fontPanel','fontRange','toggleArabic','readerBismillah','readerLoading','readerOffline','ayahList',
    'btnPrevSurah','btnNextSurah',
    'quranMiniPlayer','qmBar','qmExpand','qmTitle','qmReciter','qmPrev','qmPlay','qmNext','qmClose',
    'quranFullPlayer','qfCollapse','qfArtName','qfTitle','qfReciter','qfSeek','qfCur','qfDur',
    'qfRepeat','qfPrev','qfPlay','qfNext','qfSpeed','qfReciterSel','qfAutonext','qfSleep','qfSleepMenu'];
  ids.forEach(function(id){Q.els[id]=document.getElementById(id)});
}
function savePrefs(partial){return global.XR_Storage.setPrefs({quran:Object.assign({},Q.prefs,partial)}).then(function(p){Q.prefs=p.quran;return Q.prefs})}
function savePrefsDebounced(){clearTimeout(Q.saveTimer);Q.saveTimer=setTimeout(function(){global.XR_Storage.setPrefs({quran:Q.prefs})},1200)}

/* ============== ENTER TAB ============== */
function onEnter(){
  Q.tabActive=true;
  if(Q.view==='reader'){startReadTimer();return} // qendro ne lexim nese ishte aty
  renderStats();renderContinue();renderList();
}
function onLeave(){Q.tabActive=false;stopReadTimer()}

/* ============== STATS + CONTINUE ============== */
function renderStats(){
  const st=Q.prefs.stats||{};
  const totalMin=Math.round((st.totalMs||0)/60000);
  let most='—';
  if(st.perSurah){
    let best=0,bn=null;for(const k in st.perSurah){if(st.perSurah[k]>best){best=st.perSurah[k];bn=k}}
    if(bn){const m=global.XR_Quran.getMeta(bn);most=m?m.sq:('Sure '+bn)}
  }
  const items=[
    {v:(st.streak||0),l:'Ditë rresht'},
    {v:totalMin+'′',l:'Kohë leximi'},
    {v:(Q.prefs.bookmarks||[]).length,l:'Shënime'},
    {v:most,l:'Më e lexuar',small:true}
  ];
  Q.els.quranStatsRow.innerHTML=items.map(function(it){
    return '<div class="qstat"><span class="qstat-v'+(it.small?' qstat-v-sm':'')+'">'+esc(it.v)+'</span><span class="qstat-l">'+esc(it.l)+'</span></div>';
  }).join('');
}
function renderContinue(){
  const lr=Q.prefs.lastRead;const btn=Q.els.btnContinueReading;
  if(lr&&lr.surah){
    const m=global.XR_Quran.getMeta(lr.surah);
    Q.els.continueLabel.textContent=(m?m.sq:('Sure '+lr.surah))+' · ajeti '+(lr.ayah||1);
    btn.style.display='';
  }else btn.style.display='none';
}

/* ============== LIST ============== */
function surahsFor(){
  let arr=global.XR_Quran.searchMeta(Q.query);
  if(Q.filter==='meke')arr=arr.filter(function(s){return s.p==='Meke'});
  else if(Q.filter==='medine')arr=arr.filter(function(s){return s.p==='Medine'});
  else if(Q.filter==='fav'){const f=Q.prefs.favorites||[];arr=arr.filter(function(s){return f.indexOf(s.n)>=0})}
  return arr;
}
function renderList(){
  const arr=surahsFor();
  const favs=Q.prefs.favorites||[];
  const prog=Q.prefs.progress||{};
  Q.els.surahEmpty.style.display=arr.length?'none':'';
  Q.els.surahList.innerHTML=arr.map(function(s){
    const isFav=favs.indexOf(s.n)>=0;
    const read=prog[s.n]||0;
    const pct=read?Math.min(100,Math.round((read/s.a)*100)):0;
    return '<button class="surah-item" data-n="'+s.n+'" type="button">'+
      '<span class="surah-num"><span class="surah-num-deco"></span><b>'+s.n+'</b></span>'+
      '<span class="surah-main">'+
        '<span class="surah-sq">'+esc(s.sq)+(isFav?' <svg class="surah-fav" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9Z"/></svg>':'')+'</span>'+
        '<span class="surah-sub">'+esc(s.m)+' · '+s.a+' ajete · '+esc(s.p)+'</span>'+
        (pct?'<span class="surah-prog"><span style="width:'+pct+'%"></span></span>':'')+
      '</span>'+
      '<span class="surah-ar font-arabic">'+esc(s.ar)+'</span>'+
    '</button>';
  }).join('');
}
function wireList(){
  Q.els.surahList.addEventListener('click',function(e){
    const b=e.target.closest('.surah-item');if(!b)return;
    haptic(8);openSurah(parseInt(b.getAttribute('data-n'),10));
  });
  let t=null;
  Q.els.surahSearch.addEventListener('input',function(e){
    const v=e.target.value;Q.els.surahSearchClear.style.display=v?'':'none';
    clearTimeout(t);t=setTimeout(function(){Q.query=v;renderList()},160);
  });
  Q.els.surahSearchClear.addEventListener('click',function(){Q.els.surahSearch.value='';Q.query='';Q.els.surahSearchClear.style.display='none';renderList();Q.els.surahSearch.focus()});
  Q.els.quranFilters.addEventListener('click',function(e){
    const b=e.target.closest('.qfilter');if(!b)return;
    $$('.qfilter',Q.els.quranFilters).forEach(function(x){x.classList.toggle('is-active',x===b)});
    Q.filter=b.getAttribute('data-filter');renderList();
  });
  Q.els.btnContinueReading.addEventListener('click',function(){
    const lr=Q.prefs.lastRead;if(lr&&lr.surah)openSurah(lr.surah,lr.ayah);
  });
}

/* ============== READER ============== */
function showView(v){
  Q.view=v;
  Q.els.quranListView.style.display=v==='list'?'':'none';
  Q.els.quranReaderView.style.display=v==='reader'?'':'none';
  if(v==='reader'){startReadTimer();document.body.classList.toggle('focus-mode',!!Q.prefs.focusMode)}
  else{stopReadTimer();document.body.classList.remove('focus-mode')}
  if(v==='list'){renderStats();renderContinue();renderList()}
}
async function openSurah(n,gotoAyah){
  const meta=global.XR_Quran.getMeta(n);if(!meta)return;
  Q.current=meta;Q.ayahs=null;
  showView('reader');
  Q.els.quranReaderView.scrollIntoView?null:null;
  try{window.scrollTo({top:0,behavior:'auto'})}catch(e){window.scrollTo(0,0)}
  Q.els.readerSurahSq.textContent=meta.sq;
  Q.els.readerSurahMeta.textContent=meta.m+' · '+meta.a+' ajete · '+meta.p;
  syncFavBtn();
  Q.els.ayahList.innerHTML='';
  Q.els.readerOffline.style.display='none';
  Q.els.readerBismillah.style.display=(n===9||n===1)?'none':'';
  Q.els.readerLoading.style.display='';
  // stats: open + recent
  bumpOpen(n);
  const rec=await global.XR_Quran.getSurah(n,Q.prefs.translation);
  Q.els.readerLoading.style.display='none';
  if(!rec||!rec.ayahs){Q.els.readerOffline.style.display='';Q.els.readerBismillah.style.display='none';return}
  Q.ayahs=rec.ayahs;
  renderAyahs(rec.ayahs,n);
  // restore position
  const targetAyah=gotoAyah||((Q.prefs.lastRead&&Q.prefs.lastRead.surah===n)?Q.prefs.lastRead.ayah:1);
  if(targetAyah&&targetAyah>1)scrollToAyah(targetAyah);
  setupProgressObserver();
  setLastRead(n,targetAyah||1);
}
/* ---- Bookmark në nivel ajeti ---- */
function bmKey(s,a){return s+':'+a}
function isBookmarked(s,a){return (Q.prefs.bookmarks||[]).indexOf(bmKey(s,a))>=0}
function toggleBookmark(s,a){
  let b=Q.prefs.bookmarks||[];const k=bmKey(s,a);const i=b.indexOf(k);
  if(i>=0)b.splice(i,1);else b.push(k);
  Q.prefs.bookmarks=b;savePrefs({bookmarks:b});
  return i<0;
}
function renderAyahs(ayahs,n){
  const showAr=Q.prefs.showArabic!==false;
  Q.els.ayahList.innerHTML=ayahs.map(function(a,i){
    let ar=a.ar||'';
    if(i===0&&n!==1)ar=ar.replace(BASMALA,'');
    const bm=isBookmarked(n,a.n);
    return '<div class="ayah" data-ayah="'+a.n+'">'+
      '<div class="ayah-head">'+
        '<span class="ayah-badge">'+a.n+'</span>'+
        '<span class="ayah-head-r">'+
          (a.sajda?'<span class="ayah-sajda">۩ Sexhde</span>':'')+
          '<button class="ayah-bm'+(bm?' is-on':'')+'" data-bm="'+a.n+'" type="button" aria-label="Shëno ajetin"><svg viewBox="0 0 24 24" width="15" height="15" fill="'+(bm?'currentColor':'none')+'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v16l-6-4-6 4V4Z"/></svg></button>'+
        '</span>'+
      '</div>'+
      (showAr?'<p class="ayah-ar font-arabic" dir="rtl">'+esc(ar)+'</p>':'')+
      '<p class="ayah-tr">'+esc(a.tr)+'</p>'+
    '</div>';
  }).join('');
}
function scrollToAyah(num){
  const el=Q.els.ayahList.querySelector('.ayah[data-ayah="'+num+'"]');
  if(el)setTimeout(function(){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('ayah-flash');setTimeout(function(){el.classList.remove('ayah-flash')},1600)},120);
}
function setupProgressObserver(){
  if(Q.progObserver)Q.progObserver.disconnect();
  if(!('IntersectionObserver' in window))return;
  Q.progObserver=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.isIntersecting){
        const num=parseInt(e.target.getAttribute('data-ayah'),10);
        if(Q.current){
          const cur=Q.prefs.progress[Q.current.n]||0;
          if(num>cur){Q.prefs.progress[Q.current.n]=num;savePrefsDebounced()}
          setLastRead(Q.current.n,num);
        }
      }
    });
  },{rootMargin:'-40% 0px -50% 0px'});
  $$('.ayah',Q.els.ayahList).forEach(function(el){Q.progObserver.observe(el)});
}
function setLastRead(surah,ayah){
  Q.prefs.lastRead={surah:surah,ayah:ayah,ts:Date.now()};
  // recent list (unique, max 12)
  let r=(Q.prefs.recent||[]).filter(function(x){return x!==surah});
  r.unshift(surah);Q.prefs.recent=r.slice(0,12);
  savePrefsDebounced();
}
function bumpOpen(n){
  const st=Q.prefs.stats=Q.prefs.stats||{opens:0,totalMs:0,perSurah:{},streak:0,lastReadDay:null};
  st.opens=(st.opens||0)+1;
  st.perSurah=st.perSurah||{};st.perSurah[n]=(st.perSurah[n]||0)+1;
  // streak
  const today=new Date();const dk=today.getFullYear()+'-'+pad(today.getMonth()+1)+'-'+pad(today.getDate());
  if(st.lastReadDay!==dk){
    const y=new Date(today);y.setDate(y.getDate()-1);
    const yk=y.getFullYear()+'-'+pad(y.getMonth()+1)+'-'+pad(y.getDate());
    st.streak=(st.lastReadDay===yk)?(st.streak||0)+1:1;
    st.lastReadDay=dk;
  }
  savePrefsDebounced();
}
function syncFavBtn(){
  const fav=(Q.prefs.favorites||[]).indexOf(Q.current.n)>=0;
  Q.els.btnReaderFav.classList.toggle('is-on',fav);
  Q.els.btnReaderFav.querySelector('svg').setAttribute('fill',fav?'currentColor':'none');
}
function wireReader(){
  Q.els.btnReaderBack.addEventListener('click',function(){haptic(8);teardownReader();showView('list')});
  Q.els.btnReaderFav.addEventListener('click',function(){
    if(!Q.current)return;
    let f=Q.prefs.favorites||[];const i=f.indexOf(Q.current.n);
    if(i>=0)f.splice(i,1);else{f.push(Q.current.n);haptic([14,20,14])}
    Q.prefs.favorites=f;savePrefs({favorites:f});syncFavBtn();
    if(global.XR_UI)global.XR_UI.toast(i>=0?'U hoq nga të preferuarat':'U shtua te të preferuarat',i>=0?'info':'success',1500);
  });
  Q.els.btnReaderFont.addEventListener('click',function(){
    const p=Q.els.fontPanel;p.style.display=p.style.display==='none'?'':'none';
  });
  Q.els.fontRange.addEventListener('input',function(e){setFontScale(parseFloat(e.target.value))});
  $$('#fontPanel .font-step').forEach(function(b){b.addEventListener('click',function(){
    const d=b.getAttribute('data-font')==='inc'?0.1:-0.1;
    setFontScale(Math.min(1.8,Math.max(0.8,(Q.prefs.fontScale||1)+d)));
    Q.els.fontRange.value=Q.prefs.fontScale;
  })});
  Q.els.toggleArabic.addEventListener('change',function(e){
    Q.prefs.showArabic=e.target.checked;savePrefs({showArabic:e.target.checked});
    if(Q.ayahs&&Q.current)renderAyahs(Q.ayahs,Q.current.n),setupProgressObserver();
  });
  Q.els.btnReaderFocus.addEventListener('click',function(){
    const on=!document.body.classList.contains('focus-mode');
    document.body.classList.toggle('focus-mode',on);
    Q.els.btnReaderFocus.classList.toggle('is-on',on);
    Q.prefs.focusMode=on;savePrefs({focusMode:on});
    haptic(8);
  });
  Q.els.btnReaderAudio.addEventListener('click',function(){if(Q.current)loadAndPlay(Q.current.n)});
  Q.els.ayahList.addEventListener('click',function(e){
    const b=e.target.closest('.ayah-bm');if(!b||!Q.current)return;
    e.stopPropagation();
    const ay=parseInt(b.getAttribute('data-bm'),10);
    const on=toggleBookmark(Q.current.n,ay);
    b.classList.toggle('is-on',on);
    b.querySelector('svg').setAttribute('fill',on?'currentColor':'none');
    haptic(on?[14,20,14]:8);
    if(global.XR_UI)global.XR_UI.toast(on?'Ajeti u shënua':'Shënimi u hoq',on?'success':'info',1400);
  });
  Q.els.btnPrevSurah.addEventListener('click',function(){if(Q.current&&Q.current.n>1)openSurah(Q.current.n-1,1)});
  Q.els.btnNextSurah.addEventListener('click',function(){if(Q.current&&Q.current.n<114)openSurah(Q.current.n+1,1)});
}
function applyReaderPrefs(){
  setFontScale(Q.prefs.fontScale||1,true);
  Q.els.fontRange.value=Q.prefs.fontScale||1;
  Q.els.toggleArabic.checked=Q.prefs.showArabic!==false;
  // Focus-mode NUK aplikohet globalisht — vetem brenda leximit (showView('reader')).
  // Sigurohu qe te mos mbetet i ngecur ne ekranet e tjera (fshehte menyne/header-in).
  document.body.classList.remove('focus-mode');
  if(Q.prefs.focusMode)Q.els.btnReaderFocus.classList.add('is-on');
}
function setFontScale(v,silent){
  Q.prefs.fontScale=v;
  document.documentElement.style.setProperty('--quran-font',v);
  if(!silent)savePrefs({fontScale:v});
}
function teardownReader(){
  if(Q.progObserver){Q.progObserver.disconnect();Q.progObserver=null}
  if(document.body.classList.contains('focus-mode')&&Q.prefs.focusMode){/* keep pref but exit visual on list */}
}

/* reading-time tracking */
function onVisibility(){if(document.visibilityState!=='visible')stopReadTimer();else if(Q.view==='reader'&&Q.tabActive)startReadTimer()}
function startReadTimer(){
  if(Q.readTimer)return;
  Q.readTimer=setInterval(function(){
    if(Q.view==='reader'&&Q.tabActive&&document.visibilityState==='visible'){
      const st=Q.prefs.stats=Q.prefs.stats||{totalMs:0};
      st.totalMs=(st.totalMs||0)+5000;savePrefsDebounced();
    }
  },5000);
}
function stopReadTimer(){if(Q.readTimer){clearInterval(Q.readTimer);Q.readTimer=null}}

/* ============== PLAYER ============== */
function reciterOptions(){const R=global.XR_Quran.RECITERS;return Object.keys(R).map(function(k){return '<option value="'+k+'">'+esc(R[k].label)+'</option>'}).join('')}
function buildReciterSelect(){
  const cur=Q.prefs.reciter||global.XR_Quran.DEFAULT_RECITER;
  if(Q.els.qfReciterSel){Q.els.qfReciterSel.innerHTML=reciterOptions();Q.els.qfReciterSel.value=cur}
  const setSel=document.getElementById('setReciterSel');
  if(setSel){setSel.innerHTML=reciterOptions();setSel.value=cur;setSel.addEventListener('change',function(e){changeReciter(e.target.value)})}
}
function changeReciter(key){
  Q.prefs.reciter=key;savePrefs({reciter:key});
  if(Q.els.qfReciterSel)Q.els.qfReciterSel.value=key;
  const setSel=document.getElementById('setReciterSel');if(setSel)setSel.value=key;
  if(Q.curSurah){
    const meta=global.XR_Quran.getMeta(Q.curSurah);if(meta)updatePlayerMeta(meta);
    const a=Q.audio;const wasPlaying=a&&!a.paused;const t=a?(a.currentTime||0):0;
    a.dataset.reciter='__';prepareTrack(Q.curSurah,false);
    a.addEventListener('loadedmetadata',function once(){try{a.currentTime=Math.min(t,a.duration||t)}catch(e){}if(wasPlaying)a.play().catch(function(){});a.removeEventListener('loadedmetadata',once)});
  }
  if(global.XR_UI)global.XR_UI.toast('Recituesi: '+reciterLabel(),'success',1500);
}
function reciterLabel(){const R=global.XR_Quran.RECITERS;return (R[Q.prefs.reciter]||R[global.XR_Quran.DEFAULT_RECITER]).label}
function prepareTrack(n,autoplay){
  const meta=global.XR_Quran.getMeta(n);if(!meta)return;
  Q.curSurah=n;
  const url=global.XR_Quran.surahAudioURL(Q.prefs.reciter||global.XR_Quran.DEFAULT_RECITER,n);
  if(Q.audio.dataset.surah!==String(n)||Q.audio.dataset.reciter!==(Q.prefs.reciter||'')){
    Q.audio.src=url;Q.audio.dataset.surah=String(n);Q.audio.dataset.reciter=Q.prefs.reciter||'';
    Q.audio.load();
  }
  Q.audio.playbackRate=Q.prefs.playbackRate||1;
  updatePlayerMeta(meta);
  Q.prefs.lastPlayed={surah:n};savePrefsDebounced();
  setupMediaSession(meta);
  if(autoplay)Q.audio.play().catch(function(){});
}
function loadAndPlay(n){
  prepareTrack(n,true);showMini(true);haptic(10);
  if(global.XR_UI)global.XR_UI.toast('Po luan: '+global.XR_Quran.getMeta(n).sq,'info',1400);
}
/* Ruajtje proaktive per offline: nje GET i plote (200) ne cache-in 'xr-audio'. */
function cacheAudioForOffline(n){
  if(!('caches' in window)||!navigator.onLine)return;
  const url=global.XR_Quran.surahAudioURL(Q.prefs.reciter||global.XR_Quran.DEFAULT_RECITER,n);
  caches.open('xr-audio').then(function(c){
    c.match(url).then(function(hit){
      if(hit)return;
      fetch(url,{mode:'cors'}).then(function(r){if(r&&r.status===200)c.put(url,r.clone())}).catch(function(){});
    });
  }).catch(function(){});
}
function updatePlayerMeta(meta){
  const t=meta.sq+' · '+meta.m;
  Q.els.qmTitle.textContent=meta.sq;Q.els.qmReciter.textContent=reciterLabel();
  Q.els.qfTitle.textContent=meta.sq+' — '+meta.m;Q.els.qfReciter.textContent=reciterLabel()+' · sure '+meta.n;
  Q.els.qfArtName.textContent=meta.ar;
}
function showMini(on){Q.els.quranMiniPlayer.style.display=on?'':'none';document.body.classList.toggle('has-mini-player',!!on)}
function openFull(){Q.els.quranFullPlayer.style.display='';requestAnimationFrame(function(){Q.els.quranFullPlayer.classList.add('open')})}
function closeFull(){Q.els.quranFullPlayer.classList.remove('open');setTimeout(function(){Q.els.quranFullPlayer.style.display='none'},280)}
function setPlayIcons(playing){
  [Q.els.qmPlay,Q.els.qfPlay].forEach(function(b){if(!b)return;b.querySelector('.ic-play').style.display=playing?'none':'';b.querySelector('.ic-pause').style.display=playing?'':'none'});
}
function togglePlay(){
  if(!Q.curSurah){if(Q.current)prepareTrack(Q.current.n,false);else return}
  if(Q.audio.paused)Q.audio.play().catch(function(){});else Q.audio.pause();
}
function wirePlayer(){
  const a=Q.audio;
  a.addEventListener('play',function(){Q.playing=true;setPlayIcons(true);if(navigator.mediaSession)navigator.mediaSession.playbackState='playing'});
  a.addEventListener('pause',function(){Q.playing=false;setPlayIcons(false);if(navigator.mediaSession)navigator.mediaSession.playbackState='paused'});
  a.addEventListener('timeupdate',function(){
    const d=a.duration||0,c=a.currentTime||0;const pct=d?(c/d):0;
    Q.els.qmBar.style.width=(pct*100)+'%';
    if(!Q._seeking)Q.els.qfSeek.value=Math.round(pct*1000);
    Q.els.qfCur.textContent=fmtTime(c);Q.els.qfDur.textContent=fmtTime(d);
    if(navigator.mediaSession&&navigator.mediaSession.setPositionState&&d&&isFinite(d)){try{navigator.mediaSession.setPositionState({duration:d,position:Math.min(c,d),playbackRate:a.playbackRate||1})}catch(e){}}
  });
  a.addEventListener('ended',onEnded);
  a.addEventListener('error',function(){if(global.XR_UI&&Q.curSurah)global.XR_UI.toast('Audio nuk u ngarkua (kontrollo internetin).','error',2200)});
  // mini
  Q.els.qmPlay.addEventListener('click',togglePlay);
  Q.els.qmExpand.addEventListener('click',openFull);
  Q.els.qmNext.addEventListener('click',nextSurah);
  Q.els.qmPrev.addEventListener('click',prevSurah);
  Q.els.qmClose.addEventListener('click',function(){a.pause();showMini(false);closeFull()});
  // full
  Q.els.qfCollapse.addEventListener('click',closeFull);
  $('.qf-backdrop',Q.els.quranFullPlayer).addEventListener('click',closeFull);
  Q.els.qfPlay.addEventListener('click',togglePlay);
  Q.els.qfNext.addEventListener('click',nextSurah);
  Q.els.qfPrev.addEventListener('click',prevSurah);
  Q.els.qfSeek.addEventListener('input',function(e){Q._seeking=true;const d=a.duration||0;Q.els.qfCur.textContent=fmtTime(d*(e.target.value/1000))});
  Q.els.qfSeek.addEventListener('change',function(e){const d=a.duration||0;a.currentTime=d*(e.target.value/1000);Q._seeking=false});
  Q.els.qfSpeed.addEventListener('click',cycleSpeed);
  Q.els.qfRepeat.addEventListener('click',function(){Q.repeat=!Q.repeat;Q.els.qfRepeat.classList.toggle('is-on',Q.repeat);haptic(8)});
  Q.els.qfAutonext.addEventListener('click',function(){const on=!Q.els.qfAutonext.classList.contains('is-active');Q.els.qfAutonext.classList.toggle('is-active',on)});
  Q.els.qfReciterSel.addEventListener('change',function(e){changeReciter(e.target.value)});
  // sleep timer
  Q.els.qfSleep.addEventListener('click',function(){const m=Q.els.qfSleepMenu;m.style.display=m.style.display==='none'?'':'none'});
  Q.els.qfSleepMenu.addEventListener('click',function(e){const b=e.target.closest('button');if(!b)return;setSleep(b.getAttribute('data-min'));Q.els.qfSleepMenu.style.display='none'});
  Q.els.qfSpeed.textContent=(Q.prefs.playbackRate||1)+'×';
}
function cycleSpeed(){
  const rates=[0.75,1,1.25,1.5,2];
  let i=rates.indexOf(Q.prefs.playbackRate||1);i=(i+1)%rates.length;
  const r=rates[i];Q.prefs.playbackRate=r;Q.audio.playbackRate=r;savePrefs({playbackRate:r});
  Q.els.qfSpeed.textContent=r+'×';
}
function nextSurah(){if(Q.curSurah&&Q.curSurah<114){prepareTrack(Q.curSurah+1,true);showMini(true)}}
function prevSurah(){if(Q.curSurah&&Q.curSurah>1){prepareTrack(Q.curSurah-1,true);showMini(true)}}
function onEnded(){
  if(Q.repeat){Q.audio.currentTime=0;Q.audio.play().catch(function(){});return}
  if(Q.sleepMode==='end'){Q.sleepMode=0;Q.els.qfSleep.classList.remove('is-on');return}
  if(Q.els.qfAutonext.classList.contains('is-active')&&Q.curSurah<114)nextSurah();
}
function setSleep(min){
  clearTimeout(Q.sleepTimer);Q.sleepMode=0;Q.els.qfSleep.classList.remove('is-on');
  if(min==='0'||min==null)return;
  if(min==='end'){Q.sleepMode='end';Q.els.qfSleep.classList.add('is-on');if(global.XR_UI)global.XR_UI.toast('Do fiket në fund të sures','info',1600);return}
  const ms=parseInt(min,10)*60000;
  Q.sleepMode=parseInt(min,10);Q.els.qfSleep.classList.add('is-on');
  Q.sleepTimer=setTimeout(function(){Q.audio.pause();Q.els.qfSleep.classList.remove('is-on');Q.sleepMode=0},ms);
  if(global.XR_UI)global.XR_UI.toast('Do fiket pas '+min+' min','info',1600);
}
function setupMediaSession(meta){
  if(!('mediaSession' in navigator))return;
  try{
    navigator.mediaSession.metadata=new MediaMetadata({
      title:meta.sq+' — '+meta.m,artist:reciterLabel(),album:'Kurani Famelartë',
      artwork:[{src:'assets/icons/icon.svg',sizes:'512x512',type:'image/svg+xml'}]
    });
    navigator.mediaSession.setActionHandler('play',function(){Q.audio.play()});
    navigator.mediaSession.setActionHandler('pause',function(){Q.audio.pause()});
    navigator.mediaSession.setActionHandler('previoustrack',prevSurah);
    navigator.mediaSession.setActionHandler('nexttrack',nextSurah);
    navigator.mediaSession.setActionHandler('seekbackward',function(){Q.audio.currentTime=Math.max(0,Q.audio.currentTime-10)});
    navigator.mediaSession.setActionHandler('seekforward',function(){Q.audio.currentTime=Math.min(Q.audio.duration||0,Q.audio.currentTime+10)});
    try{navigator.mediaSession.setActionHandler('seekto',function(d){if(d&&d.seekTime!=null)Q.audio.currentTime=d.seekTime})}catch(e){}
    try{navigator.mediaSession.setActionHandler('stop',function(){Q.audio.pause()})}catch(e){}
  }catch(e){}
}

global.XR_QuranUI={boot:boot,onEnter:onEnter,onLeave:onLeave,openSurah:openSurah,loadAndPlay:loadAndPlay};
})(window);
