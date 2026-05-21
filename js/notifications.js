/* =============================================================
 * notifications.js — Prayer-time notifications & Adhan playback
 *
 * Features:
 *   - Permission management (Web Notifications API)
 *   - Schedule via Service Worker (showNotification) when available
 *   - In-page fallback if SW is not active
 *   - Pre-10, Pre-5, on-time notifications
 *   - Adhan audio playback (generated tone fallback if no audio file)
 *   - Persistent IndexedDB schedule (rebuilt at startup & rolling)
 *   - Background Sync registration when supported
 * ============================================================= */

(function (global) {
  'use strict';

  const KIND_LABELS = {
    pre10: 'pas 10 minutash',
    pre5: 'pas 5 minutash',
    onTime: 'tani'
  };

  const _runtime = {
    timers: new Map(),       // notificationId -> timeoutId
    adhanContext: null,      // WebAudio context lazily created
    adhanAudio: null,        // <audio> element (real file)
    initialized: false
  };

  /* ---------- Permission ---------- */
  function getPermission() {
    if (!('Notification' in global)) return 'unsupported';
    return Notification.permission;
  }

  async function requestPermission() {
    if (!('Notification' in global)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const p = await Notification.requestPermission();
      return p;
    } catch (e) {
      return 'denied';
    }
  }

  /* ---------- Vibration helper ---------- */
  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {}
  }

  /* ---------- Adhan playback ---------- */
  // We attempt to load a real adhan file from assets/audio/adhan.mp3 if present.
  // If not, we synthesize a short, dignified tone sequence via WebAudio.
  function _ensureAdhanAudio() {
    if (_runtime.adhanAudio) return _runtime.adhanAudio;
    try {
      const a = new Audio('assets/audio/adhan.mp3');
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      _runtime.adhanAudio = a;
      return a;
    } catch (e) {
      return null;
    }
  }

  function _playFallbackTone() {
    try {
      const Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return;
      const ctx = _runtime.adhanContext || new Ctor();
      _runtime.adhanContext = ctx;
      const now = ctx.currentTime;
      const notes = [
        { f: 392.0, t: 0.0, d: 0.8 },  // G4
        { f: 523.25, t: 0.9, d: 0.7 }, // C5
        { f: 659.25, t: 1.7, d: 1.0 }, // E5
        { f: 523.25, t: 2.8, d: 0.8 }, // C5
        { f: 392.0,  t: 3.7, d: 1.4 }  // G4
      ];
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      master.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 5.5);
      notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = n.f;
        g.gain.value = 0.0001;
        g.gain.exponentialRampToValueAtTime(0.4, now + n.t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
        osc.connect(g).connect(master);
        osc.start(now + n.t);
        osc.stop(now + n.t + n.d + 0.05);
      });
    } catch (e) {}
  }

  async function playAdhan() {
    const a = _ensureAdhanAudio();
    if (a) {
      try {
        a.currentTime = 0;
        await a.play();
        return true;
      } catch (e) {
        // Autoplay blocked or no file — fallback
      }
    }
    _playFallbackTone();
    return true;
  }

  function stopAdhan() {
    try { if (_runtime.adhanAudio) { _runtime.adhanAudio.pause(); _runtime.adhanAudio.currentTime = 0; } } catch (e) {}
    try {
      if (_runtime.adhanContext) {
        _runtime.adhanContext.close();
        _runtime.adhanContext = null;
      }
    } catch (e) {}
  }

  /* ---------- Notification show ---------- */
  async function _showNotification(title, body, tag, data) {
    const payload = {
      body,
      icon: 'assets/icons/icon-192.png',
      badge: 'assets/icons/icon-192.png',
      tag,
      data,
      vibrate: [100, 50, 100],
      requireInteraction: false
    };
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, payload);
        return true;
      } catch (e) {}
    }
    try {
      if ('Notification' in global && Notification.permission === 'granted') {
        const n = new Notification(title, payload);
        n.onclick = () => { try { global.focus(); n.close(); } catch (e) {} };
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ---------- Scheduling ---------- */
  function _id(dayKey, prayer, kind) {
    return `${dayKey}:${prayer}:${kind}`;
  }

  function _kindOffsetMs(kind) {
    if (kind === 'pre10') return -10 * 60 * 1000;
    if (kind === 'pre5') return -5 * 60 * 1000;
    return 0;
  }

  function _composeMessage(prayer, kind) {
    const label = (global.XR_Prayer && global.XR_Prayer.PRAYER_LABELS[prayer]) || prayer;
    if (kind === 'pre10') return { title: `${label} – afrohet`, body: `Koha e ${label.toLowerCase()} hyn pas 10 minutash.` };
    if (kind === 'pre5')  return { title: `${label} – afrohet`, body: `Edhe 5 minuta deri në kohën e ${label.toLowerCase()}.` };
    return { title: `Hyri koha e ${label.toLowerCase()}`, body: 'Allahu Ekber! Eja për namaz.' };
  }

  async function _clearTimers() {
    for (const id of _runtime.timers.keys()) {
      clearTimeout(_runtime.timers.get(id));
    }
    _runtime.timers.clear();
  }

  async function _scheduleOne(rec, prefs) {
    const delay = rec.fireAt - Date.now();
    if (delay < 0) return; // past
    if (delay > 24 * 60 * 60 * 1000 + 60 * 1000) return; // > 24h, will be rescheduled next day
    const tid = setTimeout(async () => {
      try {
        const msg = _composeMessage(rec.prayer, rec.kind);
        await _showNotification(msg.title, msg.body, rec.id, { prayer: rec.prayer, kind: rec.kind });
        vibrate(rec.kind === 'onTime' ? [180, 80, 180, 80, 180] : [120, 60, 120]);
        if (rec.kind === 'onTime' && prefs.adhanEnabled) {
          playAdhan();
        }
        await global.XR_Storage.markNotificationFired(rec.id);
        document.dispatchEvent(new CustomEvent('prayer:fired', { detail: { rec } }));
      } catch (e) {}
    }, delay);
    _runtime.timers.set(rec.id, tid);
  }

  async function scheduleForDay(date) {
    const prefs = await global.XR_Storage.getPrefs();
    if (!global.XR_Prayer) return;
    const today = await global.XR_Prayer.getForDate(date);
    const dayKey = global.XR_Prayer.ymd(date);
    const order = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    const day0 = new Date(date); day0.setHours(0, 0, 0, 0);

    for (const p of order) {
      const dt = global.XR_Prayer.parseTimeToDate(day0, today.times[p]);
      if (!dt) continue;
      for (const kind of ['pre10', 'pre5', 'onTime']) {
        const fireAt = dt.getTime() + _kindOffsetMs(kind);
        if (fireAt < Date.now() - 60_000) continue; // skip past with 1m grace
        const id = _id(dayKey, p, kind);
        const existing = (await global.XR_Storage.getPendingNotifications()).find((n) => n.id === id);
        const rec = existing || { id, prayer: p, kind, fireAt, fired: false, source: today.source };
        rec.fireAt = fireAt;
        rec.fired = false;
        await global.XR_Storage.saveNotification(rec);
        if (prefs.notificationsEnabled) {
          await _scheduleOne(rec, prefs);
        }
      }
    }
  }

  async function rebuildSchedule() {
    await _clearTimers();
    await global.XR_Storage.purgeFiredNotifications();
    const today = new Date();
    await scheduleForDay(today);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await scheduleForDay(tomorrow);
    // Re-attach in-memory timers for any persisted but un-fired notifications
    const pending = await global.XR_Storage.getPendingNotifications();
    const prefs = await global.XR_Storage.getPrefs();
    if (prefs.notificationsEnabled) {
      for (const rec of pending) {
        if (!_runtime.timers.has(rec.id)) await _scheduleOne(rec, prefs);
      }
    }
  }

  async function disableAll() {
    await _clearTimers();
    await global.XR_Storage.clearAllNotifications();
  }

  async function enable() {
    const perm = await requestPermission();
    if (perm !== 'granted') return perm;
    await global.XR_Storage.setPrefs({ notificationsEnabled: true });
    await rebuildSchedule();
    // Try background sync if supported
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        if (reg.sync) await reg.sync.register('xr-prayer-refresh');
      }
      if ('serviceWorker' in navigator && 'periodicSync' in (await navigator.serviceWorker.ready)) {
        const reg = await navigator.serviceWorker.ready;
        try {
          await reg.periodicSync.register('xr-prayer-periodic', { minInterval: 12 * 60 * 60 * 1000 });
        } catch (e) {}
      }
    } catch (e) {}
    return 'granted';
  }

  async function disable() {
    await global.XR_Storage.setPrefs({ notificationsEnabled: false });
    await _clearTimers();
  }

  async function testNotification() {
    const ok = await _showNotification('Xhamia Ratkoc', 'Njoftim provë – sistemi funksionon.', 'test', {});
    vibrate([60, 40, 60]);
    return ok;
  }

  /* ---------- Init / event wiring ---------- */
  async function init() {
    if (_runtime.initialized) return;
    _runtime.initialized = true;
    // Rebuild whenever prefs change or visibility returns
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') rebuildSchedule();
    });
    document.addEventListener('prefs:changed', () => rebuildSchedule());
    document.addEventListener('prayer:source-changed', () => rebuildSchedule());
    global.addEventListener('online', () => rebuildSchedule());

    // Pre-cache adhan audio element
    _ensureAdhanAudio();

    // Initial schedule
    await rebuildSchedule();
  }

  global.XR_Notifications = {
    getPermission,
    requestPermission,
    enable,
    disable,
    rebuildSchedule,
    disableAll,
    testNotification,
    playAdhan,
    stopAdhan,
    vibrate,
    init
  };
})(window);
