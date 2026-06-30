/* daily-content.js — Hadithi/Ajeti i orës (ndryshon çdo orë, vetë-fillues).
 * Lista mund të zgjerohet/redaktohet lirisht nga imami — vetëm shto objekte në POOL.
 * type: 'hadith' ose 'ajet'. */
(function(global){
'use strict';

const POOL=[
  {type:'hadith',text:'Vërtet, veprat vlerësohen sipas qëllimeve, dhe çdo njeriu i takon ajo që ka për qëllim.',src:'Transmetojnë Buhariu dhe Muslimi'},
  {type:'ajet',text:'Vërtet, pas vështirësisë vjen lehtësimi.',src:'Kurani · El-Inshirah, 6'},
  {type:'hadith',text:'Asnjëri prej jush nuk beson me të vërtetë derisa të dojë për vëllanë e tij atë që e do për veten.',src:'Transmetojnë Buhariu dhe Muslimi'},
  {type:'ajet',text:'Më kujtoni Mua, që Unë t’ju kujtoj juve, dhe më falënderoni e mos më mohoni.',src:'Kurani · El-Bekare, 152'},
  {type:'hadith',text:'Myslimani është ai nga gjuha dhe dora e të cilit janë të sigurt myslimanët e tjerë.',src:'Transmetojnë Buhariu dhe Muslimi'},
  {type:'ajet',text:'Mos e humbni shpresën nga mëshira e Allahut; vërtet, Allahu i fal të gjitha mëkatet.',src:'Kurani · Ez-Zumer, 53'},
  {type:'hadith',text:'Kush beson në Allahun dhe në Ditën e Fundit, le të flasë mirë ose le të heshtë.',src:'Transmetojnë Buhariu dhe Muslimi'},
  {type:'ajet',text:'Vërtet, me të përmendur Allahun, zemrat qetësohen.',src:'Kurani · Er-Ra’d, 28'},
  {type:'hadith',text:'Më i miri prej jush është ai që e mëson Kuranin dhe ua mëson të tjerëve.',src:'Transmeton Buhariu'},
  {type:'ajet',text:'Allahu nuk e ngarkon askënd përtej mundësive të tij.',src:'Kurani · El-Bekare, 286'},
  {type:'hadith',text:'Pastërtia është gjysma e besimit.',src:'Transmeton Muslimi'},
  {type:'ajet',text:'Kur robërit e Mi të pyesin për Mua, Unë jam afër; i përgjigjem lutjes së lutësit kur më lutet.',src:'Kurani · El-Bekare, 186'},
  {type:'hadith',text:'Frikësoju Allahut kudo që të jesh, pas së keqes bëj një të mirë që ta fshijë atë, dhe sillu me njerëzit me moral të mirë.',src:'Transmeton Tirmidhiu'},
  {type:'ajet',text:'Vërtet, Allahu urdhëron drejtësinë, bamirësinë dhe ndihmën ndaj të afërmve.',src:'Kurani · En-Nahl, 90'},
  {type:'hadith',text:'I forti nuk është ai që mund të tjerët, por i forti është ai që e përmban veten kur zemërohet.',src:'Transmetojnë Buhariu dhe Muslimi'},
  {type:'ajet',text:'Kush i frikësohet Allahut, Ai do t’i japë rrugëdalje dhe do ta furnizojë prej nga nuk e pret.',src:'Kurani · Et-Talak, 2-3'},
  {type:'hadith',text:'Mëshironi ata që janë në tokë, që t’ju mëshirojë Ai që është mbi qiell.',src:'Transmeton Tirmidhiu'},
  {type:'hadith',text:'Fjala e mirë është sadaka.',src:'Transmetojnë Buhariu dhe Muslimi'},
  {type:'hadith',text:'Buzëqeshja jote ndaj vëllait tënd është sadaka.',src:'Transmeton Tirmidhiu'},
  {type:'hadith',text:'Feja është këshillë (sinqeritet).',src:'Transmeton Muslimi'},
  {type:'hadith',text:'Kush ndjek një rrugë për të kërkuar dije, Allahu ia lehtëson atij rrugën për në Xhennet.',src:'Transmeton Muslimi'},
  {type:'hadith',text:'Allahu nuk shikon pamjen e as pasurinë tuaj, por shikon zemrat dhe veprat tuaja.',src:'Transmeton Muslimi'},
  {type:'hadith',text:'Gjëja më e rëndë në peshore në Ditën e Gjykimit është morali i mirë.',src:'Transmeton Tirmidhiu'},
  {type:'hadith',text:'Bamirësia nuk e pakëson pasurinë.',src:'Transmeton Muslimi'},
  {type:'hadith',text:'Kush nuk i falënderon njerëzit, nuk e ka falënderuar Allahun.',src:'Transmeton Tirmidhiu'},
  {type:'hadith',text:'Lutja (duaja) është thelbi i adhurimit.',src:'Transmeton Tirmidhiu'},
  {type:'hadith',text:'Çdo bir i Ademit gabon, e më të mirët e gabimtarëve janë ata që pendohen.',src:'Transmeton Tirmidhiu'},
  {type:'ajet',text:'Dhe thuaj: O Zoti im, shtoma dijen!',src:'Kurani · Ta-Ha, 114'},
  {type:'ajet',text:'Vërtet, Allahu është me ata që janë të durueshëm.',src:'Kurani · El-Bekare, 153'},
  {type:'hadith',text:'Kush e lehtëson hallin e një besimtari, Allahu do t’ia lehtësojë hallet e Ditës së Gjykimit.',src:'Transmeton Muslimi'}
];

function dayOfYear(d){const s=new Date(d.getFullYear(),0,0);return Math.floor((d-s)/86400000)}
function current(){
  const now=new Date();
  const idx=((dayOfYear(now)*24+now.getHours())%POOL.length+POOL.length)%POOL.length;
  return{item:POOL[idx],hour:now.getHours()};
}
function pad(n){return String(n).padStart(2,'0')}

let _lastHour=-1;
function render(force){
  const c=current();
  if(!force&&c.hour===_lastHour)return;
  _lastHour=c.hour;
  const kicker=document.getElementById('dailyKicker');
  const text=document.getElementById('dailyText');
  const src=document.getElementById('dailySource');
  const time=document.getElementById('dailyTime');
  if(!text)return;
  if(kicker)kicker.textContent=c.item.type==='ajet'?'Ajeti i orës':'Hadithi i orës';
  if(text){text.style.opacity='0';setTimeout(function(){text.textContent='“'+c.item.text+'”';text.style.transition='opacity .4s ease';text.style.opacity='1'},120)}
  if(src)src.textContent=c.item.src;
  if(time)time.textContent=pad(c.hour)+':00';
}
function start(){render(true);setInterval(function(){render(false)},60000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();

global.XR_Daily={POOL:POOL,current:current,render:render};
})(window);
