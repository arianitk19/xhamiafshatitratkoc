/* quran-data.js — Moduli i Kuranit (te dhenat + rrjeti + cache)
 *
 * Arkitektura:
 *  - SURAHS: metadata e plote per 114 suret (e integruar, gjithmone offline).
 *  - TRANSLATIONS: modulare — shto perkthime te reja pa ndryshuar kodin.
 *  - RECITERS: modulare — shto recitues te rinj pa ndryshuar kodin.
 *  - getSurah(): merr tekstin arabisht + perkthimin nga alquran.cloud,
 *    e ruan ne IndexedDB; offline kthen versionin e ruajtur.
 *  - Audio: stream nga islamic.network CDN; cache vetem suret e degjuara
 *    (nuk e rrit madhesine e aplikacionit pa nevoje).
 */
(function(global){
'use strict';

/* ---------- Perkthimet (modulare) ---------- */
const TRANSLATIONS={
  ahmeti:{id:'sq.ahmeti',label:'Sherif Ahmeti',lang:'sq',dir:'ltr'}
  // Shtim i ardhshem, p.sh.:
  // nahi:{id:'sq.nahi',label:'Hasan Efendi Nahi',lang:'sq',dir:'ltr'},
  // mehdiu:{id:'sq.mehdiu',label:'Feti Mehdiu',lang:'sq',dir:'ltr'}
};
const DEFAULT_TRANSLATION='ahmeti';
const ARABIC_EDITION='quran-uthmani';

/* ---------- Recituesit (modulare) ---------- */
const RECITERS={
  alafasy:{id:'ar.alafasy',label:'Mishary Alafasy',short:'Alafasy'},
  husary:{id:'ar.husary',label:'Mahmoud Khalil Al-Husary',short:'Husary'},
  abdulbasit:{id:'ar.abdulbasitmurattal',label:'Abdul Basit (Murattal)',short:'Abdul Basit'},
  sudais:{id:'ar.abdurrahmaansudais',label:'Abdurrahman As-Sudais',short:'Sudais'}
  // Per te shtuar nje recitues: shto nje rresht ketu me id-ne e edicionit audio te alquran.cloud.
};
const DEFAULT_RECITER='alafasy';
const AUDIO_BASE='https://cdn.islamic.network/quran/audio-surah/128/';
function surahAudioURL(reciterKey,surahNumber){
  const r=RECITERS[reciterKey]||RECITERS[DEFAULT_RECITER];
  return AUDIO_BASE+r.id+'/'+surahNumber+'.mp3';
}

const API_BASE='https://api.alquran.cloud/v1';

/* ---------- Metadata e 114 sureve (offline-first) ---------- */
/* fusha: n=numri, ar=emri arabisht, sq=emri shqip, m=kuptimi shqip,
 *        a=numri i ajeteve, p='Meke' ose 'Medine' */
const SURAHS=[
 {n:1,ar:'الفاتحة',sq:'El-Fatiha',m:'Hapja',a:7,p:'Meke'},
 {n:2,ar:'البقرة',sq:'El-Bekare',m:'Lopa',a:286,p:'Medine'},
 {n:3,ar:'آل عمران',sq:'Ali Imran',m:'Familja e Imranit',a:200,p:'Medine'},
 {n:4,ar:'النساء',sq:'En-Nisa',m:'Grate',a:176,p:'Medine'},
 {n:5,ar:'المائدة',sq:'El-Maide',m:'Sofra',a:120,p:'Medine'},
 {n:6,ar:'الأنعام',sq:"El-En'am",m:'Bagetia',a:165,p:'Meke'},
 {n:7,ar:'الأعراف',sq:"El-A'raf",m:'Lartesite',a:206,p:'Meke'},
 {n:8,ar:'الأنفال',sq:'El-Enfal',m:'Preja e luftes',a:75,p:'Medine'},
 {n:9,ar:'التوبة',sq:'Et-Tewbe',m:'Pendimi',a:129,p:'Medine'},
 {n:10,ar:'يونس',sq:'Junus',m:'Junusi (Jona)',a:109,p:'Meke'},
 {n:11,ar:'هود',sq:'Hud',m:'Hudi',a:123,p:'Meke'},
 {n:12,ar:'يوسف',sq:'Jusuf',m:'Jusufi (Jozefi)',a:111,p:'Meke'},
 {n:13,ar:'الرعد',sq:"Er-Ra'd",m:'Bubullima',a:43,p:'Medine'},
 {n:14,ar:'ابراهيم',sq:'Ibrahim',m:'Ibrahimi (Abrahami)',a:52,p:'Meke'},
 {n:15,ar:'الحجر',sq:'El-Hixhr',m:'Vendi i gurte',a:99,p:'Meke'},
 {n:16,ar:'النحل',sq:'En-Nahl',m:'Bleta',a:128,p:'Meke'},
 {n:17,ar:'الإسراء',sq:'El-Isra',m:'Udhetimi i nates',a:111,p:'Meke'},
 {n:18,ar:'الكهف',sq:'El-Kehf',m:'Shpella',a:110,p:'Meke'},
 {n:19,ar:'مريم',sq:'Merjem',m:'Merjemja (Maria)',a:98,p:'Meke'},
 {n:20,ar:'طه',sq:'Ta-Ha',m:'Ta-Ha',a:135,p:'Meke'},
 {n:21,ar:'الأنبياء',sq:'El-Enbija',m:'Pejgamberet',a:112,p:'Meke'},
 {n:22,ar:'الحج',sq:'El-Haxh',m:'Haxhi',a:78,p:'Medine'},
 {n:23,ar:'المؤمنون',sq:"El-Mu'minun",m:'Besimtaret',a:118,p:'Meke'},
 {n:24,ar:'النور',sq:'En-Nur',m:'Drita',a:64,p:'Medine'},
 {n:25,ar:'الفرقان',sq:'El-Furkan',m:'Dallimi',a:77,p:'Meke'},
 {n:26,ar:'الشعراء',sq:'Esh-Shuara',m:'Poetet',a:227,p:'Meke'},
 {n:27,ar:'النمل',sq:'En-Neml',m:'Milingonat',a:93,p:'Meke'},
 {n:28,ar:'القصص',sq:'El-Kasas',m:'Tregimet',a:88,p:'Meke'},
 {n:29,ar:'العنكبوت',sq:'El-Ankebut',m:'Merimanga',a:69,p:'Meke'},
 {n:30,ar:'الروم',sq:'Er-Rum',m:'Bizantinet',a:60,p:'Meke'},
 {n:31,ar:'لقمان',sq:'Lukman',m:'Lukmani',a:34,p:'Meke'},
 {n:32,ar:'السجدة',sq:'Es-Sexhde',m:'Sexhdja',a:30,p:'Meke'},
 {n:33,ar:'الأحزاب',sq:'El-Ahzab',m:'Aleancat',a:73,p:'Medine'},
 {n:34,ar:'سبأ',sq:'Sebe',m:'Sebe',a:54,p:'Meke'},
 {n:35,ar:'فاطر',sq:'Fatir',m:'Krijuesi',a:45,p:'Meke'},
 {n:36,ar:'يس',sq:'Ja-Sin',m:'Ja-Sin',a:83,p:'Meke'},
 {n:37,ar:'الصافات',sq:'Es-Saffat',m:'Te rreshtuarit',a:182,p:'Meke'},
 {n:38,ar:'ص',sq:'Sad',m:'Sad',a:88,p:'Meke'},
 {n:39,ar:'الزمر',sq:'Ez-Zumer',m:'Grupet',a:75,p:'Meke'},
 {n:40,ar:'غافر',sq:'Gafir',m:'Falesi',a:85,p:'Meke'},
 {n:41,ar:'فصلت',sq:'Fussilet',m:'Te shtjelluara',a:54,p:'Meke'},
 {n:42,ar:'الشورى',sq:'Esh-Shura',m:'Keshillimi',a:53,p:'Meke'},
 {n:43,ar:'الزخرف',sq:'Ez-Zuhruf',m:'Stolite',a:89,p:'Meke'},
 {n:44,ar:'الدخان',sq:'Ed-Duhan',m:'Tymi',a:59,p:'Meke'},
 {n:45,ar:'الجاثية',sq:'El-Xhathije',m:'Te gjunjezuarit',a:37,p:'Meke'},
 {n:46,ar:'الأحقاف',sq:'El-Ahkaf',m:'Dunat e rerés',a:35,p:'Meke'},
 {n:47,ar:'محمد',sq:'Muhammed',m:'Muhamedi',a:38,p:'Medine'},
 {n:48,ar:'الفتح',sq:"El-Fet'h",m:'Ngadhnjimi',a:29,p:'Medine'},
 {n:49,ar:'الحجرات',sq:'El-Huxhurat',m:'Dhomat',a:18,p:'Medine'},
 {n:50,ar:'ق',sq:'Kaf',m:'Kaf',a:45,p:'Meke'},
 {n:51,ar:'الذاريات',sq:'Edh-Dharijat',m:'Eret shperndarese',a:60,p:'Meke'},
 {n:52,ar:'الطور',sq:'Et-Tur',m:'Kodra Tur',a:49,p:'Meke'},
 {n:53,ar:'النجم',sq:'En-Nexhm',m:'Ylli',a:62,p:'Meke'},
 {n:54,ar:'القمر',sq:'El-Kamer',m:'Hena',a:55,p:'Meke'},
 {n:55,ar:'الرحمن',sq:'Er-Rahman',m:'Meshiruesi',a:78,p:'Medine'},
 {n:56,ar:'الواقعة',sq:'El-Vakia',m:'Ngjarja e pashmangshme',a:96,p:'Meke'},
 {n:57,ar:'الحديد',sq:'El-Hadid',m:'Hekuri',a:29,p:'Medine'},
 {n:58,ar:'المجادلة',sq:'El-Muxhadele',m:'Polemika',a:22,p:'Medine'},
 {n:59,ar:'الحشر',sq:'El-Hashr',m:'Debimi',a:24,p:'Medine'},
 {n:60,ar:'الممتحنة',sq:'El-Mumtehine',m:'E provuara',a:13,p:'Medine'},
 {n:61,ar:'الصف',sq:'Es-Saff',m:'Rreshti',a:14,p:'Medine'},
 {n:62,ar:'الجمعة',sq:'El-Xhumua',m:'Xhumaja',a:11,p:'Medine'},
 {n:63,ar:'المنافقون',sq:'El-Munafikun',m:'Hipokritet',a:11,p:'Medine'},
 {n:64,ar:'التغابن',sq:'Et-Tegabun',m:'Mashtrimi i ndersjelle',a:18,p:'Medine'},
 {n:65,ar:'الطلاق',sq:'Et-Talak',m:'Shkurorezimi',a:12,p:'Medine'},
 {n:66,ar:'التحريم',sq:'Et-Tahrim',m:'Ndalimi',a:12,p:'Medine'},
 {n:67,ar:'الملك',sq:'El-Mulk',m:'Sundimi',a:30,p:'Meke'},
 {n:68,ar:'القلم',sq:'El-Kalem',m:'Lapsi',a:52,p:'Meke'},
 {n:69,ar:'الحاقة',sq:'El-Hakka',m:'E verteta',a:52,p:'Meke'},
 {n:70,ar:'المعارج',sq:'El-Mearixh',m:'Shkalleт e ngjitjes',a:44,p:'Meke'},
 {n:71,ar:'نوح',sq:'Nuh',m:'Nuhu (Noa)',a:28,p:'Meke'},
 {n:72,ar:'الجن',sq:'El-Xhinn',m:'Xhinet',a:28,p:'Meke'},
 {n:73,ar:'المزمل',sq:'El-Muzzemmil',m:'I mbeshtjelluri',a:20,p:'Meke'},
 {n:74,ar:'المدثر',sq:'El-Muddeththir',m:'I mbuluari',a:56,p:'Meke'},
 {n:75,ar:'القيامة',sq:'El-Kijame',m:'Ringjallja',a:40,p:'Meke'},
 {n:76,ar:'الانسان',sq:'El-Insan',m:'Njeriu',a:31,p:'Medine'},
 {n:77,ar:'المرسلات',sq:'El-Murselat',m:'Te derguarat',a:50,p:'Meke'},
 {n:78,ar:'النبأ',sq:'En-Nebe',m:'Lajmi',a:40,p:'Meke'},
 {n:79,ar:'النازعات',sq:'En-Naziat',m:'Terheqesit',a:46,p:'Meke'},
 {n:80,ar:'عبس',sq:'Abese',m:'U vrenjt',a:42,p:'Meke'},
 {n:81,ar:'التكوير',sq:'Et-Tekvir',m:'Mbeshtjellja',a:29,p:'Meke'},
 {n:82,ar:'الإنفطار',sq:'El-Infitar',m:'Carja',a:19,p:'Meke'},
 {n:83,ar:'المطففين',sq:'El-Mutaffifin',m:'Matesit me hile',a:36,p:'Meke'},
 {n:84,ar:'الإنشقاق',sq:'El-Inshikak',m:'Plasja',a:25,p:'Meke'},
 {n:85,ar:'البروج',sq:'El-Buruxh',m:'Yjesite',a:22,p:'Meke'},
 {n:86,ar:'الطارق',sq:'Et-Tarik',m:'Ylli i nates',a:17,p:'Meke'},
 {n:87,ar:'الأعلى',sq:"El-A'la",m:'Me i Larti',a:19,p:'Meke'},
 {n:88,ar:'الغاشية',sq:'El-Gashije',m:'Mbuluesja',a:26,p:'Meke'},
 {n:89,ar:'الفجر',sq:'El-Fexhr',m:'Agimi',a:30,p:'Meke'},
 {n:90,ar:'البلد',sq:'El-Beled',m:'Qyteti',a:20,p:'Meke'},
 {n:91,ar:'الشمس',sq:'Esh-Shems',m:'Dielli',a:15,p:'Meke'},
 {n:92,ar:'الليل',sq:'El-Lejl',m:'Nata',a:21,p:'Meke'},
 {n:93,ar:'الضحى',sq:'Ed-Duha',m:'Paraditja',a:11,p:'Meke'},
 {n:94,ar:'الشرح',sq:'Esh-Sherh',m:'Zgjerimi i gjoksit',a:8,p:'Meke'},
 {n:95,ar:'التين',sq:'Et-Tin',m:'Fiku',a:8,p:'Meke'},
 {n:96,ar:'العلق',sq:'El-Alek',m:'Gjaku i mpiksur',a:19,p:'Meke'},
 {n:97,ar:'القدر',sq:'El-Kadr',m:'Nata e Kadrit',a:5,p:'Meke'},
 {n:98,ar:'البينة',sq:'El-Bejjine',m:'Prova e qarte',a:8,p:'Medine'},
 {n:99,ar:'الزلزلة',sq:'Ez-Zelzele',m:'Termeti',a:8,p:'Medine'},
 {n:100,ar:'العاديات',sq:'El-Adijat',m:'Vrapuesit',a:11,p:'Meke'},
 {n:101,ar:'القارعة',sq:'El-Karia',m:'Goditja e madhe',a:11,p:'Meke'},
 {n:102,ar:'التكاثر',sq:'Et-Tekathur',m:'Garimi per shumim',a:8,p:'Meke'},
 {n:103,ar:'العصر',sq:'El-Asr',m:'Koha',a:3,p:'Meke'},
 {n:104,ar:'الهمزة',sq:'El-Humeze',m:'Perqeshesi',a:9,p:'Meke'},
 {n:105,ar:'الفيل',sq:'El-Fil',m:'Elefanti',a:5,p:'Meke'},
 {n:106,ar:'قريش',sq:'Kurejsh',m:'Kurejshet',a:4,p:'Meke'},
 {n:107,ar:'الماعون',sq:'El-Maun',m:'Sendet e vogla',a:7,p:'Meke'},
 {n:108,ar:'الكوثر',sq:'El-Kevther',m:'Begatia e shumte',a:3,p:'Meke'},
 {n:109,ar:'الكافرون',sq:'El-Kafirun',m:'Mohuesit',a:6,p:'Meke'},
 {n:110,ar:'النصر',sq:'En-Nasr',m:'Ndihma',a:3,p:'Medine'},
 {n:111,ar:'المسد',sq:'El-Mesed',m:'Fijet e palmes',a:5,p:'Meke'},
 {n:112,ar:'الإخلاص',sq:'El-Ihlas',m:'Sinqeriteti',a:4,p:'Meke'},
 {n:113,ar:'الفلق',sq:'El-Felek',m:'Agimi',a:5,p:'Meke'},
 {n:114,ar:'الناس',sq:'En-Nas',m:'Njerezit',a:6,p:'Meke'}
];

const TOTAL_AYAHS=SURAHS.reduce(function(s,x){return s+x.a},0);
function getMeta(n){return SURAHS.find(function(s){return s.n===Number(n)})||null}

/* ---------- Marrja e tekstit te sures (rrjet + cache) ---------- */
const _memCache={};
async function getSurah(n,translationKey){
  n=Number(n);
  translationKey=translationKey||DEFAULT_TRANSLATION;
  const tr=TRANSLATIONS[translationKey]||TRANSLATIONS[DEFAULT_TRANSLATION];
  const cacheId='surah:'+n+':'+tr.id;
  if(_memCache[cacheId])return _memCache[cacheId];
  // 1) IndexedDB cache
  try{
    const stored=await global.XR_Storage.getQuranSurah(cacheId);
    if(stored&&stored.ayahs&&stored.ayahs.length){_memCache[cacheId]=stored;return stored}
  }catch(e){}
  // 2) Rrjeti
  if(navigator.onLine){
    try{
      const url=API_BASE+'/surah/'+n+'/editions/'+ARABIC_EDITION+','+tr.id;
      const ctrl=new AbortController();
      const tm=setTimeout(function(){ctrl.abort()},12000);
      const res=await fetch(url,{signal:ctrl.signal,cache:'force-cache'});
      clearTimeout(tm);
      if(res.ok){
        const j=await res.json();
        if(j&&j.data&&j.data.length>=2){
          const arEd=j.data.find(function(d){return d.edition.identifier===ARABIC_EDITION})||j.data[0];
          const trEd=j.data.find(function(d){return d.edition.identifier===tr.id})||j.data[1];
          const meta=getMeta(n)||{};
          const ayahs=arEd.ayahs.map(function(av,i){
            return{n:av.numberInSurah,ar:av.text,tr:(trEd.ayahs[i]&&trEd.ayahs[i].text)||'',sajda:!!av.sajda};
          });
          const rec={id:cacheId,number:n,translation:translationKey,ayahs:ayahs,savedAt:Date.now()};
          _memCache[cacheId]=rec;
          try{await global.XR_Storage.saveQuranSurah(rec)}catch(e){}
          return rec;
        }
      }
    }catch(e){}
  }
  // 3) Deshtim — kthe null qe UI te tregoje mesazh offline
  return null;
}

async function preloadSurah(n,translationKey){try{return await getSurah(n,translationKey)}catch(e){return null}}

/* Kerkimi: ne metadata gjithmone; ne tekst nese sureja eshte e ngarkuar/ruajtur. */
function norm(s){return String(s||'').toLowerCase().replace(/[\s\-'’.]/g,'')}
function searchMeta(q){
  q=(q||'').trim();
  if(!q)return SURAHS.slice();
  const nq=norm(q);
  const asNum=parseInt(q,10);
  return SURAHS.filter(function(s){
    if(!isNaN(asNum)&&s.n===asNum)return true;
    return norm(s.sq).indexOf(nq)>=0
        || norm(s.m).indexOf(nq)>=0
        || s.ar.indexOf(q)>=0;
  });
}

global.XR_Quran={
  SURAHS:SURAHS,TOTAL_AYAHS:TOTAL_AYAHS,TRANSLATIONS:TRANSLATIONS,DEFAULT_TRANSLATION:DEFAULT_TRANSLATION,
  RECITERS:RECITERS,DEFAULT_RECITER:DEFAULT_RECITER,
  getMeta:getMeta,getSurah:getSurah,preloadSurah:preloadSurah,searchMeta:searchMeta,
  surahAudioURL:surahAudioURL,API_BASE:API_BASE
};
})(window);
