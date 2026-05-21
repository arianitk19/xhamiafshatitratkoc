/* =============================================================
 * prayer-engine.js — Prayer time calculation & retrieval
 *
 * Sources:
 *   - 'bik'      → BIK Kosovo (uses Aladhan with Karachi method, Hanafi asr,
 *                  europe/belgrade tz — closely matches BIK calendar). Local
 *                  built-in fallback table is used when offline.
 *   - 'aladhan'  → Aladhan API (method 13 / Diyanet base, MWL fallback)
 *   - 'diyanet'  → Diyanet (Turkey) calculation via Aladhan (method 13)
 *
 * All sources gracefully fall back to:
 *   1. IndexedDB cache (last synced day for same source)
 *   2. Built-in astronomical computation (no network needed)
 *
 * Public API: window.XR_Prayer.{ getForDate, getToday, nextPrayer, currentPrayer,
 *   setSource, getSource, formatTime, formatCountdown, computeFallback }
 * ============================================================= */

(function (global) {
  'use strict';

  const PRAYER_NAMES = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const PRAYER_LABELS = {
    Fajr: 'Sabahu',
    Sunrise: 'Lindja e diellit',
    Dhuhr: 'Dreka',
    Asr: 'Ikindia',
    Maghrib: 'Akshami',
    Isha: 'Jacia'
  };

  const SOURCES = {
    bik: {
      label: 'BIK',
      // BIK calendar in practice aligns closely with Diyanet/Aladhan method 13
      // with Hanafi asr juristic mode for Kosovo. We use this as a parameter set.
      method: 13,
      school: 1, // Hanafi
      timezone: 'Europe/Belgrade'
    },
    aladhan: {
      label: 'Aladhan',
      method: 3, // Muslim World League
      school: 0,
      timezone: 'Europe/Belgrade'
    },
    diyanet: {
      label: 'Diyanet',
      method: 13, // Diyanet İşleri Başkanlığı, Turkey
      school: 0,
      timezone: 'Europe/Belgrade'
    }
  };

  let currentSource = 'bik';

  function setSource(src) {
    if (SOURCES[src]) currentSource = src;
  }
  function getSource() { return currentSource; }

  function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function parseTimeToDate(baseDate, hhmm) {
    if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return null;
    const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
    const dt = new Date(baseDate);
    dt.setHours(h, m, 0, 0);
    return dt;
  }

  function formatTime(date) {
    if (!date) return '--:--';
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatCountdown(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(m)}:${pad2(s)}`;
  }

  /* =====================================================
     Astronomical fallback (Spencer's formulas + general method)
     Used when network is unavailable and no cache exists.
     ===================================================== */
  function _toRad(d) { return d * Math.PI / 180; }
  function _toDeg(r) { return r * 180 / Math.PI; }
  function _normHr(h) { return ((h % 24) + 24) % 24; }

  function _julianDay(year, month, day) {
    if (month <= 2) { year -= 1; month += 12; }
    const A = Math.floor(year / 100);
    const B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
  }

  function _sunPosition(jd) {
    const D = jd - 2451545.0;
    const g = _toRad((357.529 + 0.98560028 * D) % 360);
    const q = (280.459 + 0.98564736 * D) % 360;
    const L = _toRad((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360);
    const e = _toRad(23.439 - 0.00000036 * D);
    const RA = _toDeg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))) / 15;
    const decl = _toDeg(Math.asin(Math.sin(e) * Math.sin(L)));
    const EqT = q / 15 - _normHr(RA);
    return { decl, EqT };
  }

  function _computeTime(jd, lat, lng, angle, direction /* 'before'|'after' */, baseHours) {
    // Iterative method: re-evaluate sun position at the estimated time
    let t = baseHours / 24;
    for (let i = 0; i < 3; i++) {
      const sp = _sunPosition(jd + t);
      const cosH = (-Math.sin(_toRad(angle)) - Math.sin(_toRad(lat)) * Math.sin(_toRad(sp.decl))) /
                   (Math.cos(_toRad(lat)) * Math.cos(_toRad(sp.decl)));
      if (cosH > 1 || cosH < -1) return null;
      const H = _toDeg(Math.acos(cosH)) / 15;
      const noon = 12 - sp.EqT - lng / 15;
      const time = direction === 'before' ? noon - H : noon + H;
      t = time / 24;
    }
    return _normHr(t * 24);
  }

  function _asrTime(jd, lat, lng, factor /* 1=Shafi, 2=Hanafi */) {
    let t = 13 / 24;
    for (let i = 0; i < 3; i++) {
      const sp = _sunPosition(jd + t);
      const A = factor + Math.tan(_toRad(Math.abs(lat - sp.decl)));
      const angle = -_toDeg(Math.atan(1 / A));
      const cosH = (-Math.sin(_toRad(angle)) - Math.sin(_toRad(lat)) * Math.sin(_toRad(sp.decl))) /
                   (Math.cos(_toRad(lat)) * Math.cos(_toRad(sp.decl)));
      if (cosH > 1 || cosH < -1) return null;
      const H = _toDeg(Math.acos(cosH)) / 15;
      const noon = 12 - sp.EqT - lng / 15;
      t = (noon + H) / 24;
    }
    return _normHr(t * 24);
  }

  function _hoursToHHMM(hrs, tzOffsetHours) {
    if (hrs == null) return null;
    const h = hrs + tzOffsetHours;
    const norm = _normHr(h);
    const hh = Math.floor(norm);
    const mm = Math.round((norm - hh) * 60);
    let H = hh, M = mm;
    if (M === 60) { M = 0; H = (H + 1) % 24; }
    return `${pad2(H)}:${pad2(M)}`;
  }

  function computeFallback(date, lat, lng, source) {
    // Get TZ offset (hours) for the location's TZ on this date.
    // We use the browser's local TZ as a pragmatic approximation; for Kosovo
    // (Europe/Belgrade) when running locally this is accurate. For other zones,
    // we keep the formula in UTC and then shift by the user's local offset.
    const tzOffset = -date.getTimezoneOffset() / 60;
    const jd = _julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate());

    const fajrAngle = source === 'aladhan' ? 18 : 18; // MWL & Diyanet both use 18° fajr
    const ishaAngle = source === 'aladhan' ? 17 : 17; // MWL: 17°
    const asrFactor = SOURCES[source] && SOURCES[source].school === 1 ? 2 : 1;

    const fajrH = _computeTime(jd, lat, lng, fajrAngle, 'before', 5);
    const sunriseH = _computeTime(jd, lat, lng, 0.833, 'before', 6);
    const dhuhrH = (function () {
      const sp = _sunPosition(jd + 0.5);
      return _normHr(12 - sp.EqT - lng / 15) + (1 / 60); // small delay
    })();
    const asrH = _asrTime(jd, lat, lng, asrFactor);
    const maghribH = _computeTime(jd, lat, lng, 0.833, 'after', 18);
    const ishaH = _computeTime(jd, lat, lng, ishaAngle, 'after', 19);

    return {
      Fajr: _hoursToHHMM(fajrH, tzOffset),
      Sunrise: _hoursToHHMM(sunriseH, tzOffset),
      Dhuhr: _hoursToHHMM(dhuhrH, tzOffset),
      Asr: _hoursToHHMM(asrH, tzOffset),
      Maghrib: _hoursToHHMM(maghribH, tzOffset),
      Isha: _hoursToHHMM(ishaH, tzOffset)
    };
  }

  /* =====================================================
     Hijri date calculation (Umm al-Qura approximation)
     ===================================================== */
  function gregorianToHijri(date) {
    // Kuwaiti algorithm
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    let jd = _julianDay(year, month, day) + 0.5;
    jd = Math.floor(jd);
    const l = jd - 1948440 + 10632;
    const n = Math.floor((l - 1) / 10631);
    const l2 = l - 10631 * n + 354;
    const j = (Math.floor((10985 - l2) / 5316)) * (Math.floor((50 * l2) / 17719))
            + (Math.floor(l2 / 5670)) * (Math.floor((43 * l2) / 15238));
    const l3 = l2 - (Math.floor((30 - j) / 15)) * (Math.floor((17719 * j) / 50))
                  - (Math.floor(j / 16)) * (Math.floor((15238 * j) / 43)) + 29;
    const monthH = Math.floor((24 * l3) / 709);
    const dayH = l3 - Math.floor((709 * monthH) / 24);
    const yearH = 30 * n + j - 30;
    return { day: dayH, month: monthH, year: yearH };
  }

  const HIJRI_MONTHS_SQ = [
    'Muharrem', 'Safer', 'Rebiul-Evvel', 'Rebiul-Ahir',
    'Xhumadel-Ula', 'Xhumadel-Ahire', 'Rexheb', 'Shaban',
    'Ramazan', 'Sheval', 'Dhul-Kade', 'Dhul-Hixhe'
  ];

  function formatHijriSq(h) {
    if (!h) return '';
    return `${h.day} ${HIJRI_MONTHS_SQ[h.month - 1]} ${h.year} h.`;
  }

  /* =====================================================
     Network fetching via Aladhan API (used for all sources)
     Endpoint: https://api.aladhan.com/v1/timings/{DD-MM-YYYY}
     ===================================================== */
  function buildAladhanURL(date, lat, lng, methodId, school, tz) {
    const day = pad2(date.getDate());
    const month = pad2(date.getMonth() + 1);
    const year = date.getFullYear();
    const url = new URL(`https://api.aladhan.com/v1/timings/${day}-${month}-${year}`);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('method', String(methodId));
    url.searchParams.set('school', String(school));
    if (tz) url.searchParams.set('timezonestring', tz);
    url.searchParams.set('iso8601', 'false');
    return url.toString();
  }

  async function fetchFromNetwork(date, prefs, source) {
    const cfg = SOURCES[source];
    if (!cfg) return null;
    const url = buildAladhanURL(date, prefs.location.lat, prefs.location.lng, cfg.method, cfg.school, prefs.location.tz || cfg.timezone);
    try {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
      clearTimeout(tm);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || !json.data || !json.data.timings) return null;
      const t = json.data.timings;
      const stripTz = (s) => (typeof s === 'string' ? s.split(' ')[0] : s);
      return {
        Fajr: stripTz(t.Fajr),
        Sunrise: stripTz(t.Sunrise),
        Dhuhr: stripTz(t.Dhuhr),
        Asr: stripTz(t.Asr),
        Maghrib: stripTz(t.Maghrib),
        Isha: stripTz(t.Isha),
        meta: json.data.meta || null,
        date: json.data.date || null
      };
    } catch (e) {
      return null;
    }
  }

  /* =====================================================
     Main entry: getForDate
     ===================================================== */
  async function getForDate(date) {
    const prefs = await global.XR_Storage.getPrefs();
    const source = currentSource || prefs.prayerSource || 'bik';
    const id = `${ymd(date)}:${source}`;

    // 1) Try network
    let times = null;
    let networkOK = false;
    if (navigator.onLine) {
      times = await fetchFromNetwork(date, prefs, source);
      if (times) networkOK = true;
    }

    // 2) Try cache
    if (!times) {
      const cached = await global.XR_Storage.getPrayerDay(id);
      if (cached && cached.times) {
        times = cached.times;
      }
    }

    // 3) Fallback to local astronomy
    if (!times) {
      times = computeFallback(date, prefs.location.lat, prefs.location.lng, source);
    }

    const hijri = gregorianToHijri(date);
    const record = {
      id,
      date: ymd(date),
      source,
      times: {
        Fajr: times.Fajr,
        Sunrise: times.Sunrise,
        Dhuhr: times.Dhuhr,
        Asr: times.Asr,
        Maghrib: times.Maghrib,
        Isha: times.Isha
      },
      hijri,
      hijriSq: formatHijriSq(hijri),
      location: prefs.location,
      computed: !networkOK
    };

    if (networkOK) {
      try { await global.XR_Storage.savePrayerDay(record); } catch (e) {}
      try { await global.XR_Storage.setPrefs({ lastSync: Date.now() }); } catch (e) {}
    }
    return record;
  }

  async function getToday() {
    return getForDate(new Date());
  }

  /* =====================================================
     Next / current prayer logic
     ===================================================== */
  function _orderedPrayers() {
    // Sunrise is shown but is NOT a prayer; we keep it informational.
    return ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  }

  function currentAndNext(record, now) {
    if (!record) return { current: null, next: null };
    now = now || new Date();
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);

    const order = _orderedPrayers();
    const entries = order.map((k) => ({
      key: k,
      label: PRAYER_LABELS[k],
      date: parseTimeToDate(today0, record.times[k])
    })).filter((e) => e.date);

    let current = null;
    let next = null;

    for (let i = 0; i < entries.length; i++) {
      if (now < entries[i].date) {
        next = entries[i];
        current = i > 0 ? entries[i - 1] : { ...entries[entries.length - 1], previousDay: true };
        break;
      }
    }
    if (!next) {
      // After Isha — next is tomorrow's Fajr
      current = entries[entries.length - 1];
      next = { key: 'Fajr', label: PRAYER_LABELS.Fajr, date: null, tomorrow: true };
    }
    return { current, next };
  }

  async function nextPrayer(now) {
    const today = await getToday();
    const cn = currentAndNext(today, now);
    if (cn.next && cn.next.tomorrow) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const tomorrow = await getForDate(t);
      const t0 = new Date(t); t0.setHours(0, 0, 0, 0);
      const d = parseTimeToDate(t0, tomorrow.times.Fajr);
      cn.next = { key: 'Fajr', label: PRAYER_LABELS.Fajr, date: d, tomorrow: true };
    }
    return cn.next;
  }

  async function currentPrayer(now) {
    const today = await getToday();
    return currentAndNext(today, now).current;
  }

  global.XR_Prayer = {
    PRAYER_NAMES,
    PRAYER_LABELS,
    SOURCES,
    setSource,
    getSource,
    getForDate,
    getToday,
    nextPrayer,
    currentPrayer,
    currentAndNext,
    formatTime,
    formatCountdown,
    computeFallback,
    parseTimeToDate,
    gregorianToHijri,
    formatHijriSq,
    ymd
  };
})(window);
