/* =============================================================
 * ui-controller.js — UI orchestration: navigation, real-time clock,
 * prayer rendering, settings, gallery, toasts, install banner.
 * ============================================================= */

(function (global) {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    activeTab: 'xhamia',
    prefs: null,
    today: null,
    nextPrayerDate: null,
    nextPrayerKey: null,
    currentPrayerKey: null,
    timers: { clock: null, refresh: null },
    deferredInstallPrompt: null,
    gallery: {
      images: [],
      currentIndex: 0,
      touchStartX: 0,
      touchEndX: 0,
      touchStartY: 0,
      touchEndY: 0,
      touchStartTime: 0,
      moved: false
    }
  };

  /* ------------------ HAPTIC ------------------ */
  function tinyHaptic() {
    if (!state.prefs || state.prefs.hapticEnabled === false) return;
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
  }
  function pulseHaptic() {
    if (!state.prefs || state.prefs.hapticEnabled === false) return;
    try { if (navigator.vibrate) navigator.vibrate([14, 20, 14]); } catch (e) {}
  }

  /* ------------------ TOAST ------------------ */
  function toast(message, kind = 'info', duration = 2600) {
    const host = $('#toastHost');
    if (!host) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const icon = kind === 'success' ? '✓' : kind === 'error' ? '!' : '·';
    el.innerHTML = `<span class="opacity-70">${icon}</span><span>${escapeHtml(message)}</span>`;
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  /* ------------------ NAVIGATION ------------------ */
  function setTab(tabName, opts = {}) {
    if (!tabName) return;
    if (state.activeTab === tabName && !opts.force) return;
    state.activeTab = tabName;
    $$('#bottomNav .nav-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tabName);
    });
    $$('.tab-panel').forEach((p) => {
      const match = p.getAttribute('data-tab') === tabName;
      p.classList.toggle('hidden', !match);
    });
    const panel = $(`#tab-${tabName}`);
    if (panel) {
      panel.style.animation = 'none';
      void panel.offsetWidth;
      panel.style.animation = '';
    }
    tinyHaptic();
    try {
      const url = new URL(global.location.href);
      url.searchParams.set('tab', tabName);
      history.replaceState(null, '', url.toString());
    } catch (e) {}
    if (tabName === 'galeria') ensureGalleryRendered();
    if (tabName === 'namazi') refreshPrayerView();
    if (tabName === 'xhamia') refreshHomeView();
  }

  function wireNav() {
    $$('#bottomNav .nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.getAttribute('data-tab')));
    });
    $$('.quick-action').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.getAttribute('data-goto')));
    });
  }

  /* ------------------ CLOCK & DATE ------------------ */
  const SQ_WEEKDAYS = ['e Diel', 'e Hënë', 'e Martë', 'e Mërkurë', 'e Enjte', 'e Premte', 'e Shtunë'];
  const SQ_MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function renderClock() {
    const now = new Date();
    const el = $('#clock');
    if (el) el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const dg = $('#dateGregorian');
    if (dg) dg.textContent = `${SQ_WEEKDAYS[now.getDay()]} · ${now.getDate()} ${SQ_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    if (state.today && state.today.hijriSq) {
      const dh = $('#dateHijri'); if (dh) dh.textContent = state.today.hijriSq;
      const ph = $('#prayerHijriLabel'); if (ph) ph.textContent = state.today.hijriSq;
    }
    const pd = $('#prayerDateLabel');
    if (pd) pd.textContent = `${SQ_WEEKDAYS[now.getDay()]} · ${now.getDate()} ${SQ_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    updateCountdowns(now);
  }

  function updateCountdowns(now) {
    if (!state.nextPrayerDate) return;
    const remainingMs = state.nextPrayerDate.getTime() - now.getTime();
    const fmt = global.XR_Prayer.formatCountdown(remainingMs);
    const c1 = $('#nextPrayerCountdown'); if (c1) c1.textContent = `Mbetet ${fmt}`;
    const c2 = $('#currentPrayerCountdown'); if (c2) c2.textContent = fmt;
    if (state.currentPrayerDate && state.nextPrayerDate && state.currentPrayerDate < state.nextPrayerDate) {
      const total = state.nextPrayerDate - state.currentPrayerDate;
      const done = Math.max(0, Math.min(total, now - state.currentPrayerDate));
      const pct = Math.round((done / total) * 100);
      const bar = $('#nextPrayerProgress'); if (bar) bar.style.width = `${pct}%`;
    }
    if (remainingMs <= 0) {
      scheduleSoon(800);
    }
  }

  /* ------------------ PRAYER VIEW ------------------ */
  const PRAYER_ICONS = {
    Fajr: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.5 5.5 4 4M20 20l-1.5-1.5M5.5 18.5 4 20M20 4l-1.5 1.5"/></svg>`,
    Sunrise: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 18h18"/><path d="M5 14a7 7 0 0114 0"/><path d="M12 4v3M5 7l2 2M19 7l-2 2"/></svg>`,
    Dhuhr: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.5 5.5 4 4M20 20l-1.5-1.5M5.5 18.5 4 20M20 4l-1.5 1.5"/></svg>`,
    Asr: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M3 17h2M19 17h2M5 13l-1.5 1.5M20.5 14.5 19 13"/></svg>`,
    Maghrib: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 18h18"/><path d="M5 14a7 7 0 0114 0"/><path d="M12 4v3"/><path d="m6 21 3-3M18 21l-3-3"/></svg>`,
    Isha: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`
  };

  function _orderedKeys() { return ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']; }

  function renderQuickPrayerList() {
    const host = $('#quickPrayerList');
    if (!host || !state.today) return;
    const labels = global.XR_Prayer.PRAYER_LABELS;
    const order = _orderedKeys();
    host.innerHTML = order.map((k) => {
      const t = state.today.times[k] || '--:--';
      const isCurrent = state.currentPrayerKey === k;
      return `
        <div class="quick-prayer-item ${isCurrent ? 'is-current' : ''}">
          <div class="qp-name"><span class="text-gold">${PRAYER_ICONS[k] || ''}</span>${labels[k]}</div>
          <div class="qp-time">${t}</div>
        </div>`;
    }).join('');
  }

  function renderFullPrayerList() {
    const host = $('#prayerList');
    if (!host || !state.today) return;
    const labels = global.XR_Prayer.PRAYER_LABELS;
    const order = _orderedKeys();
    host.innerHTML = order.map((k) => {
      const t = state.today.times[k] || '--:--';
      const isCurrent = state.currentPrayerKey === k;
      const isNext = state.nextPrayerKey === k;
      const tag = isCurrent ? 'is-current' : (isNext ? 'is-next' : '');
      return `
        <div class="prayer-row ${tag}">
          <div class="p-name"><div class="p-icon">${PRAYER_ICONS[k] || ''}</div>${labels[k]}</div>
          <div class="p-time">${t}</div>
        </div>`;
    }).join('');
  }

  function updateNextPrayerHero() {
    if (!state.today) return;
    const next = state.nextPrayerKey ? {
      key: state.nextPrayerKey,
      label: global.XR_Prayer.PRAYER_LABELS[state.nextPrayerKey],
      date: state.nextPrayerDate
    } : null;
    const nm = $('#nextPrayerName');
    const nt = $('#nextPrayerTime');
    if (next && nm) nm.textContent = next.label;
    if (next && nt && next.date) nt.textContent = `${pad(next.date.getHours())}:${pad(next.date.getMinutes())}`;
    const cn = $('#currentPrayerName');
    if (cn) cn.textContent = state.currentPrayerKey
      ? global.XR_Prayer.PRAYER_LABELS[state.currentPrayerKey]
      : '—';
  }

  async function refreshPrayerData() {
    try {
      global.XR_Prayer.setSource(state.prefs.prayerSource);
      const today = await global.XR_Prayer.getToday();
      state.today = today;

      const now = new Date();
      const cn = global.XR_Prayer.currentAndNext(today, now);
      state.currentPrayerKey = cn.current ? cn.current.key : null;
      state.currentPrayerDate = cn.current && cn.current.date ? cn.current.date : null;
      state.nextPrayerKey = cn.next ? cn.next.key : null;
      state.nextPrayerDate = cn.next && cn.next.date ? cn.next.date : null;
      if (cn.next && cn.next.tomorrow) {
        const np = await global.XR_Prayer.nextPrayer(now);
        if (np && np.date) {
          state.nextPrayerKey = np.key;
          state.nextPrayerDate = np.date;
        }
      }
      const ls = $('#lastSyncLabel');
      if (ls && state.prefs.lastSync) {
        const d = new Date(state.prefs.lastSync);
        ls.textContent = `Sinkronizimi i fundit: ${pad(d.getHours())}:${pad(d.getMinutes())} · ${SQ_MONTHS[d.getMonth()]} ${d.getDate()}`;
      } else if (ls) {
        ls.textContent = today.computed ? 'Llogaritje lokale (offline)' : 'Sinkronizimi i fundit: tani';
      }
    } catch (e) {
      console.warn('refreshPrayerData failed', e);
    }
  }

  function refreshHomeView() {
    renderQuickPrayerList();
    updateNextPrayerHero();
  }
  function refreshPrayerView() {
    renderFullPrayerList();
    updateNextPrayerHero();
    const badge = $('#prayerSourceBadge');
    if (badge) badge.textContent = (global.XR_Prayer.SOURCES[state.prefs.prayerSource] || {}).label || 'BIK';
  }

  let _soonTimer = null;
  function scheduleSoon(delay = 1500) {
    clearTimeout(_soonTimer);
    _soonTimer = setTimeout(async () => {
      await refreshPrayerData();
      refreshHomeView();
      refreshPrayerView();
    }, delay);
  }

  /* ------------------ SETTINGS ------------------ */
  function renderSettings() {
    if (!state.prefs) return;
    const setChecked = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
    setChecked('#setNotifEnabled', state.prefs.notificationsEnabled);
    setChecked('#setAdhanEnabled', state.prefs.adhanEnabled);
    setChecked('#setHapticEnabled', state.prefs.hapticEnabled);
    $$('button.src-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-source') === state.prefs.prayerSource);
    });
    $$('button.theme-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-theme') === state.prefs.theme);
    });
    applyTheme(state.prefs.theme);
    const onl = navigator.onLine;
    const dot = $('#onlineDot');
    if (dot) {
      dot.classList.toggle('online', onl);
      dot.classList.toggle('offline', !onl);
    }
    const oi = $('#offlineIndicator');
    if (oi) {
      oi.textContent = onl ? 'Online' : 'Offline';
      oi.style.background = onl ? 'rgba(52,211,153,.12)' : 'rgba(245,158,11,.12)';
      oi.style.color = onl ? '#86efac' : '#fbbf24';
      oi.style.borderColor = onl ? 'rgba(52,211,153,.3)' : 'rgba(245,158,11,.3)';
    }
    const ol = $('#offlineLabel');
    if (ol) ol.textContent = onl ? 'Statusi: i lidhur' : 'Statusi: pa internet (përdoret cache)';
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    html.classList.remove('theme-dark', 'theme-soft', 'theme-light');
    html.classList.add(`theme-${theme}`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#F4EEDD' : (theme === 'soft' ? '#0F1530' : '#0B1020'));
  }

  function wireSettings() {
    const onNotif = async (ev) => {
      if (ev.target.checked) {
        const res = await global.XR_Notifications.enable();
        if (res !== 'granted') {
          ev.target.checked = false;
          toast(res === 'denied'
            ? 'Lejet e njoftimeve janë refuzuar. Aktivizoji nga cilësimet e shfletuesit.'
            : 'Njoftimet nuk mbështeten në këtë shfletues.', 'error');
        } else {
          toast('Njoftimet u aktivizuan.', 'success');
        }
      } else {
        await global.XR_Notifications.disable();
        toast('Njoftimet u çaktivizuan.', 'info');
      }
      state.prefs = await global.XR_Storage.getPrefs();
      renderSettings();
    };
    const n = $('#setNotifEnabled'); if (n) n.addEventListener('change', onNotif);
    const a = $('#setAdhanEnabled'); if (a) a.addEventListener('change', async (ev) => {
      await global.XR_Storage.setPrefs({ adhanEnabled: ev.target.checked });
      state.prefs = await global.XR_Storage.getPrefs();
      toast(ev.target.checked ? 'Ezani audio u aktivizua.' : 'Ezani audio u çaktivizua.', 'info');
      if (ev.target.checked) {
        try { global.XR_Notifications.playAdhan(); setTimeout(() => global.XR_Notifications.stopAdhan(), 350); } catch (e) {}
      }
    });
    const h = $('#setHapticEnabled'); if (h) h.addEventListener('change', async (ev) => {
      await global.XR_Storage.setPrefs({ hapticEnabled: ev.target.checked });
      state.prefs = await global.XR_Storage.getPrefs();
      if (ev.target.checked) pulseHaptic();
    });
    $$('button.src-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const src = btn.getAttribute('data-source');
      await global.XR_Storage.setPrefs({ prayerSource: src });
      state.prefs = await global.XR_Storage.getPrefs();
      global.XR_Prayer.setSource(src);
      document.dispatchEvent(new CustomEvent('prayer:source-changed'));
      renderSettings();
      await refreshPrayerData();
      refreshHomeView();
      refreshPrayerView();
      toast(`Burimi u ndryshua në ${(global.XR_Prayer.SOURCES[src] || {}).label || src}.`, 'success');
    }));
    $$('button.theme-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const theme = btn.getAttribute('data-theme');
      await global.XR_Storage.setPrefs({ theme });
      state.prefs = await global.XR_Storage.getPrefs();
      renderSettings();
    }));
    const refresh = $('#btnRefreshPrayer'); if (refresh) refresh.addEventListener('click', async () => {
      tinyHaptic();
      toast('Po rifreskoj kohët e namazit…', 'info', 1500);
      await refreshPrayerData();
      refreshHomeView();
      refreshPrayerView();
      renderSettings();
      toast('U rifreskuan.', 'success');
    });
    const test = $('#btnTestNotif'); if (test) test.addEventListener('click', async () => {
      tinyHaptic();
      const ok = await global.XR_Notifications.testNotification();
      if (!ok) {
        if (global.XR_Notifications.getPermission() !== 'granted') {
          const r = await global.XR_Notifications.requestPermission();
          if (r === 'granted') {
            await global.XR_Notifications.testNotification();
            toast('U dërgua njoftim provë.', 'success');
          } else {
            toast('Lejet u refuzuan. Aktivizoji nga cilësimet e shfletuesit.', 'error');
          }
        } else {
          toast('Njoftimi nuk u shfaq në këtë mjedis.', 'error');
        }
      } else {
        toast('U dërgua njoftim provë.', 'success');
      }
    });
    const clear = $('#btnClearCache'); if (clear) clear.addEventListener('click', async () => {
      if (!confirm('Pastro të dhënat e ruajtura të aplikacionit?')) return;
      tinyHaptic();
      await global.XR_Storage.clearAll();
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          for (const k of keys) await caches.delete(k);
        } catch (e) {}
      }
      toast('U pastrua. Po ringarkoj…', 'success', 1200);
      setTimeout(() => location.reload(), 1200);
    });
    const quickN = $('#btnNotifQuick'); if (quickN) quickN.addEventListener('click', () => setTab('cilesimet'));
  }

  /* ------------------ GALLERY ------------------ */
  const GALLERY_ITEMS = [
    { src: 'assets/gallery/gallery-1.jpg', thumb: 'assets/gallery/gallery-1-thumb.jpg', title: 'Pamja jashtme' },
    { src: 'assets/gallery/gallery-2.jpg', thumb: 'assets/gallery/gallery-2-thumb.jpg', title: 'Mihrabi' },
    { src: 'assets/gallery/gallery-3.jpg', thumb: 'assets/gallery/gallery-3-thumb.jpg', title: 'Brendia' },
    { src: 'assets/gallery/gallery-4.jpg', thumb: 'assets/gallery/gallery-4-thumb.jpg', title: 'Drita e mëngjesit' },
    { src: 'assets/gallery/gallery-5.jpg', thumb: 'assets/gallery/gallery-5-thumb.jpg', title: 'Minarja' },
    { src: 'assets/gallery/gallery-6.jpg', thumb: 'assets/gallery/gallery-6-thumb.jpg', title: 'Hyrja kryesore' }
  ];

  let _galleryRendered = false;
  function ensureGalleryRendered() {
    if (_galleryRendered) return;
    _galleryRendered = true;
    state.gallery.images = GALLERY_ITEMS;
    const grid = $('#galleryGrid');
    const count = $('#galleryCount');
    if (count) count.textContent = `${GALLERY_ITEMS.length} fotografi`;
    if (!grid) return;
    grid.innerHTML = GALLERY_ITEMS.map((it, i) => `
      <button class="gallery-item" data-index="${i}" aria-label="${escapeHtml(it.title)}">
        <img loading="lazy" data-src="${it.thumb}" alt="${escapeHtml(it.title)}" />
        <div class="gi-overlay">${escapeHtml(it.title)}</div>
      </button>
    `).join('');
    const imgs = $$('.gallery-item img', grid);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const img = e.target;
            img.src = img.dataset.src;
            img.onload = () => img.classList.add('loaded');
            io.unobserve(img);
          }
        });
      }, { rootMargin: '120px' });
      imgs.forEach((i) => io.observe(i));
    } else {
      imgs.forEach((i) => { i.src = i.dataset.src; i.onload = () => i.classList.add('loaded'); });
    }
    $$('.gallery-item', grid).forEach((btn) => {
      btn.addEventListener('click', () => openViewer(parseInt(btn.dataset.index, 10)));
    });
  }

  function openViewer(idx) {
    state.gallery.currentIndex = idx;
    const v = $('#galleryViewer');
    if (!v) return;
    v.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderViewer();
    pulseHaptic();
  }
  function closeViewer() {
    const v = $('#galleryViewer');
    if (!v) return;
    v.classList.add('hidden');
    document.body.style.overflow = '';
  }
  function renderViewer() {
    const img = $('#viewerImage');
    const cap = $('#viewerCaption');
    const it = state.gallery.images[state.gallery.currentIndex];
    if (img && it) {
      img.style.opacity = 0;
      img.src = it.src;
      img.onload = () => { img.style.transition = 'opacity .3s ease'; img.style.opacity = 1; };
    }
    if (cap && it) cap.textContent = `${state.gallery.currentIndex + 1} / ${state.gallery.images.length} · ${it.title}`;
  }
  function nextImg() { state.gallery.currentIndex = (state.gallery.currentIndex + 1) % state.gallery.images.length; renderViewer(); tinyHaptic(); }
  function prevImg() { state.gallery.currentIndex = (state.gallery.currentIndex - 1 + state.gallery.images.length) % state.gallery.images.length; renderViewer(); tinyHaptic(); }

  /* Robust button handlers — register on both pointerup and click so that
     touch + mouse + pen all close reliably even on iOS Safari. */
  function attachActionHandler(el, handler) {
    if (!el) return;
    let fired = false;
    const wrap = (ev) => {
      if (fired) { fired = false; return; }
      fired = true;
      ev.stopPropagation();
      ev.preventDefault();
      handler(ev);
      setTimeout(() => { fired = false; }, 350);
    };
    el.addEventListener('click', wrap);
    el.addEventListener('pointerup', wrap);
  }

  function wireGalleryViewer() {
    attachActionHandler($('#btnCloseViewer'), closeViewer);
    attachActionHandler($('#btnNextImg'), nextImg);
    attachActionHandler($('#btnPrevImg'), prevImg);

    // Backdrop click → close
    const backdrop = $('#viewerBackdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeViewer);
      backdrop.addEventListener('pointerup', (ev) => {
        if (ev.target === backdrop) closeViewer();
      });
    }

    // Swipe support on the viewer container
    const v = $('#galleryViewer');
    if (v) {
      v.addEventListener('touchstart', (ev) => {
        const t = ev.changedTouches[0];
        state.gallery.touchStartX = t.screenX;
        state.gallery.touchStartY = t.screenY;
        state.gallery.touchStartTime = Date.now();
        state.gallery.moved = false;
      }, { passive: true });
      v.addEventListener('touchmove', (ev) => {
        const t = ev.changedTouches[0];
        const dx = Math.abs(t.screenX - state.gallery.touchStartX);
        const dy = Math.abs(t.screenY - state.gallery.touchStartY);
        if (dx > 8 || dy > 8) state.gallery.moved = true;
      }, { passive: true });
      v.addEventListener('touchend', (ev) => {
        const t = ev.changedTouches[0];
        state.gallery.touchEndX = t.screenX;
        state.gallery.touchEndY = t.screenY;
        const dx = state.gallery.touchEndX - state.gallery.touchStartX;
        const dy = Math.abs(state.gallery.touchEndY - state.gallery.touchStartY);
        // Horizontal swipe only — and ignore taps
        if (Math.abs(dx) > 50 && dy < 60) (dx < 0 ? nextImg() : prevImg());
      }, { passive: true });
    }

    document.addEventListener('keydown', (ev) => {
      const view = $('#galleryViewer');
      if (!view || view.classList.contains('hidden')) return;
      if (ev.key === 'Escape') closeViewer();
      else if (ev.key === 'ArrowRight') nextImg();
      else if (ev.key === 'ArrowLeft') prevImg();
    });
  }

  /* ------------------ INSTALL PROMPT ------------------ */
  function wireInstall() {
    global.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      if (state.prefs && state.prefs.installDismissed) return;
      const b = $('#installBanner'); if (b) b.classList.remove('hidden');
    });
    const btn = $('#btnInstall');
    if (btn) btn.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      tinyHaptic();
      state.deferredInstallPrompt.prompt();
      const choice = await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      const b = $('#installBanner'); if (b) b.classList.add('hidden');
      if (choice && choice.outcome === 'accepted') toast('Aplikacioni u instalua.', 'success');
    });
    const dismiss = $('#btnDismissInstall');
    if (dismiss) dismiss.addEventListener('click', async () => {
      const b = $('#installBanner'); if (b) b.classList.add('hidden');
      await global.XR_Storage.setPrefs({ installDismissed: true });
    });
    global.addEventListener('appinstalled', () => {
      toast('Aplikacioni u shtua në ekranin tuaj.', 'success');
    });
  }

  /* ------------------ ONLINE / OFFLINE ------------------ */
  function wireConnectivity() {
    global.addEventListener('online', () => {
      renderSettings();
      toast('Lidhja u rikthye.', 'success');
      scheduleSoon(300);
    });
    global.addEventListener('offline', () => {
      renderSettings();
      toast('Pa internet — po përdor cache.', 'info');
    });
  }

  /* ------------------ INITIAL ROUTE ------------------ */
  function applyInitialRoute() {
    try {
      const url = new URL(global.location.href);
      const tab = url.searchParams.get('tab');
      if (tab && ['xhamia', 'namazi', 'rreth', 'galeria', 'cilesimet'].includes(tab)) {
        setTab(tab, { force: true });
      } else {
        setTab('xhamia', { force: true });
      }
    } catch (e) { setTab('xhamia', { force: true }); }
  }

  /* ------------------ BOOT ------------------ */
  async function boot() {
    state.prefs = await global.XR_Storage.getPrefs();
    global.XR_Prayer.setSource(state.prefs.prayerSource);
    applyTheme(state.prefs.theme);

    wireNav();
    wireSettings();
    wireGalleryViewer();
    wireInstall();
    wireConnectivity();

    await refreshPrayerData();
    refreshHomeView();
    refreshPrayerView();
    renderSettings();
    applyInitialRoute();

    renderClock();
    state.timers.clock = setInterval(renderClock, 1000);
    state.timers.refresh = setInterval(async () => {
      await refreshPrayerData();
      refreshHomeView();
      refreshPrayerView();
    }, 60_000);
  }

  global.XR_UI = {
    boot,
    setTab,
    toast,
    renderClock,
    refreshPrayerData,
    state
  };
})(window);
s.get('tab');
      if (tab && ['xhamia', 'namazi', 'rreth', 'galeria', 'cilesimet'].includes(tab)) {
        setTab(tab, { force: true });
      } else {
        setTab('xhamia', { force: true });
      }
    } catch (e) { setTab('xhamia', { force: true }); }
  }

  /* ------------------ BOOT ------------------ */
  async function boot() {
    state.prefs = await global.XR_Storage.getPrefs();
    global.XR_Prayer.setSource(state.prefs.prayerSource);
    applyTheme(state.prefs.theme);

    wireNav();
    wireSettings();
    wireGalleryViewer();
    wireInstall();
    wireConnectivity();

    await refreshPrayerData();
    refreshHomeView();
    refreshPrayerView();
    renderSettings();
    applyInitialRoute();

    renderClock();
    state.timers.clock = setInterval(renderClock, 1000);
    state.timers.refresh = setInterval(async () => {
      await refreshPrayerData();
      refreshHomeView();
      refreshPrayerView();
    }, 60000);
  }

  global.XR_UI = {
    boot,
    setTab,
    toast,
    renderClock,
    refreshPrayerData,
    state
  };
})(window);
