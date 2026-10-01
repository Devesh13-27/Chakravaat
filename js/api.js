/* ============================================================
   api.js — Loads data from the Chakravaat backend.
   On success it overwrites the window.* globals that data.js
   seeded with demo data; on any failure the demo data stays
   in place so the UI still works offline.
   Override the base URL with window.CHAKRAVAAT_CONFIG.apiBaseUrl.
   ============================================================ */

'use strict';

const Api = (() => {

  const BASE = (window.CHAKRAVAAT_CONFIG && window.CHAKRAVAAT_CONFIG.apiBaseUrl)
    || 'http://127.0.0.1:8000/api/v1';
  const TIMEOUT_MS = 3000;

  async function get(path, timeoutMs = TIMEOUT_MS) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* Resolves 'live' when everything came from the API, 'demo' otherwise. */
  async function load() {
    try {
      const [storms, satFeeds, layers, sources, timeline] = await Promise.all([
        get('/storms/active'),
        get('/sat-feeds'),
        get('/layers'),
        get('/data-sources'),
        get('/timeline')
      ]);

      /* A storm without environment data shouldn't discard the rest. */
      const envEntries = await Promise.all(storms.map(async s => {
        try   { return [s.id, await get(`/environment?storm=${encodeURIComponent(s.id)}`)]; }
        catch { return null; }
      }));

      /* Assign only after every request succeeded — never a half-live mix. */
      window.STORM_DATA           = storms;
      window.SAT_FEEDS            = satFeeds;
      window.MAP_LAYERS           = layers;
      window.DATA_SOURCES         = sources;
      window.TIMELINE_DATES       = timeline.dates;
      window.TIMELINE_TICK_LABELS = timeline.tick_labels;
      window.ENV_DATA             = Object.fromEntries(envEntries.filter(Boolean));

      console.info(`[Chakravaat] data source: live API (${BASE})`);
      return 'live';
    } catch (err) {
      console.warn(`[Chakravaat] backend unreachable (${err.message}) — using built-in demo data`);
      return 'demo';
    }
  }

  return { load, get, BASE };
})();
