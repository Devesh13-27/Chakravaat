# Chakravaat — Tropical Cyclone Intelligence System
**Frontend UI · SIH Project**

A professional meteorological decision-support dashboard for AI-powered cyclone monitoring, tracking, and prediction.

---

## File Structure

```
Chakravaat/
├── index.html              ← Entry point (all panels, all tab markup)
├── README.md
│
├── css/
│   ├── variables.css       ← Design tokens (colours, spacing, shadows)
│   ├── base.css            ← Reset, typography, global utilities, animations
│   ├── topbar.css          ← Top navigation bar
│   ├── left-panel.css      ← Storm cards, satellite feeds, layer toggles
│   ├── map.css             ← Map container, overlays, replay bar, Grad-CAM
│   └── right-panel.css     ← Intelligence, Forecast, XAI, Environment tabs
│
└── js/
    ├── data.js             ← Mock data (replace with API calls)
    ├── map.js              ← SVG map renderer + zoom controller
    ├── timeline.js         ← Replay timeline, play/pause, scrub, speed
    ├── ui.js               ← All DOM rendering functions
    └── app.js              ← Application controller (wires everything)
```

---

## Quick Start

No build step required — pure HTML/CSS/JS.

```bash
# Serve locally (any static server works)
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080` in your browser.

---

## Backend Integration

### 1 · Replace mock data with API calls

Open `js/data.js`. Every `window.*` constant maps to one API endpoint.
Replace the static values with `fetch()` calls before calling `App.init()`.

```js
// js/data.js — example replacement
const res = await fetch('/api/v1/storms/active');
window.STORM_DATA = await res.json();   // must match the schema below

App.init();   // call AFTER data is loaded
```

### 2 · Data schema expected by the UI

```
STORM_DATA  → array of storm objects (see full schema in data.js)
SAT_FEEDS   → [{ name, freq, status:'ok'|'delayed'|'offline' }]
MAP_LAYERS  → [{ id, label, color, on:bool }]
ENV_DATA    → { [stormId]: { cards[], era5[], era5Timestamp } }
DATA_SOURCES→ [{ icon, name, desc }]
TIMELINE_DATES      → string[] of date labels (fine-grained)
TIMELINE_TICK_LABELS→ string[] of tick axis labels (coarse)
```

### 3 · Live timeline snapshots

In `js/app.js`, the `onTimelineTick(progress, dateLabel)` callback fires
on every animation frame during replay.  Add your historical fetch here:

```js
async function onTimelineTick(progress, dateLabel) {
  const iso  = progressToISO(progress);   // implement your own mapping
  const snap = await fetch(`/api/v1/storms/history?t=${iso}`).then(r => r.json());
  Map.renderMap(snap.storms);
  UI.updateStormPanel(snap.storms.find(s => s.id === _activeStormId));
}
```

### 4 · Real tile map (Leaflet / MapboxGL)

1. Remove the `Map.buildBaseSVG()` call in `js/map.js`.
2. Replace `#mapSvgWrapper` contents with your tile map container.
3. Keep `updateDetectionOverlay()`, `updateMapAttr()`, and `setLayerVisible()` — they don't depend on SVG.
4. Re-implement `renderStormTrack()` using your map library's Polyline / Marker / Polygon APIs.

### 5 · Real Grad-CAM images

In `index.html`, replace the `.gradcam-inner` placeholder with:

```html
<img id="gradcamImg"
     src="/api/v1/gradcam?storm=biparjoy"
     style="width:100%;height:100%;object-fit:cover"
     alt="Grad-CAM saliency map"/>
```

Update the `src` whenever the active storm changes in `app.js → selectStorm()`.

---

## Colour Palette (css/variables.css)

| Token          | Value     | Usage                        |
|----------------|-----------|------------------------------|
| `--navy`       | `#1E3A5F` | Primary text, headings       |
| `--blue`       | `#0077B6` | Active state, data accent    |
| `--teal`       | `#2A9D8F` | Safe/stable indicators       |
| `--red`        | `#E63946` | Warnings, high-intensity     |
| `--amber`      | `#F4A261` | Moderate alerts              |
| `--surface`    | `#FFFFFF` | Panel backgrounds            |
| `--bg`         | `#EEF2F7` | Page background              |

---

## Typography

| Family       | Role                                      |
|--------------|-------------------------------------------|
| `DM Sans`    | All UI text, labels, buttons              |
| `Fira Code`  | Coordinates, data readouts, timestamps    |

---

## Key UI Components

| Component            | File              | JS function                    |
|----------------------|-------------------|--------------------------------|
| Storm cards          | left-panel.css    | `UI.renderStormCards()`        |
| Satellite feeds      | left-panel.css    | `UI.renderSatFeeds()`          |
| Layer toggles        | left-panel.css    | `UI.renderLayerToggles()`      |
| SVG map              | map.js            | `Map.renderMap()`              |
| Detection overlay    | map.css           | `Map.updateDetectionOverlay()` |
| Replay timeline      | timeline.js       | `Timeline.init()`              |
| Intensity gauge      | right-panel.css   | `UI.renderGauge()`             |
| Classification bars  | right-panel.css   | `UI.renderClassification()`    |
| Forecast tables      | right-panel.css   | `UI.renderForecastTables()`    |
| Feature importance   | right-panel.css   | `UI.renderFeatureImportance()` |
| Env cards            | right-panel.css   | `UI.renderEnvCards()`          |

---

## IMD Classification Reference

| Code   | Label                        |
|--------|------------------------------|
| `d`    | Disturbance                  |
| `dd`   | Deep Depression              |
| `cs`   | Cyclonic Storm               |
| `scs`  | Severe Cyclonic Storm        |
| `vscs` | Very Severe Cyclonic Storm   |
| `escs` | Extremely Severe Cyclonic Storm |

---

## Notes

- This dashboard is an **AI-powered decision-support tool**, not a replacement for official IMD forecasts.
- All prediction uncertainty values must be prominently displayed alongside any track or intensity predictions.
- The +48h forecast should always be visually distinguished (dashed circle on the map, asterisk in tables) to indicate higher uncertainty.
