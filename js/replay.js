/* ============================================================
   replay.js — History Replay: the model's forecasts for a real
   past storm, from every valid time, next to what happened.
   Frames come from GET /history/storms/{sid}/hindcast and are
   turned into the same storm objects the live view renders, so
   the map, cards and panels need no special cases.
   ============================================================ */

'use strict';

const Replay = (() => {

  const $ = id => document.getElementById(id);

  const DEFAULT_SID = '2023156N10067'; // Biparjoy 2023 (unseen season)
  const KT_TO_KMH = 1.852;

  /* IMD stages by sustained wind (kt) */
  const STAGES = [
    { min: 120, code: 'escs', label: 'SuCS' },
    { min:  90, code: 'escs', label: 'ESCS' },
    { min:  64, code: 'vscs', label: 'VSCS' },
    { min:  48, code: 'scs',  label: 'SCS'  },
    { min:  34, code: 'cs',   label: 'CS'   },
    { min:  28, code: 'dd',   label: 'DD'   },
    { min:   0, code: 'd',    label: 'D'    }
  ];
  const STAGE_RANK = { d: 0, dd: 1, cs: 2, scs: 3, vscs: 4, escs: 5 };
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  let active = false;
  let hind = null;
  let frames = [];
  let lastIdx = -1;
  let loadToken = 0;
  let pickerReady = false;

  /* ── helpers ─────────────────────────────────────────────── */
  const stageOf = kt => (kt == null ? { code: 'd', label: 'n/a' } : STAGES.find(s => kt >= s.min));
  const kmh = kt => (kt == null ? null : Math.round(kt * KT_TO_KMH));
  const fmtKmh = kt => (kt == null ? '—' : `${kmh(kt)} km/h`);

  function haversineKm(a, b) {
    const r = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
  }

  function bearing(a, b) {
    const r = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  const fmtTime = iso => {
    const d = new Date(iso);
    const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return `${mon} ${String(d.getUTCDate()).padStart(2, '0')} · ${hh}Z`;
  };
  const fmtDay = iso => {
    const d = new Date(iso);
    return `${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  /* ── frame → storm object (same shape the live view renders) ── */
  function toStorm(frame) {
    const nowIdx = hind.observed.findIndex(o => o.time === frame.init_time);
    const past = nowIdx >= 0 ? hind.observed.slice(0, nowIdx + 1) : [];
    const cur = { lat: frame.lat, lon: frame.lon };
    const prev = nowIdx > 0 ? hind.observed[nowIdx - 1] : null;

    const stage = stageOf(frame.wind_kt);
    const motionKmh = prev ? Math.round(haversineKm(prev, cur) / 6) : 0; // fixes are 6 h apart
    const direction = prev ? COMPASS[Math.round(bearing(prev, cur) / 22.5) % 16] : '—';

    const trackRows = [{ time: 'Now', lat: `${cur.lat.toFixed(1)}°N`, lon: `${cur.lon.toFixed(1)}°E`, dist: '—', isCurrent: true }];
    const intensityRows = [{ time: 'Now', wind: fmtKmh(frame.wind_kt), pressure: '—', cls: stage.label, isCurrent: true }];
    const uncertainty = [];
    let prevWind = frame.wind_kt;

    frame.forecast.forEach((f, k) => {
      const star = f.lead_h === 48 ? '*' : '';
      trackRows.push({
        time: `+${f.lead_h} h${star}`,
        lat: `${f.lat.toFixed(1)}°N`,
        lon: `${f.lon.toFixed(1)}°E`,
        dist: `${Math.round(haversineKm(cur, f))} km`
      });
      const fs = stageOf(f.wind_kt);
      intensityRows.push({
        time: `+${f.lead_h} h`,
        wind: fmtKmh(f.wind_kt),
        pressure: '—',
        cls: f.wind_kt == null ? '—' : fs.label,
        trend: f.wind_kt == null || prevWind == null ? undefined : (f.wind_kt > prevWind + 1 ? 'up' : f.wind_kt < prevWind - 1 ? 'dn' : undefined)
      });
      prevWind = f.wind_kt ?? prevWind;

      uncertainty.push({
        label: `+${f.lead_h} h track radius (67% / 90%)`,
        value: `± ${Math.round(f.track_radius_km_67)} / ${Math.round(f.track_radius_km_90)} km`
      });
      const err = frame.track_error_km && frame.track_error_km[k];
      if (err != null) uncertainty.push({ label: `+${f.lead_h} h actual track error`, value: `${Math.round(err)} km` });
    });

    const splitNote = hind.out_of_sample
      ? 'Season never used for training or tuning — a fair test.'
      : `Season ${hind.season} was used for training/tuning (${hind.data_split}); skill here is optimistic.`;

    return {
      id: hind.sid,
      name: `${hind.name}-${hind.season}`,
      category: stage.code,
      categoryLabel: stage.label,
      lat: cur.lat,
      lon: cur.lon,
      wind: kmh(frame.wind_kt) ?? '—',
      pressure: '—',
      direction,
      speed: motionKmh,
      intensitySteps: 6,
      activeSteps: Math.min(6, (STAGE_RANK[stage.code] ?? 0) + 1),
      isWarning: (STAGE_RANK[stage.code] ?? 0) >= STAGE_RANK.vscs,
      detection: { status: 'Hindcast', confidence: null, model: 'GRU + Ridge blend' },
      classification: [{
        label: `Observed IMD stage: ${stage.label}`,
        pct: 100,
        color: 'var(--blue)'
      }],
      intensityConf: '—',
      track: {
        historical: past.map(o => ({ lat: o.lat, lon: o.lon })),
        predicted: frame.forecast.map(f => ({
          lat: f.lat,
          lon: f.lon,
          label: `+${f.lead_h}h`,
          uncertaintyKm: f.track_radius_km_67
        }))
      },
      forecast: { track: trackRows, intensity: intensityRows },
      uncertainty,
      alerts: [
        {
          type: hind.out_of_sample ? 'info' : 'warn',
          icon: 'ℹ',
          title: hind.out_of_sample ? 'Hindcast on an unseen season' : 'Hindcast on training-period data',
          body: `Forecast issued ${fmtTime(frame.init_time)} using only data up to that time. ${splitNote}`
        },
        {
          type: 'info',
          icon: '▦',
          title: 'Reading the map',
          body: 'Solid line = observed so far, dashed = what actually happened next, coloured line = model forecast, shaded cone = 67% historical error radius.'
        }
      ],
      features: [],
      modelStack: []
    };
  }

  /* ── environment tab (real SST / shear at the forecast start) ── */
  function envCards(frame, prev) {
    const sst = frame.sst_c;
    const shear = frame.shear_ms;
    const change = (now, before, unit) => (now == null || before == null)
      ? ''
      : ` · ${now >= before ? '▲' : '▼'} ${Math.abs(now - before).toFixed(1)} ${unit} vs 6 h earlier`;

    const sstNote = sst == null
      ? 'Unknown (over land or no data)'
      : (sst >= 26.5 ? 'Warm enough to sustain a storm' : 'Marginal for intensification');
    const shearNote = shear == null
      ? 'Unknown'
      : (shear < 10 ? 'Low: favourable' : shear < 20 ? 'Moderate' : 'High: hostile');

    return [
      {
        label: 'Sea-surface temp',
        value: sst == null ? '—' : sst.toFixed(1),
        unit: '°C',
        trend: sstNote + change(sst, prev?.sst_c, '°C'),
        trendColor: sst == null ? 'var(--text-muted)' : (sst >= 26.5 ? 'var(--teal)' : 'var(--amber)')
      },
      {
        label: '200–850 hPa shear',
        value: shear == null ? '—' : shear.toFixed(1),
        unit: 'm/s',
        trend: shearNote + change(shear, prev?.shear_ms, 'm/s'),
        trendColor: shear == null ? 'var(--text-muted)' : (shear < 10 ? 'var(--teal)' : shear < 20 ? 'var(--amber)' : 'var(--red)')
      }
    ];
  }

  function renderEnvironment(idx) {
    const frame = frames[idx];
    UI.renderEnvCards(envCards(frame, frames[idx - 1]));
    UI.renderERA5([
      { label: 'SST source', value: 'NOAA OISST v2.1, daily' },
      { label: 'Shear source', value: 'NCEP/NCAR Reanalysis 1, daily' },
      { label: 'Shear method', value: '±5° box mean, 200 minus 850 hPa' },
      { label: 'Used by the model', value: hind.uses_environment ? 'Yes' : 'No (did not help on validation)' }
    ], null);
    const ts = $('era5Timestamp');
    if (ts) ts.textContent = 'Daily means for the day of the forecast start. Not ERA5.';
  }

  /* ── rendering ───────────────────────────────────────────── */
  function renderFrame(idx, { fit = false } = {}) {
    const frame = frames[idx];
    if (!frame) return;
    const storm = toStorm(frame);

    const nowIdx = hind.observed.findIndex(o => o.time === frame.init_time);
    const future = nowIdx >= 0 ? hind.observed.slice(nowIdx) : [];

    ChakravaatMap.renderMap([storm], { recenter: false }).then(() => {
      ChakravaatMap.renderActualTrack(future);
      if (fit) ChakravaatMap.fitTo(hind.observed);
    });

    UI.renderStormCards([storm], storm.id, () => {});
    UI.updateStormPanel(storm);
    ChakravaatMap.updateDetectionOverlay(storm);
    renderEnvironment(idx);
    ChakravaatMap.updateMapAttr(`HINDCAST · ${hind.name} ${hind.season} · ${hind.out_of_sample ? 'UNSEEN SEASON' : 'TRAINING PERIOD'} · ${fmtTime(frame.init_time)}`);
  }

  function onTick(progress) {
    if (!active || !frames.length) return;
    const idx = Math.round(progress * (frames.length - 1));
    if (idx === lastIdx) return;
    lastIdx = idx;
    renderFrame(idx);
  }

  /* ── data loading ────────────────────────────────────────── */
  async function populatePicker() {
    const select = $('replayStormSelect');
    if (!select || pickerReady) return;
    const named = s => !/^(NOT_NAMED|UNNAMED)$/.test(s.name);
    const [unseen, trained] = await Promise.all([
      Api.get('/history/storms?season_from=2019&min_wind_kt=45&limit=60'),
      Api.get('/history/storms?season_from=2000&season_to=2018&min_imd_stage=vscs&limit=60')
    ]);
    const group = (label, items) => {
      const g = document.createElement('optgroup');
      g.label = label;
      items.filter(named).forEach(s => {
        const o = document.createElement('option');
        o.value = s.sid;
        o.textContent = `${s.name} ${s.season}` + (s.max_wind_kt ? ` · peak ${Math.round(s.max_wind_kt)} kt` : '');
        g.appendChild(o);
      });
      return g;
    };
    select.innerHTML = '';
    select.appendChild(group('Unseen seasons (2019+) — fair test', unseen.items));
    select.appendChild(group('Training period (2000–2018) — in-sample', trained.items));
    select.addEventListener('change', () => load(select.value));
    pickerReady = true;
  }

  async function load(sid) {
    const token = ++loadToken;
    UI.toast('Loading hindcast…');
    try {
      const data = await Api.get(`/history/storms/${encodeURIComponent(sid)}/hindcast`, 30000);
      if (token !== loadToken || !active) return;
      if (!data.frames.length) {
        UI.toast(`No forecasts available for ${data.name} ${data.season} (too short or outside the model domain)`);
        return;
      }
      hind = data;
      frames = data.frames;
      lastIdx = -1;

      const dates = frames.map(f => fmtTime(f.init_time));
      const ticks = Array.from({ length: 6 }, (_, i) => fmtDay(frames[Math.round(i * (frames.length - 1) / 5)].init_time));
      Timeline.pause();
      Timeline.setRange(dates, ticks, 0);

      const note = $('replayNote');
      if (note) {
        note.textContent = hind.out_of_sample
          ? 'Unseen season: the model never saw this storm.'
          : 'In-sample: this season was used for training/tuning, so results look better than reality.';
        note.className = 'replay-note ' + (hind.out_of_sample ? 'ok' : 'warn');
      }

      renderFrame(0, { fit: true });
      lastIdx = 0;
      UI.toast(`${hind.name} ${hind.season}: ${frames.length} forecasts`);
    } catch (err) {
      console.warn('[Replay] load failed:', err);
      UI.toast(`Replay unavailable: ${err.message}`);
    }
  }

  /* ── mode switching ──────────────────────────────────────── */
  async function enter() {
    if (active) return true;
    active = true;
    $('replayPanel')?.removeAttribute('hidden');
    UI.setAlertBadge('HINDCAST REPLAY · NOT LIVE');
    const title = $('era5Title');
    if (title) title.textContent = 'Environment sources';
    try {
      await populatePicker();
    } catch (err) {
      active = false;
      $('replayPanel')?.setAttribute('hidden', '');
      UI.updateAlertBadge(window.STORM_DATA);
      UI.toast('History Replay needs the backend and database running');
      return false;
    }
    const select = $('replayStormSelect');
    const hasDefault = Array.from(select.options).some(o => o.value === DEFAULT_SID);
    select.value = hasDefault ? DEFAULT_SID : select.options[0]?.value;
    await load(select.value);
    return true;
  }

  function exit() {
    if (!active) return;
    active = false;
    loadToken++;
    $('replayPanel')?.setAttribute('hidden', '');
    UI.updateAlertBadge(window.STORM_DATA);
    const title = $('era5Title');
    if (title) title.textContent = 'ERA5 Reanalysis';
    Timeline.pause();
  }

  return { enter, exit, onTick, isActive: () => active };
})();
