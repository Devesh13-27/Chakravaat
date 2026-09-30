/* ============================================================
   ui.js — All DOM rendering functions
   Everything that writes to the DOM lives here.
   app.js drives WHAT to render; ui.js handles HOW.
   ============================================================ */

'use strict';

const UI = (() => {

  const $ = id => document.getElementById(id);
  const html = (id, markup) => { const el = $(id); if (el) el.innerHTML = markup; };

  /* ══════════════════════════════════════════════════════════
     TOAST
     ══════════════════════════════════════════════════════════ */
  let _toastTimer = null;

  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ══════════════════════════════════════════════════════════
     CLOCK
     ══════════════════════════════════════════════════════════ */
  function startClock() {
    function tick() {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const el  = $('clock');
      if (el) el.textContent = `UTC ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ══════════════════════════════════════════════════════════
     LEFT PANEL
     ══════════════════════════════════════════════════════════ */

  /* Storm cards */
  function renderStormCards(storms, activeId, onSelect) {
    const container = $('stormCardContainer');
    if (!container) return;

    $('activeSystemsLabel').textContent = `Active Systems (${storms.length})`;

    container.innerHTML = storms.map(s => {
      const isActive = s.id === activeId;
      const catClass = isActive && s.isWarning ? 'warn-card' : '';
      const selClass = isActive ? 'selected' : '';
      const strips = Array.from({ length: s.intensitySteps }, (_, i) => {
        const cls = i < s.activeSteps
          ? (s.isWarning ? 'active-vscs' : 'active-dd')
          : '';
        return `<div class="strip-seg ${cls}"></div>`;
      }).join('');

      return `
        <div class="storm-card ${catClass} ${selClass}" data-storm-id="${s.id}">
          <div class="storm-name-row">
            <span class="storm-name">${s.name}</span>
            <span class="storm-cat ${s.category}">${s.categoryLabel}</span>
          </div>
          <div class="storm-coords">${s.lat.toFixed(1)}°N &nbsp;·&nbsp; ${s.lon.toFixed(1)}°E</div>
          <div class="storm-meta">
            <span><strong>${s.wind}</strong> km/h</span>
            <span><strong>${s.pressure}</strong> hPa</span>
            <span>${s.direction} · ${s.speed} km/h</span>
          </div>
          <div class="intensity-strip">${strips}</div>
        </div>`;
    }).join('');

    /* Bind clicks */
    container.querySelectorAll('.storm-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.stormId;
        onSelect(id);
      });
    });
  }

  /* Satellite feeds */
  function renderSatFeeds(feeds, activeIdx, onSelect) {
    const list = $('satFeedList');
    if (!list) return;
    list.innerHTML = feeds.map((f, i) => `
      <div class="sat-item ${i === activeIdx ? 'active' : ''}" data-sat-idx="${i}">
        <div>
          <div class="sat-item-name">${f.name}</div>
          <div class="sat-item-freq">${f.freq}</div>
        </div>
        <div class="sat-ind ${f.status === 'ok' ? '' : f.status}"></div>
      </div>`
    ).join('');

    list.querySelectorAll('.sat-item').forEach(el => {
      el.addEventListener('click', () => onSelect(parseInt(el.dataset.satIdx, 10)));
    });
  }

  /* Layer toggles */
  function renderLayerToggles(layers, onToggle) {
    const container = $('layerList');
    if (!container) return;
    container.innerHTML = layers.map((l, i) => {
      const borderStyle = l.border ? `border:${l.border};` : '';
      return `
        <div class="layer-row ${l.on ? 'on' : ''}" data-layer-idx="${i}">
          <div class="layer-color" style="background:${l.color};${borderStyle}border-radius:2px"></div>
          <span class="layer-name">${l.label}</span>
          <div class="tog ${l.on ? 'on' : ''}"></div>
        </div>`;
    }).join('');

    container.querySelectorAll('.layer-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.layerIdx, 10);
        const tog = row.querySelector('.tog');
        const isOn = tog.classList.toggle('on');
        row.classList.toggle('on', isOn);
        onToggle(idx, isOn, layers[idx]);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     RIGHT PANEL — INTELLIGENCE TAB
     ══════════════════════════════════════════════════════════ */

  function updateStormPanel(storm) {
    if (!storm) return;

    /* Header */
    const nameEl  = $('stormNameDisplay');
    const badgeEl = $('stormBadge');
    if (nameEl)  nameEl.textContent  = storm.name;
    if (badgeEl) {
      badgeEl.textContent = storm.categoryLabel;
      const isWarn = storm.isWarning;
      badgeEl.style.background   = isWarn ? 'var(--red-light)'   : 'var(--amber-light)';
      badgeEl.style.color        = isWarn ? 'var(--red)'         : '#B06010';
      badgeEl.style.borderColor  = isWarn ? 'rgba(230,57,70,0.25)' : 'rgba(244,162,97,0.3)';
    }

    /* Stats */
    const windEl = $('dispWind');
    const presEl = $('dispPres');
    const confEl = $('dispConf');
    if (windEl) windEl.innerHTML = `${storm.wind} <span class="int-stat-unit">km/h</span>`;
    if (presEl) presEl.innerHTML = `${storm.pressure} <span class="int-stat-unit">hPa</span>`;
    if (confEl) confEl.innerHTML = `${storm.intensityConf} <span class="int-stat-unit">%</span>`;

    /* Gauge */
    renderGauge('gaugeWrapper', storm.wind, 200);

    /* Classification */
    renderClassification(storm.classification);

    /* Alerts */
    renderAlerts(storm.alerts);

    /* Forecast tables */
    renderForecastTables(storm);

    /* Uncertainty */
    renderUncertainty(storm.uncertainty);
    const trackTitle = $('trackTableTitle');
    if (trackTitle) trackTitle.textContent = `Track Prediction — ${storm.name}`;

    /* XAI */
    renderFeatureImportance(storm.features);
    renderModelStack(storm.modelStack);
  }

  /* ── SVG Gauge ─────────────────────────────────────────── */
  function renderGauge(wrapperId, value, maxValue) {
    const wrapper = $(wrapperId);
    if (!wrapper) return;
    const r     = 34;
    const circ  = 2 * Math.PI * r;
    const arc   = circ * 0.77;          // 277° arc
    const filled = arc * Math.min(1, value / maxValue);

    wrapper.innerHTML = `
      <svg width="88" height="88" viewBox="0 0 88 88">
        <defs>
          <linearGradient id="gaugeG" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stop-color="#0077B6"/>
            <stop offset="100%" stop-color="#E63946"/>
          </linearGradient>
        </defs>
        <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--border)" stroke-width="7"/>
        <circle cx="44" cy="44" r="${r}" fill="none" stroke="url(#gaugeG)" stroke-width="7"
          stroke-dasharray="${filled.toFixed(1)} ${(circ - filled).toFixed(1)}"
          stroke-dashoffset="${(circ * 0.115).toFixed(1)}"
          stroke-linecap="round"
          transform="rotate(-220 44 44)"/>
        <text x="44" y="41" text-anchor="middle"
          fill="var(--navy)" font-family="Fira Code, monospace"
          font-size="15" font-weight="700">${value}</text>
        <text x="44" y="53" text-anchor="middle"
          fill="var(--text-muted)" font-family="DM Sans, sans-serif"
          font-size="8.5">km/h</text>
      </svg>`;
  }

  /* ── Classification bars ────────────────────────────────── */
  function renderClassification(items) {
    html('classificationBars', items.map(item => `
      <div class="cls-item">
        <div class="cls-row">
          <span class="cls-name">${item.label}</span>
          <span class="cls-pct">${item.pct.toFixed(1)}%</span>
        </div>
        <div class="cls-track">
          <div class="cls-fill" style="width:${item.pct}%;background:${item.color}"></div>
        </div>
      </div>`
    ).join(''));
  }

  /* ── Alert items ────────────────────────────────────────── */
  function renderAlerts(alerts) {
    html('alertsList', alerts.map(a => `
      <div class="alert-item ${a.type}">
        <div class="alert-icon">${a.icon}</div>
        <div class="alert-text">
          <div class="alert-title">${a.title}</div>
          <div class="alert-body">${a.body}</div>
        </div>
      </div>`
    ).join(''));
  }

  /* ══════════════════════════════════════════════════════════
     RIGHT PANEL — FORECAST TAB
     ══════════════════════════════════════════════════════════ */

  function renderForecastTables(storm) {
    /* Track table */
    html('trackTableBody', storm.forecast.track.map(row => `
      <tr ${row.isCurrent ? 'class="fc-now"' : ''}>
        <td>${row.time}</td>
        <td>${row.lat}</td>
        <td>${row.lon}</td>
        <td>${row.dist}</td>
      </tr>`
    ).join(''));

    /* Intensity table */
    html('intensityTableBody', storm.forecast.intensity.map(row => `
      <tr ${row.isCurrent ? 'class="fc-now"' : ''}>
        <td>${row.time}</td>
        <td class="${row.trend === 'up' ? 'trend-up' : row.trend === 'dn' ? 'trend-dn' : ''}">${row.wind}</td>
        <td>${row.pressure}</td>
        <td>${row.cls}</td>
      </tr>`
    ).join(''));
  }

  function renderUncertainty(items) {
    html('uncertaintyRows', (items || []).map(r => `
      <div class="unc-row">
        <span class="unc-lbl">${r.label}</span>
        <span class="unc-val">${r.value}</span>
      </div>`
    ).join(''));
  }

  /* ══════════════════════════════════════════════════════════
     RIGHT PANEL — XAI TAB
     ══════════════════════════════════════════════════════════ */

  function renderFeatureImportance(features) {
    html('featureList', (features || []).map(f => `
      <div class="feat-row">
        <span class="feat-name">${f.name}</span>
        <div class="feat-track">
          <div class="feat-fill" style="width:${f.pct}%;background:${f.color}"></div>
        </div>
        <span class="feat-pct">${f.pct}%</span>
      </div>`
    ).join(''));
  }

  function renderModelStack(models) {
    const defaultGrad = 'linear-gradient(to right, var(--blue), var(--teal))';
    html('modelStackList', (models || []).map(m => `
      <div class="model-item">
        <div class="model-row">
          <span class="model-name">${m.name}</span>
          <span class="model-pct">${m.pct.toFixed(1)}%</span>
        </div>
        <div class="model-track">
          <div class="model-fill" style="width:${m.pct}%;background:${m.color || defaultGrad}"></div>
        </div>
      </div>`
    ).join(''));
  }

  /* ══════════════════════════════════════════════════════════
     RIGHT PANEL — ENVIRONMENT TAB
     ══════════════════════════════════════════════════════════ */

  function renderEnvCards(cards) {
    html('envGrid', (cards || []).map(c => `
      <div class="env-card">
        <div class="env-lbl">${c.label}</div>
        <div class="env-val">${c.value} <span class="env-unit">${c.unit}</span></div>
        <div class="env-trend" style="color:${c.trendColor}">${c.trend}</div>
      </div>`
    ).join(''));
  }

  function renderERA5(rows, timestamp) {
    html('era5Rows', (rows || []).map(r => `
      <div class="unc-row">
        <span class="unc-lbl">${r.label}</span>
        <span class="unc-val">${r.value}</span>
      </div>`
    ).join(''));
    const ts = $('era5Timestamp');
    if (ts && timestamp) ts.textContent = `Last sync: ${timestamp}`;
  }

  function renderDataSources(sources) {
    html('dataSourcesList', (sources || []).map(s => `
      <div class="source-chip">
        <span>${s.icon}</span>
        <span><strong>${s.name}</strong> · ${s.desc}</span>
      </div>`
    ).join(''));
  }

  /* ══════════════════════════════════════════════════════════
     TAB SWITCHING
     ══════════════════════════════════════════════════════════ */

  function initTabs() {
    document.querySelectorAll('.r-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        document.querySelectorAll('.r-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${name}`));
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     NAV PILLS
     ══════════════════════════════════════════════════════════ */

  function initNavPills(onChange) {
    document.querySelectorAll('.nav-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        onChange(pill.dataset.view);
      });
    });
  }

  /* ── Public API ── */
  return {
    toast,
    startClock,
    renderStormCards,
    renderSatFeeds,
    renderLayerToggles,
    updateStormPanel,
    renderGauge,
    renderClassification,
    renderAlerts,
    renderForecastTables,
    renderUncertainty,
    renderFeatureImportance,
    renderModelStack,
    renderEnvCards,
    renderERA5,
    renderDataSources,
    initTabs,
    initNavPills
  };
})();
