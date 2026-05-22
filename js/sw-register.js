/* =============================================================
 * sw-register.js — Service Worker registration & update flow
 * ============================================================= */

(function (global) {
  'use strict';

  if (!('serviceWorker' in navigator)) {
    console.info('Service Worker not supported');
    return;
  }

  function notifyUpdate() {
    if (global.XR_UI && global.XR_UI.toast) {
      global.XR_UI.toast('Versioni i ri është gati. Ringarko për përditësim.', 'info', 4000);
    }
  }

  async function register() {
    try {
      const reg = await navigator.serviceWorker.register('service-worker.js', { scope: './' });
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            notifyUpdate();
          }
        });
      });

      // Try registering background / periodic sync (best-effort)
      try {
        if ('sync' in reg) await reg.sync.register('xr-prayer-refresh');
      } catch (e) {}
      try {
        if ('periodicSync' in reg) {
          await reg.periodicSync.register('xr-prayer-periodic', { minInterval: 12 * 60 * 60 * 1000 });
        }
      } catch (e) {}
    } catch (e) {
      console.warn('SW registration failed', e);
    }
  }

  // Register after page load to avoid contending with critical resources
  if (document.readyState === 'complete') register();
  else global.addEventListener('load', register);

  // Auto-reload only after explicit user action; here we just toast.
  let _refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_refreshing) return;
    _refreshing = true;
    // do nothing automatic — user-controlled reload via toast prompt
  });
})(window);
