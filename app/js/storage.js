/* =============================================================
 * storage.js — IndexedDB persistence layer
 * Stores: preferences, prayer cache, notification schedule
 * Falls back to localStorage if IndexedDB is unavailable.
 * ============================================================= */

(function (global) {
  'use strict';

  const DB_NAME = 'xhamia-ratkoc-db';
  const DB_VERSION = 1;
  const STORE_PREFS = 'preferences';
  const STORE_PRAYERS = 'prayerCache';
  const STORE_NOTIF = 'notifications';
  const STORE_META = 'meta';

  const DEFAULT_PREFS = Object.freeze({
    notificationsEnabled: false,
    adhanEnabled: false,
    hapticEnabled: true,
    prayerSource: 'bik',          // 'bik' | 'aladhan' | 'diyanet'
    theme: 'dark',                // 'dark' | 'soft' | 'light'
    location: {
      name: 'Ratkoc, Rahovec, Kosovo',
      lat: 42.3833,
      lng: 20.6500,
      tz: 'Europe/Belgrade'
    },
    lastSync: null,
    installDismissed: false
  });

  let dbPromise = null;
  let useFallback = false;
  const memCache = { prefs: null };

  function openDB() {
    if (dbPromise) return dbPromise;
    if (!('indexedDB' in global)) {
      useFallback = true;
      return Promise.resolve(null);
    }
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        useFallback = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_PREFS)) db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_PRAYERS)) db.createObjectStore(STORE_PRAYERS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_NOTIF)) db.createObjectStore(STORE_NOTIF, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { useFallback = true; resolve(null); };
      req.onblocked = () => { useFallback = true; resolve(null); };
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return openDB().then((db) => {
      if (!db) return null;
      try {
        const t = db.transaction(storeName, mode);
        return t.objectStore(storeName);
      } catch (e) {
        return null;
      }
    });
  }

  function lsKey(store, key) { return `xr.${store}.${key}`; }
  function lsGet(store, key) {
    try {
      const raw = localStorage.getItem(lsKey(store, key));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function lsSet(store, key, value) {
    try { localStorage.setItem(lsKey(store, key), JSON.stringify(value)); } catch (e) {}
  }
  function lsDel(store, key) { try { localStorage.removeItem(lsKey(store, key)); } catch (e) {} }

  /* ----- Generic helpers ----- */
  async function putRecord(store, value) {
    const s = await tx(store, 'readwrite');
    if (!s) { lsSet(store, value.key || value.id, value); return value; }
    return new Promise((resolve, reject) => {
      const req = s.put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => { lsSet(store, value.key || value.id, value); resolve(value); };
    });
  }

  async function getRecord(store, key) {
    const s = await tx(store, 'readonly');
    if (!s) return lsGet(store, key);
    return new Promise((resolve) => {
      const req = s.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(lsGet(store, key));
    });
  }

  async function getAll(store) {
    const s = await tx(store, 'readonly');
    if (!s) return [];
    return new Promise((resolve) => {
      const req = s.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function deleteRecord(store, key) {
    const s = await tx(store, 'readwrite');
    if (!s) { lsDel(store, key); return; }
    return new Promise((resolve) => {
      const req = s.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => { lsDel(store, key); resolve(); };
    });
  }

  async function clearStore(store) {
    const s = await tx(store, 'readwrite');
    if (!s) return;
    return new Promise((resolve) => {
      const req = s.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }

  /* ----- Preferences API ----- */
  async function getPrefs() {
    if (memCache.prefs) return { ...DEFAULT_PREFS, ...memCache.prefs };
    const rec = await getRecord(STORE_PREFS, 'main');
    const prefs = rec && rec.value ? { ...DEFAULT_PREFS, ...rec.value } : { ...DEFAULT_PREFS };
    memCache.prefs = prefs;
    return prefs;
  }

  async function setPrefs(partial) {
    const current = await getPrefs();
    const next = { ...current, ...partial };
    memCache.prefs = next;
    await putRecord(STORE_PREFS, { key: 'main', value: next });
    document.dispatchEvent(new CustomEvent('prefs:changed', { detail: next }));
    return next;
  }

  async function resetPrefs() {
    memCache.prefs = { ...DEFAULT_PREFS };
    await putRecord(STORE_PREFS, { key: 'main', value: { ...DEFAULT_PREFS } });
    document.dispatchEvent(new CustomEvent('prefs:changed', { detail: { ...DEFAULT_PREFS } }));
    return { ...DEFAULT_PREFS };
  }

  /* ----- Prayer cache API ----- */
  // record shape: { id: 'YYYY-MM-DD:source', date, source, times: {fajr,sunrise,dhuhr,asr,maghrib,isha}, hijri, location }
  async function savePrayerDay(record) {
    if (!record || !record.id) return;
    return putRecord(STORE_PRAYERS, { ...record, savedAt: Date.now() });
  }
  async function getPrayerDay(id) {
    return getRecord(STORE_PRAYERS, id);
  }
  async function getAllPrayers() {
    return getAll(STORE_PRAYERS);
  }
  async function purgeOldPrayers(daysToKeep = 14) {
    const all = await getAllPrayers();
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    for (const r of all) {
      if (!r.savedAt || r.savedAt < cutoff) await deleteRecord(STORE_PRAYERS, r.id);
    }
  }

  /* ----- Notifications schedule API ----- */
  // record shape: { id, prayer, fireAt, kind: 'pre10'|'pre5'|'onTime', fired }
  async function saveNotification(record) {
    if (!record || !record.id) return;
    return putRecord(STORE_NOTIF, record);
  }
  async function getPendingNotifications() {
    const all = await getAll(STORE_NOTIF);
    const now = Date.now();
    return all.filter((n) => !n.fired && n.fireAt > now).sort((a, b) => a.fireAt - b.fireAt);
  }
  async function markNotificationFired(id) {
    const rec = await getRecord(STORE_NOTIF, id);
    if (rec) {
      rec.fired = true;
      rec.firedAt = Date.now();
      await putRecord(STORE_NOTIF, rec);
    }
  }
  async function clearAllNotifications() {
    return clearStore(STORE_NOTIF);
  }
  async function purgeFiredNotifications() {
    const all = await getAll(STORE_NOTIF);
    for (const n of all) {
      if (n.fired && n.firedAt && (Date.now() - n.firedAt > 24 * 60 * 60 * 1000)) {
        await deleteRecord(STORE_NOTIF, n.id);
      }
    }
  }

  /* ----- Meta ----- */
  async function setMeta(key, value) {
    return putRecord(STORE_META, { key, value, ts: Date.now() });
  }
  async function getMeta(key) {
    const r = await getRecord(STORE_META, key);
    return r ? r.value : null;
  }

  /* ----- Reset all ----- */
  async function clearAll() {
    await clearStore(STORE_PREFS);
    await clearStore(STORE_PRAYERS);
    await clearStore(STORE_NOTIF);
    await clearStore(STORE_META);
    memCache.prefs = null;
    try {
      const keys = Object.keys(localStorage);
      keys.filter((k) => k.startsWith('xr.')).forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  }

  global.XR_Storage = {
    DEFAULT_PREFS,
    getPrefs,
    setPrefs,
    resetPrefs,
    savePrayerDay,
    getPrayerDay,
    getAllPrayers,
    purgeOldPrayers,
    saveNotification,
    getPendingNotifications,
    markNotificationFired,
    clearAllNotifications,
    purgeFiredNotifications,
    setMeta,
    getMeta,
    clearAll
  };
})(window);
