/* ============================================================
   map.js — SVG map renderer + zoom controller
   ─────────────────────────────────────────────────────────────
   BACKEND INTEGRATION NOTE:
   When you switch to a real tile map (Leaflet / MapboxGL /
   OpenLayers), remove renderMap() and the SVG entirely.
   Keep updateDetectionOverlay(), updateMapAttr(), and the
   zoom helpers — they work against any map library.
   ============================================================ */

'use strict';

const Map = (() => {

  /* ── Coordinate → SVG pixel projection ─────────────────────
     Simple linear mapping tuned to the current 900×570 viewBox.
     Replace with proper projection when using real tiles.       */
  const VIEW_W = 900, VIEW_H = 570;
  const GEO = { minLon: 55, maxLon: 100, minLat: 0, maxLat: 35 };

  function project(lat, lon) {
    const x = ((lon - GEO.minLon) / (GEO.maxLon - GEO.minLon)) * VIEW_W;
    const y = VIEW_H - ((lat - GEO.minLat) / (GEO.maxLat - GEO.minLat)) * VIEW_H;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }

  /* ── SVG namespace helper ─────────────────────────────────── */
  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  /* ── Build the base map SVG ──────────────────────────────── */
  function buildBaseSVG() {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      xmlns: 'http://www.w3.org/2000/svg',
      id: 'mainSvg',
      style: 'width:100%;height:100%;display:block'
    });

    svg.innerHTML = `
      <defs>
        <radialGradient id="oceanG" cx="50%" cy="50%" r="70%">
          <stop offset="0%"   stop-color="#B8D9F0"/>
          <stop offset="100%" stop-color="#8EC5E8"/>
        </radialGradient>
        <radialGradient id="redGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stop-color="#E63946" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#E63946" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stop-color="#0077B6" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="#0077B6" stop-opacity="0"/>
        </radialGradient>
        <filter id="fblur3"><feGaussianBlur stdDeviation="3"/></filter>
        <filter id="fblur5"><feGaussianBlur stdDeviation="5"/></filter>
        <filter id="fshadow">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="rgba(30,58,95,0.2)"/>
        </filter>
      </defs>

      <!-- Ocean background -->
      <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#oceanG)"/>

      <!-- Lat/lon grid -->
      <g stroke="rgba(30,58,95,0.1)" stroke-width="0.5">
        ${[90,180,270,360,450,540,630,720,810].map(x=>`<line x1="${x}" y1="0" x2="${x}" y2="${VIEW_H}"/>`).join('')}
        ${[95,190,285,380,475].map(y=>`<line x1="0" y1="${y}" x2="${VIEW_W}" y2="${y}"/>`).join('')}
      </g>
      <g fill="rgba(30,58,95,0.3)" font-family="Fira Code, monospace" font-size="8.5">
        <text x="84"  y="92">60°E</text>
        <text x="174" y="92">70°E</text>
        <text x="264" y="92">80°E</text>
        <text x="354" y="92">90°E</text>
        <text x="4"   y="193">25°N</text>
        <text x="4"   y="288">15°N</text>
        <text x="4"   y="383"> 5°N</text>
      </g>

      <!-- Land masses -->
      <path d="M 235 40 L 295 50 L 348 68 L 368 95 L 378 135 L 362 172 L 335 205
               L 312 245 L 300 282 L 286 312 L 272 294 L 252 264 L 242 238
               L 232 210 L 222 182 L 218 155 L 222 125 L 226 95 L 230 65 Z"
        fill="#C8D8E8" stroke="rgba(30,58,95,0.25)" stroke-width="1" filter="url(#fshadow)"/>
      <text x="255" y="195" fill="rgba(30,58,95,0.5)"
        font-family="DM Sans, sans-serif" font-size="11" font-weight="600"
        letter-spacing="0.05em">INDIA</text>

      <!-- Sri Lanka -->
      <path d="M 292 325 L 302 335 L 297 350 L 288 345 Z"
        fill="#C8D8E8" stroke="rgba(30,58,95,0.2)" stroke-width="1"/>

      <!-- Arabian Peninsula -->
      <path d="M 0 0 L 95 0 L 128 35 L 138 72 L 118 112 L 98 132
               L 78 122 L 58 102 L 38 82 L 18 55 L 0 28 Z"
        fill="#C8D8E8" stroke="rgba(30,58,95,0.2)" stroke-width="1"/>
      <text x="22" y="75" fill="rgba(30,58,95,0.4)" font-family="DM Sans, sans-serif" font-size="8.5">ARABIAN</text>
      <text x="22" y="87" fill="rgba(30,58,95,0.4)" font-family="DM Sans, sans-serif" font-size="8.5">PENINSULA</text>

      <!-- Pakistan/Iran coast -->
      <path d="M 95 0 L 192 0 L 212 18 L 208 46 L 195 50 L 180 46
               L 158 36 L 138 35 L 128 35 Z"
        fill="#C8D8E8" stroke="rgba(30,58,95,0.2)" stroke-width="1"/>

      <!-- Myanmar / Bangladesh -->
      <path d="M 398 40 L 495 40 L 515 90 L 505 130 L 485 142
               L 465 122 L 446 92 L 426 72 L 408 55 Z"
        fill="#C8D8E8" stroke="rgba(30,58,95,0.2)" stroke-width="1"/>
      <text x="432" y="90" fill="rgba(30,58,95,0.4)"
        font-family="DM Sans, sans-serif" font-size="8.5">MYANMAR</text>

      <!-- Water labels -->
      <text x="380" y="248" fill="rgba(30,58,95,0.3)"
        font-family="DM Sans, sans-serif" font-size="13" font-weight="500"
        letter-spacing="0.04em">Bay of Bengal</text>
      <text x="92"  y="268" fill="rgba(30,58,95,0.3)"
        font-family="DM Sans, sans-serif" font-size="13" font-weight="500"
        letter-spacing="0.04em">Arabian Sea</text>
      <text x="265" y="480" fill="rgba(30,58,95,0.22)"
        font-family="DM Sans, sans-serif" font-size="14" font-weight="500"
        letter-spacing="0.06em">Indian Ocean</text>
    `;
    return svg;
  }

  /* ── Render one storm's track layers onto the SVG ───────── */
  function renderStormTrack(svg, storm, isActive) {
    const histPts = storm.track.historical.map(p => project(p.lat, p.lon));
    const predPts = storm.track.predicted.map(p => project(p.lat, p.lon));
    const cur     = project(storm.lat, storm.lon);

    /* colours */
    const isWarn = storm.isWarning;
    const trackCol   = isWarn ? 'rgba(230,57,70,0.8)'   : 'rgba(0,119,182,0.8)';
    const histCol    = isWarn ? 'rgba(230,57,70,0.5)'   : 'rgba(0,119,182,0.5)';
    const glowId     = isWarn ? 'redGlow' : 'blueGlow';
    const eyeStroke  = isWarn ? '#E63946' : '#0077B6';
    const labelFill  = isWarn ? '#E63946' : '#0077B6';
    const labelBorder= isWarn ? 'rgba(230,57,70,0.4)' : 'rgba(0,119,182,0.3)';

    /* ── Historical group ── */
    const gHist = svgEl('g', { id: `g-historical-${storm.id}` });
    if (histPts.length > 1) {
      gHist.appendChild(svgEl('polyline', {
        points: histPts.map(p => `${p.x},${p.y}`).join(' '),
        fill: 'none', stroke: histCol, 'stroke-width': '1.5',
        'stroke-dasharray': '5,3'
      }));
    }
    histPts.forEach((p, i) => {
      const r = 3 + i * 0.25;
      const c = svgEl('circle', { cx: p.x, cy: p.y, r, fill: histCol, stroke: 'white', 'stroke-width': '1' });
      gHist.appendChild(c);
    });
    svg.appendChild(gHist);

    /* ── Glow ── */
    svg.appendChild(svgEl('circle', {
      cx: cur.x, cy: cur.y, r: 32,
      fill: `url(#${glowId})`, filter: 'url(#fblur5)'
    }));

    /* ── Uncertainty cone ── */
    if (predPts.length >= 2) {
      const tip   = predPts[predPts.length - 1];
      const spread = 28;
      const gUnc = svgEl('g', { id: `g-uncertainty-${storm.id}` });
      const pathD = `M ${cur.x} ${cur.y} L ${tip.x - spread} ${tip.y}
                     Q ${tip.x} ${tip.y - 10}, ${tip.x + spread} ${tip.y} Z`;
      gUnc.appendChild(svgEl('path', {
        d: pathD,
        fill: isWarn ? 'rgba(230,57,70,0.07)' : 'rgba(0,119,182,0.06)',
        stroke: isWarn ? 'rgba(230,57,70,0.28)' : 'rgba(0,119,182,0.25)',
        'stroke-width': '1', 'stroke-dasharray': '4,3'
      }));
      svg.appendChild(gUnc);
    }

    /* ── Predicted track ── */
    const gPred = svgEl('g', { id: `g-predicted-${storm.id}` });
    if (predPts.length > 0) {
      const allPts = [cur, ...predPts];
      gPred.appendChild(svgEl('polyline', {
        points: allPts.map(p => `${p.x},${p.y}`).join(' '),
        fill: 'none', stroke: trackCol, 'stroke-width': '2.5',
        'stroke-dasharray': '6,4'
      }));
      predPts.forEach((p, i) => {
        const wp = storm.track.predicted[i];
        const c  = svgEl('circle', {
          cx: p.x, cy: p.y, r: 5,
          fill: 'white', stroke: eyeStroke,
          'stroke-width': wp.uncertain ? '1.5' : '2',
          ...(wp.uncertain ? { 'stroke-dasharray': '2,2' } : {})
        });
        gPred.appendChild(c);
        const t = svgEl('text', {
          x: p.x + 6, y: p.y - 2,
          fill: labelFill, 'font-family': 'Fira Code, monospace',
          'font-size': '9', 'font-weight': '600'
        });
        t.textContent = wp.label;
        gPred.appendChild(t);
      });
    }
    svg.appendChild(gPred);

    /* ── Animated pulse rings ── */
    [{ r: 22, dur: '2.8s', begin: '0s' }, { r: 15, dur: '2.8s', begin: '0.6s' }].forEach(({ r, dur, begin }) => {
      const ring = svgEl('circle', {
        cx: cur.x, cy: cur.y, r,
        fill: 'none', stroke: isWarn ? 'rgba(230,57,70,0.35)' : 'rgba(0,119,182,0.3)',
        'stroke-width': '1.5'
      });
      ring.innerHTML = `
        <animate attributeName="r"       values="${r};${r + 10};${r}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.7;0;0.7"           dur="${dur}" begin="${begin}" repeatCount="indefinite"/>`;
      svg.appendChild(ring);
    });

    /* ── Eye ── */
    svg.appendChild(svgEl('circle', { cx: cur.x, cy: cur.y, r: 8, fill: isWarn ? 'rgba(230,57,70,0.18)' : 'rgba(0,119,182,0.15)', stroke: eyeStroke, 'stroke-width': '2.5' }));
    svg.appendChild(svgEl('circle', { cx: cur.x, cy: cur.y, r: 3, fill: eyeStroke }));

    /* ── Spiral arms (VSCS+ only) ── */
    if (isWarn) {
      [
        `M ${cur.x} ${cur.y} Q ${cur.x+16} ${cur.y-15},${cur.x+26} ${cur.y-9} Q ${cur.x+35} ${cur.y-3},${cur.x+30} ${cur.y+8}`,
        `M ${cur.x} ${cur.y} Q ${cur.x-16} ${cur.y+15},${cur.x-26} ${cur.y+9} Q ${cur.x-35} ${cur.y+3},${cur.x-28} ${cur.y-9}`
      ].forEach(d => {
        svg.appendChild(svgEl('path', { d, fill: 'none', stroke: 'rgba(230,57,70,0.22)', 'stroke-width': '1.5', 'stroke-linecap': 'round' }));
      });
    }

    /* ── Label chip ── */
    const chipX = cur.x + 14, chipY = cur.y - 10;
    const chip  = svgEl('g');
    chip.appendChild(svgEl('rect', { x: chipX, y: chipY, width: 110, height: 32, rx: '5', fill: 'rgba(255,255,255,0.92)', stroke: labelBorder, 'stroke-width': '1', filter: 'url(#fshadow)' }));
    const t1 = svgEl('text', { x: chipX + 7, y: chipY + 13, fill: labelFill, 'font-family': 'DM Sans, sans-serif', 'font-size': '10', 'font-weight': '700' });
    t1.textContent = storm.name;
    const t2 = svgEl('text', { x: chipX + 7, y: chipY + 26, fill: 'rgba(30,58,95,0.55)', 'font-family': 'Fira Code, monospace', 'font-size': '8.5' });
    t2.textContent = `${storm.categoryLabel} · ${storm.wind} km/h`;
    chip.appendChild(t1);
    chip.appendChild(t2);
    svg.appendChild(chip);

    /* ── Landfall warning (VSCS+ only) ── */
    if (isWarn) {
      const lfPt = project(22.5, 69.2);
      svg.appendChild(svgEl('path', { d: `M ${cur.x} ${cur.y} Q ${(cur.x+lfPt.x)/2} ${cur.y-30}, ${lfPt.x} ${lfPt.y}`, fill: 'none', stroke: 'rgba(230,57,70,0.45)', 'stroke-width': '1.8', 'stroke-dasharray': '7,4' }));
      const lfw = svgEl('g');
      lfw.appendChild(svgEl('rect', { x: lfPt.x - 40, y: lfPt.y - 14, width: 86, height: 28, rx: '4', fill: 'rgba(255,255,255,0.9)', stroke: 'rgba(230,57,70,0.35)', 'stroke-width': '1' }));
      const lt1 = svgEl('text', { x: lfPt.x - 33, y: lfPt.y - 1, fill: '#E63946', 'font-family': 'DM Sans, sans-serif', 'font-size': '9.5', 'font-weight': '700' });
      lt1.textContent = '⚠ Landfall';
      const lt2 = svgEl('text', { x: lfPt.x - 33, y: lfPt.y + 10, fill: 'rgba(30,58,95,0.55)', 'font-family': 'Fira Code, monospace', 'font-size': '8' });
      lt2.textContent = '~34–38h';
      lfw.appendChild(lt1); lfw.appendChild(lt2);
      svg.appendChild(lfw);
    }
  }

  /* ── Public: render the whole map ──────────────────────── */
  function renderMap(storms) {
    const wrapper = document.getElementById('mapSvgWrapper');
    wrapper.innerHTML = '';
    const svg = buildBaseSVG();
    storms.forEach(storm => renderStormTrack(svg, storm));
    wrapper.appendChild(svg);
    _attachZoom();
  }

  /* ── Public: update AI detection overlay ───────────────── */
  function updateDetectionOverlay(storm) {
    if (!storm) return;
    const d = storm.detection;
    document.getElementById('detectTitle').textContent = `AI Detection · ${storm.name}`;
    document.getElementById('detectStatus').textContent = d.status;
    document.getElementById('detectConf').textContent   = `${d.confidence}%`;
    document.getElementById('detectCenter').textContent = d.center;
    document.getElementById('detectModel').textContent  = d.model;
    document.getElementById('detectConfBar').style.width = `${d.confidence}%`;
  }

  /* ── Public: update map attribution bar ────────────────── */
  function updateMapAttr(text) {
    document.getElementById('mapAttr').textContent = text;
  }

  /* ── Layer visibility toggle ───────────────────────────── */
  function setLayerVisible(groupIdSuffix, visible) {
    // Try both patterns: with and without storm-id suffix
    document.querySelectorAll(`[id^="${groupIdSuffix}"]`).forEach(el => {
      el.style.display = visible ? '' : 'none';
    });
  }

  /* ── Zoom ─────────────────────────────────────────────── */
  let _zoomLevel = 1;

  function _attachZoom() {
    document.getElementById('zoomIn')   ?.addEventListener('click', () => zoom(1));
    document.getElementById('zoomOut')  ?.addEventListener('click', () => zoom(-1));
    document.getElementById('zoomReset')?.addEventListener('click', resetZoom);
  }

  function zoom(dir) {
    _zoomLevel = Math.max(0.5, Math.min(3, _zoomLevel + dir * 0.2));
    _applyZoom();
    return _zoomLevel;
  }

  function resetZoom() {
    _zoomLevel = 1;
    _applyZoom();
  }

  function _applyZoom() {
    const svg = document.getElementById('mainSvg');
    if (svg) svg.style.transform = _zoomLevel === 1 ? '' : `scale(${_zoomLevel})`;
  }

  function getZoom() { return _zoomLevel; }

  /* ── Public API ── */
  return { renderMap, updateDetectionOverlay, updateMapAttr, setLayerVisible, zoom, resetZoom, getZoom };
})();
