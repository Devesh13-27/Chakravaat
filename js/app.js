/* ============================================================
   app.js — Application controller
   Wires data → map → UI.  This is the ONLY file that needs
   to change significantly when you plug in a real backend.
   ─────────────────────────────────────────────────────────────
   BACKEND INTEGRATION CHECKLIST:
   1. Replace window.STORM_DATA with:
        const res = await fetch('/api/v1/storms/active');
        window.STORM_DATA = await res.json();
      …then call App.init().

   2. On timeline tick (in Timeline's onTick callback below),
      call:
        const snapshot = await fetch(`/api/v1/storms/history?t=${isoTime}`);
        ChakravaatMap.renderMap(snapshot.storms);
        UI.updateStormPanel(snapshot.storms.find(s => s.id === _activeStormId));

   3. For real ENV data per storm, call:
        const env = await fetch(`/api/v1/environment?storm=${id}`);
        UI.renderEnvCards(env.cards);
        UI.renderERA5(env.era5, env.era5Timestamp);

   4. For Grad-CAM images from your ML backend, replace the
      .gradcam-inner contents in index.html with:
        <img src="/api/v1/gradcam?storm=${id}" style="width:100%;height:100%;object-fit:cover"/>
   ============================================================ */

'use strict';

const App = (() => {

  /* ── State ───────────────────────────────────────────────── */
  let _activeStormId = null;
  let _activeSatIdx  = 0;

  /* ── Helpers ─────────────────────────────────────────────── */
  function getActiveStorm() {
    return (window.STORM_DATA || []).find(s => s.id === _activeStormId) || null;
  }

  /* ── Select storm ────────────────────────────────────────── */
  function selectStorm(id) {
    _activeStormId = id;
    const storm = getActiveStorm();
    if (!storm) return;

    /* Re-render cards (to update selected state) */
    UI.renderStormCards(window.STORM_DATA, _activeStormId, selectStorm);

    /* Update map detection overlay */
    ChakravaatMap.updateDetectionOverlay(storm);

    /* Update right panel */
    UI.updateStormPanel(storm);

    /* Update env tab for this storm */
    const env = (window.ENV_DATA || {})[id];
    if (env) {
      UI.renderEnvCards(env.cards);
      UI.renderERA5(env.era5, env.era5Timestamp);
    }

    UI.toast(`Selected: ${storm.name}`);
  }

  /* ── Select satellite feed ───────────────────────────────── */
  function selectSat(idx) {
    _activeSatIdx = idx;
    const feed = (window.SAT_FEEDS || [])[idx];
    if (!feed) return;

    UI.renderSatFeeds(window.SAT_FEEDS, _activeSatIdx, selectSat);
    ChakravaatMap.updateMapAttr(`2024-06-14 09:40 UTC · ${feed.name} · ${feed.freq}`);
    UI.toast(`Feed: ${feed.name}`);
  }

  /* ── Layer toggle ────────────────────────────────────────── */
  function onLayerToggle(idx, isOn, layer) {
    /* layer.id is e.g. "g-predicted" — match SVG group ids that start with it */
    ChakravaatMap.setLayerVisible(layer.id, isOn);
    UI.toast(`${layer.label}: ${isOn ? 'On' : 'Off'}`);
  }

  /* ── Nav view switch ─────────────────────────────────────── */
  const TAB_FOR_VIEW = {
    live:     'intel',
    predict:  'forecast',
    replay:   'intel',
    analysis: 'xai'
  };

  function onNavChange(view) {
    const labels = {
      live:     'Live Monitor active',
      predict:  'Prediction view',
      replay:   'History Replay mode',
      analysis: 'Analysis mode'
    };
    UI.toast(labels[view] || view);

    const tab = TAB_FOR_VIEW[view];
    if (tab) UI.activateTab(tab);
  }

  /* ── Map zoom ────────────────────────────────────────────── */
  function onZoomIn()    { UI.toast(`Zoom level: ${ChakravaatMap.zoom(1)}`); }
  function onZoomOut()   { UI.toast(`Zoom level: ${ChakravaatMap.zoom(-1)}`); }
  function onZoomReset() { ChakravaatMap.resetZoom(); UI.toast('View reset'); }

  /* ── Timeline tick ───────────────────────────────────────── */
  function onTimelineTick(progress, dateLabel) {
    /* 
       BACKEND HOOK: fetch historical snapshot here.
       e.g.:
         const iso = progressToISO(progress);
         fetchSnapshot(iso).then(snapshot => {
           ChakravaatMap.renderMap(snapshot.storms);
           UI.updateStormPanel(snapshot.storms.find(s => s.id === _activeStormId));
         });
       For now, just update the date display (already done by timeline.js).
    */
  }

  /* ── Bootstrap ───────────────────────────────────────────── */
  async function init() {
    /* Render map (awaited so overlays exist before we sync layer visibility) */
    await ChakravaatMap.renderMap(window.STORM_DATA);

    /* Default active storm = first in list */
    _activeStormId = window.STORM_DATA[0]?.id || null;

    /* Top alert badge (reflects whole fleet, not just selection) */
    UI.updateAlertBadge(window.STORM_DATA);

    /* Left panel */
    UI.renderStormCards(window.STORM_DATA, _activeStormId, selectStorm);
    UI.renderSatFeeds(window.SAT_FEEDS, _activeSatIdx, selectSat);
    UI.renderLayerToggles(window.MAP_LAYERS, onLayerToggle);

    /* Sync map overlay visibility with each layer's default on/off state */
    (window.MAP_LAYERS || []).forEach(layer => {
      ChakravaatMap.setLayerVisible(layer.id, Boolean(layer.on));
    });

    /* Right panel initial state */
    const storm = getActiveStorm();
    if (storm) {
      ChakravaatMap.updateDetectionOverlay(storm);
      UI.updateStormPanel(storm);
    }

    /* Environment tab */
    const env = (window.ENV_DATA || {})[_activeStormId];
    if (env) {
      UI.renderEnvCards(env.cards);
      UI.renderERA5(env.era5, env.era5Timestamp);
    }
    UI.renderDataSources(window.DATA_SOURCES);

    /* Map attribution default */
    const defaultFeed = window.SAT_FEEDS[0];
    if (defaultFeed) {
      ChakravaatMap.updateMapAttr(`2024-06-14 09:40 UTC · ${defaultFeed.name} · ${defaultFeed.freq}`);
    }

    /* Tabs */
    UI.initTabs();
    UI.initNavPills(onNavChange);

    /* Timeline */
    Timeline.init(
      window.TIMELINE_DATES,
      window.TIMELINE_TICK_LABELS,
      onTimelineTick
    );

    /* Map zoom buttons (extra wiring for toast feedback) */
    document.getElementById('zoomIn')   ?.addEventListener('click', onZoomIn);
    document.getElementById('zoomOut')  ?.addEventListener('click', onZoomOut);
    document.getElementById('zoomReset')?.addEventListener('click', onZoomReset);

    /* Timeline speed / step toasts */
    document.getElementById('speedBtn')?.addEventListener('click', () => {
      UI.toast(`Speed: ${Timeline.getSpeed()}×`);
    });
    document.getElementById('stepBack')?.addEventListener('click', () => {
      /* Toast current date after step (timeline.js already moved progress) */
      const dates = window.TIMELINE_DATES || [];
      const idx   = Math.round(Timeline.getProgress() * (dates.length - 1));
      UI.toast(dates[idx] || '');
    });
    document.getElementById('stepFwd')?.addEventListener('click', () => {
      const dates = window.TIMELINE_DATES || [];
      const idx   = Math.round(Timeline.getProgress() * (dates.length - 1));
      UI.toast(dates[idx] || '');
    });
    document.getElementById('playBtn')?.addEventListener('click', () => {
      UI.toast(Timeline.isPlaying() ? 'Replay started' : 'Replay paused');
    });
  }

  /* ── Public ─────────────────────────────────────────────── */
  return { init };
})();

/* ── Start ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => App.init());

function updateClocks() {
  const now = new Date();

  const istTime = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const utcTime = now.toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const istElement = document.getElementById("istTime");
  const utcElement = document.getElementById("utcTime");

  if (istElement) {
    istElement.textContent = `IST ${istTime}`;
  }

  if (utcElement) {
    utcElement.textContent = `UTC ${utcTime}`;
  }
}

// Initial update
updateClocks();

// Update every second
setInterval(updateClocks, 1000);