/* =============================================================
 * app.js — Bootstrap: wire all modules together and hide splash
 * ============================================================= */

(function (global) {
  'use strict';

  const APP_VERSION = '1.0.0';

  function hideSplash() {
    const splash = document.getElementById('splash');
    const app = document.getElementById('app');
    if (splash) splash.classList.add('hide');
    if (app) app.classList.remove('hidden');
    setTimeout(() => { if (splash) splash.remove(); }, 600);
  }

  function setVersion() {
    const el = document.getElementById('appVersion');
    if (el) el.textContent = APP_VERSION;
  }

  function handleSWMessages() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const data = ev.data || {};
      if (data.type === 'PRAYER_FIRED') {
        if (global.XR_UI) global.XR_UI.refreshPrayerData();
      } else if (data.type === 'CACHE_UPDATED') {
        if (global.XR_UI) global.XR_UI.toast('Përmbajtja u rifreskua.', 'info', 1500);
      }
    });
  }

  async function start() {
    setVersion();

    // Boot UI first so the user sees content quickly
    try {
      await global.XR_UI.boot();
    } catch (e) {
      console.error('UI boot failed', e);
    }

    // Hide splash once UI is ready
    requestAnimationFrame(() => requestAnimationFrame(hideSplash));

    // Initialize notifications in the background
    try { await global.XR_Notifications.init(); } catch (e) { console.warn('Notifications init failed', e); }

    handleSWMessages();

    // Periodic background cleanup
    try { await global.XR_Storage.purgeOldPrayers(14); } catch (e) {}
    try { await global.XR_Storage.purgeFiredNotifications(); } catch (e) {}

    // Graceful error guard
    global.addEventListener('unhandledrejection', (ev) => {
      console.warn('unhandled rejection', ev.reason);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Safety: if start fails to hide splash within 6s, force-hide it.
  setTimeout(() => {
    const splash = document.getElementById('splash');
    if (splash && !splash.classList.contains('hide')) hideSplash();
  }, 6000);
})(window);
