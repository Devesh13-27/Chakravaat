/* ============================================================
   timeline.js — Replay timeline, play/pause, scrub, speed
   ─────────────────────────────────────────────────────────────
   BACKEND INTEGRATION NOTE:
   On each timeline tick, call your API:
     GET /api/v1/storms/history?time=<isoTimestamp>&storm=<id>
   then call UI.updateStormPanel() and Map.renderMap() with
   the returned snapshot.  The `onTick` callback below is the
   hook for that.
   ============================================================ */

'use strict';

const Timeline = (() => {

  /* ── State ─────────────────────────────────────────────── */
  let _progress  = 0.65;   // 0.0 – 1.0
  let _playing   = false;
  let _speedIdx  = 1;
  let _interval  = null;
  let _onTick    = null;   // callback(progress, dateLabel)

  const SPEEDS = [0.5, 1, 2, 4];
  const TICK_MS = 50;       // UI update interval in ms
  const STEP_PER_TICK = 0.002; // progress units per tick at 1×

  /* ── Refs ──────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  /* ── Init ─────────────────────────────────────────────── */
  function init(dates, tickLabels, onTick) {
    _onTick = onTick;

    /* Inject tick labels */
    const labelsEl = $('tlLabels');
    if (labelsEl) {
      labelsEl.innerHTML = tickLabels
        .map(l => `<span>${l}</span>`)
        .join('');
    }

    /* Button bindings */
    $('playBtn')  ?.addEventListener('click', togglePlay);
    $('stepBack') ?.addEventListener('click', () => step(-1));
    $('stepFwd')  ?.addEventListener('click', () => step(1));
    $('speedBtn') ?.addEventListener('click', cycleSpeed);

    /* Scrub */
    const track = $('tlTrack');
    if (track) {
      track.addEventListener('click', e => {
        const rect = track.getBoundingClientRect();
        setProgress((e.clientX - rect.left) / rect.width);
      });

      /* Drag support */
      let dragging = false;
      track.addEventListener('mousedown', e => { dragging = true; scrubTo(e, track); });
      document.addEventListener('mousemove', e => { if (dragging) scrubTo(e, track); });
      document.addEventListener('mouseup',   () => { dragging = false; });
    }

    /* Set initial position */
    setProgress(_progress, dates);
    _storeRef('dates', dates);
  }

  /* Replace the date range (e.g. when switching to a replayed storm) without re-binding handlers. */
  function setRange(dates, tickLabels, progress = 0) {
    _refs.dates = dates;
    const labelsEl = $('tlLabels');
    if (labelsEl) labelsEl.innerHTML = tickLabels.map(l => `<span>${l}</span>`).join('');
    setProgress(progress, dates);
  }

  function scrubTo(e, track) {
    const rect = track.getBoundingClientRect();
    setProgress(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }

  /* ── Storage for dates ref ─────────────────────────────── */
  const _refs = {};
  function _storeRef(k, v) { _refs[k] = v; }

  /* ── Progress ─────────────────────────────────────────── */
  function setProgress(p, datesOverride) {
    _progress = Math.max(0, Math.min(1, p));

    const fill  = $('tlFill');
    const thumb = $('tlThumb');
    const label = $('rpDate');

    if (fill)  fill.style.width = `${_progress * 100}%`;
    if (thumb) thumb.style.left = `${_progress * 100}%`;

    const dates = datesOverride || _refs.dates || window.TIMELINE_DATES || [];
    const idx   = Math.round(_progress * (dates.length - 1));
    const dateLabel = dates[idx] || '—';
    if (label) label.textContent = dateLabel;

    if (_onTick) _onTick(_progress, dateLabel);
  }

  /* ── Play / pause ─────────────────────────────────────── */
  function togglePlay() {
    _playing = !_playing;
    const btn = $('playBtn');

    if (_playing) {
      btn.textContent = '⏸';
      btn.classList.add('playing');
      _interval = setInterval(() => {
        const next = _progress + STEP_PER_TICK * SPEEDS[_speedIdx];
        setProgress(next >= 1 ? 0 : next);   // loop
      }, TICK_MS);
      return 'playing';
    } else {
      btn.textContent = '▶';
      btn.classList.remove('playing');
      clearInterval(_interval);
      return 'paused';
    }
  }

  function pause() {
    if (_playing) togglePlay();
  }

  /* ── Step ─────────────────────────────────────────────── */
  function step(dir) {
    const dates = _refs.dates || window.TIMELINE_DATES || [];
    const stepSize = dates.length > 1 ? 1 / (dates.length - 1) : 0.1;
    setProgress(_progress + dir * stepSize);
  }

  /* ── Speed ────────────────────────────────────────────── */
  function cycleSpeed() {
    _speedIdx = (_speedIdx + 1) % SPEEDS.length;
    const btn = $('speedBtn');
    if (btn) btn.textContent = `${SPEEDS[_speedIdx]}×`;
    return SPEEDS[_speedIdx];
  }

  /* ── Getters ─────────────────────────────────────────── */
  function getProgress()    { return _progress; }
  function getSpeed()       { return SPEEDS[_speedIdx]; }
  function isPlaying()      { return _playing; }

  return { init, setRange, setProgress, togglePlay, pause, step, cycleSpeed, getProgress, getSpeed, isPlaying };
})();
