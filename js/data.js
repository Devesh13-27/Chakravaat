/* ============================================================
   data.js — Mock data layer
   ─────────────────────────────────────────────────────────────
   HOW TO INTEGRATE YOUR BACKEND:
   Replace each exported constant with an async fetch() call
   to your API endpoint, then call app.init() after the data
   resolves.  The rest of the codebase reads only from these
   objects, so nothing else needs to change.

   Example pattern:
     const res  = await fetch('/api/v1/storms/active');
     const data = await res.json();
     window.STORM_DATA = data.storms;

   API contract expected by ui.js / map.js is documented
   inline next to each field.
   ============================================================ */

'use strict';

/* ── Active storm list ──────────────────────────────────────
   Array of storm objects shown in the left panel and on the map.
   Fields:
     id          : unique string key
     name        : display name
     category    : IMD classification key  (vscs | escs | scs | cs | dd | d)
     categoryLabel: short label for the badge
     lat, lon    : current centre (decimal degrees)
     wind        : max sustained wind (km/h)
     pressure    : central pressure (hPa)
     direction   : movement direction string
     speed       : movement speed (km/h)
     intensitySteps: total segments in the strip indicator
     activeSteps : filled (coloured) segments
     isWarning   : true → red card variant
     detection   : AI detection metadata (shown in the map overlay)
     classification: array of { label, pct, color } for confidence bars
     intensityConf : model confidence for intensity estimate (0–100)
     track       : { historical: [{lat,lon}], predicted: [{lat,lon,label}] }
     forecast    : { track: rows[], intensity: rows[] }
     uncertainty : array of { label, value }
     alerts      : array of { type:'crit'|'warn'|'info', icon, title, body }
     features    : Grad-CAM feature importance array [{ name, pct, color }]
     modelStack  : array of { name, pct, color? }
─────────────────────────────────────────────────────────────── */
window.STORM_DATA = [
  {
    id: 'biparjoy',
    name: 'BIPARJOY-2',
    category: 'vscs',
    categoryLabel: 'VSCS',
    lat: 14.2, lon: 72.6,
    wind: 105, pressure: 978,
    direction: 'NNE', speed: 18,
    intensitySteps: 6, activeSteps: 4,
    isWarning: true,

    detection: {
      status: 'Confirmed',
      confidence: 96.7,
      center: '14.2°N 72.6°E',
      model: 'ConvNeXt-L'
    },

    classification: [
      { label: 'Very Severe Cyclonic Storm', pct: 74.2, color: 'var(--red)'  },
      { label: 'Severe Cyclonic Storm',      pct: 18.5, color: 'var(--blue)' },
      { label: 'Extremely Severe',           pct:  6.1, color: 'var(--amber)'},
      { label: 'Cyclonic Storm',             pct:  1.2, color: 'var(--teal)' }
    ],
    intensityConf: 91,

    track: {
      /* historical positions — oldest first */
      historical: [
        { lat: 11.8, lon: 71.0 },
        { lat: 12.0, lon: 71.2 },
        { lat: 12.5, lon: 71.5 },
        { lat: 13.0, lon: 71.8 },
        { lat: 13.5, lon: 72.0 },
        { lat: 13.8, lon: 72.3 },
        { lat: 14.0, lon: 72.5 },
        { lat: 14.1, lon: 72.55}
      ],
      /* predicted waypoints */
      predicted: [
        { lat: 14.7, lon: 72.9, label: '+6h'  },
        { lat: 15.3, lon: 73.3, label: '+12h' },
        { lat: 16.4, lon: 74.2, label: '+24h' },
        { lat: 18.0, lon: 68.2, label: '+48h', uncertain: true }
      ]
    },

    forecast: {
      track: [
        { time: 'Now',    lat: '14.2°N', lon: '72.6°E', dist: '—',     isCurrent: true  },
        { time: '+6 h',   lat: '14.7°N', lon: '73.3°E', dist: '89 km'  },
        { time: '+12 h',  lat: '15.3°N', lon: '74.1°E', dist: '183 km' },
        { time: '+24 h',  lat: '16.4°N', lon: '75.6°E', dist: '374 km' },
        { time: '+48 h*', lat: '18.2°N', lon: '68.2°E', dist: '—'      }
      ],
      intensity: [
        { time: 'Now',   wind: '105 km/h', pressure: '978 hPa', cls: 'VSCS', isCurrent: true  },
        { time: '+6 h',  wind: '112 km/h', pressure: '974 hPa', cls: 'VSCS', trend: 'up' },
        { time: '+12 h', wind: '120 km/h', pressure: '970 hPa', cls: 'ESCS', trend: 'up' },
        { time: '+24 h', wind: '135 km/h', pressure: '962 hPa', cls: 'ESCS', trend: 'up' },
        { time: '+48 h', wind: '90 km/h',  pressure: '985 hPa', cls: 'SCS',  trend: 'dn' }
      ]
    },

    uncertainty: [
      { label: '+6 h track corridor',  value: '± 42 km'  },
      { label: '+12 h track corridor', value: '± 85 km'  },
      { label: '+24 h track corridor', value: '± 145 km' },
      { label: '+48 h track corridor', value: '± 248 km' }
    ],

    alerts: [
      {
        type: 'crit', icon: '⚡',
        title: 'Landfall Alert — Gujarat Coast',
        body:  'AI predicts landfall near Mandvi/Jakhau in ~34–38 hrs. Estimated 95–110 km/h at landfall.'
      },
      {
        type: 'warn', icon: '📈',
        title: 'Rapid Intensification Signal',
        body:  'SST 30–31°C with low wind shear. RI possible over next 12 hrs.'
      },
      {
        type: 'info', icon: 'ℹ',
        title: 'Secondary System — MOCHA',
        body:  'Deep Depression developing in Bay of Bengal. Monitoring for intensification.'
      }
    ],

    features: [
      { name: 'Spiral cloud structure', pct: 87, color: 'var(--blue)'  },
      { name: 'Cold cloud-top temp',    pct: 76, color: 'var(--red)'   },
      { name: 'Eye diameter (est.)',    pct: 64, color: 'var(--blue)'  },
      { name: 'SST anomaly',            pct: 55, color: 'var(--teal)'  },
      { name: 'Convective symmetry',    pct: 48, color: 'var(--blue)'  },
      { name: 'Pressure gradient',      pct: 39, color: 'var(--teal)'  }
    ],

    modelStack: [
      { name: 'Detection — ConvNeXt-L',           pct: 96.7 },
      { name: 'Classification — EfficientNet-B4', pct: 74.2, color: 'linear-gradient(to right, var(--red), var(--amber))' },
      { name: 'Intensity — CNN Regression',        pct: 91.0 },
      { name: 'Track — Temporal Transformer',      pct: 88.3 }
    ]
  },

  {
    id: 'mocha',
    name: 'MOCHA',
    category: 'dd',
    categoryLabel: 'Deep Depression',
    lat: 10.8, lon: 85.3,
    wind: 55, pressure: 1004,
    direction: 'N', speed: 9,
    intensitySteps: 6, activeSteps: 2,
    isWarning: false,

    detection: {
      status: 'Confirmed',
      confidence: 82.4,
      center: '10.8°N 85.3°E',
      model: 'ConvNeXt-L'
    },

    classification: [
      { label: 'Deep Depression',  pct: 68.0, color: 'var(--amber)' },
      { label: 'Cyclonic Storm',   pct: 22.5, color: 'var(--blue)'  },
      { label: 'Depression',       pct:  7.0, color: 'var(--teal)'  },
      { label: 'Disturbance',      pct:  2.5, color: 'var(--text-muted)' }
    ],
    intensityConf: 78,

    track: {
      historical: [
        { lat:  9.0, lon: 85.5 },
        { lat:  9.5, lon: 85.4 },
        { lat: 10.0, lon: 85.4 },
        { lat: 10.4, lon: 85.3 }
      ],
      predicted: [
        { lat: 11.2, lon: 85.2, label: '+6h'  },
        { lat: 11.9, lon: 85.1, label: '+12h' },
        { lat: 13.2, lon: 85.0, label: '+24h' }
      ]
    },

    forecast: {
      track: [
        { time: 'Now',   lat: '10.8°N', lon: '85.3°E', dist: '—',     isCurrent: true },
        { time: '+6 h',  lat: '11.2°N', lon: '85.2°E', dist: '45 km'  },
        { time: '+12 h', lat: '11.9°N', lon: '85.1°E', dist: '123 km' },
        { time: '+24 h', lat: '13.2°N', lon: '85.0°E', dist: '265 km' }
      ],
      intensity: [
        { time: 'Now',   wind: '55 km/h', pressure: '1004 hPa', cls: 'DD', isCurrent: true },
        { time: '+6 h',  wind: '60 km/h', pressure: '1001 hPa', cls: 'DD', trend: 'up' },
        { time: '+12 h', wind: '70 km/h', pressure: '996 hPa',  cls: 'CS', trend: 'up' },
        { time: '+24 h', wind: '85 km/h', pressure: '988 hPa',  cls: 'CS', trend: 'up' }
      ]
    },

    uncertainty: [
      { label: '+6 h track corridor',  value: '± 38 km'  },
      { label: '+12 h track corridor', value: '± 72 km'  },
      { label: '+24 h track corridor', value: '± 130 km' }
    ],

    alerts: [
      {
        type: 'warn', icon: '🌀',
        title: 'Development Watch — Bay of Bengal',
        body:  'Conditions favour organisation into a Cyclonic Storm within 24–36 hrs.'
      },
      {
        type: 'info', icon: 'ℹ',
        title: 'Monitoring Active',
        body:  'IMD issuing regular bulletins. Satellite reconnaissance ongoing.'
      }
    ],

    features: [
      { name: 'Convective cluster',  pct: 72, color: 'var(--blue)'  },
      { name: 'Low-level vorticity', pct: 61, color: 'var(--teal)'  },
      { name: 'SST anomaly',         pct: 50, color: 'var(--teal)'  },
      { name: 'Wind shear pattern',  pct: 38, color: 'var(--amber)' }
    ],

    modelStack: [
      { name: 'Detection — ConvNeXt-L',           pct: 82.4 },
      { name: 'Classification — EfficientNet-B4', pct: 68.0, color: 'linear-gradient(to right, var(--amber), var(--blue))' },
      { name: 'Intensity — CNN Regression',        pct: 78.0 },
      { name: 'Track — Temporal Transformer',      pct: 80.5 }
    ]
  }
];

/* ── Satellite feed list ─────────────────────────────────── */
window.SAT_FEEDS = [
  { name: 'INSAT-3DR',   freq: 'IR 10.8μm · 30 min', status: 'ok'      },
  { name: 'Himawari-9',  freq: 'VIS + IR · 10 min',   status: 'ok'      },
  { name: 'NOAA HURSAT', freq: 'Archive · historical', status: 'delayed' }
];

/* ── Map layer definitions ───────────────────────────────── */
window.MAP_LAYERS = [
  { id: 'g-predicted',   label: 'Predicted Track',     color: 'var(--red)',                                              on: true  },
  { id: 'g-uncertainty', label: 'Uncertainty Cone',    color: 'rgba(230,57,70,0.3)', border: '1px solid var(--red)',    on: true  },
  { id: 'g-historical',  label: 'Historical Positions', color: 'var(--blue)',                                            on: true  },
  { id: 'g-sst',         label: 'Sea Surface Temp',    color: 'var(--teal)',                                             on: false },
  { id: 'g-shear',       label: 'Wind Shear',          color: 'var(--amber)',                                            on: false },
  { id: 'g-cloud',       label: 'Cloud Top Temp',      color: '#9B59B6',                                                 on: true  },
  { id: 'g-pressure',    label: 'Pressure Contours',   color: 'var(--navy-mid)',                                         on: false }
];

/* ── Environmental / ERA5 data ───────────────────────────── */
window.ENV_DATA = {
  /* Replace with: GET /api/v1/environment?storm=<id>&time=<iso> */
  biparjoy: {
    cards: [
      { label: 'Sea Surface Temp', value: '30.4', unit: '°C',     trend: '↑ +1.2°C anomaly', trendColor: 'var(--red)'  },
      { label: 'Wind Shear',       value: '8',    unit: 'm/s',    trend: '↓ Low — favors RI', trendColor: 'var(--teal)' },
      { label: 'Atm. Humidity',    value: '82',   unit: '%',      trend: '→ Stable',           trendColor: 'var(--blue)' },
      { label: '850 hPa Vorticity',value: '4.2',  unit: '×10⁻⁵', trend: '↑ Increasing',       trendColor: 'var(--red)'  },
      { label: 'Ocean Heat',       value: '72',   unit: 'kJ/cm²', trend: 'High',               trendColor: 'var(--red)'  },
      { label: 'Outflow Channel',  value: '2',    unit: 'axes',   trend: 'Favorable',          trendColor: 'var(--teal)' }
    ],
    era5: [
      { label: 'Pressure at 850 hPa', value: '852 hPa'    },
      { label: '850–200 hPa shear',   value: '7.8 m/s'    },
      { label: 'Divergence at 200 hPa', value: '2.1×10⁻⁵' }
    ],
    era5Timestamp: '2024-06-14 06:00 UTC · 0.25°×0.25°'
  },
  mocha: {
    cards: [
      { label: 'Sea Surface Temp', value: '29.1', unit: '°C',     trend: '↑ +0.8°C anomaly', trendColor: 'var(--amber)' },
      { label: 'Wind Shear',       value: '14',   unit: 'm/s',    trend: '→ Moderate',        trendColor: 'var(--amber)' },
      { label: 'Atm. Humidity',    value: '78',   unit: '%',      trend: '→ Stable',          trendColor: 'var(--blue)'  },
      { label: '850 hPa Vorticity',value: '2.8',  unit: '×10⁻⁵', trend: '↑ Rising',          trendColor: 'var(--amber)' },
      { label: 'Ocean Heat',       value: '55',   unit: 'kJ/cm²', trend: 'Moderate',          trendColor: 'var(--amber)' },
      { label: 'Outflow Channel',  value: '1',    unit: 'axis',   trend: 'Marginal',          trendColor: 'var(--amber)' }
    ],
    era5: [
      { label: 'Pressure at 850 hPa', value: '860 hPa'    },
      { label: '850–200 hPa shear',   value: '13.2 m/s'   },
      { label: 'Divergence at 200 hPa', value: '1.4×10⁻⁵' }
    ],
    era5Timestamp: '2024-06-14 06:00 UTC · 0.25°×0.25°'
  }
};

/* ── Data source attribution ─────────────────────────────── */
window.DATA_SOURCES = [
  { icon: '📡', name: 'INSAT-3DR',  desc: 'ISRO/IMD IR+WV'         },
  { icon: '🛰',  name: 'Himawari-9', desc: 'JMA 10-min bands'        },
  { icon: '🌊',  name: 'ERA5',       desc: 'ECMWF Reanalysis v5'     },
  { icon: '📊',  name: 'IBTrACS',    desc: 'NOAA Best Track'         },
  { icon: '🌡',  name: 'OISST',      desc: 'NOAA SST 0.25°'          }
];

/* ── Timeline date labels ────────────────────────────────── */
window.TIMELINE_DATES = [
  'Jun 10 · 00:00', 'Jun 10 · 12:00',
  'Jun 11 · 00:00', 'Jun 11 · 12:00',
  'Jun 12 · 00:00', 'Jun 12 · 12:00',
  'Jun 13 · 00:00', 'Jun 13 · 12:00',
  'Jun 14 · 00:00', 'Jun 14 · 12:00',
  'Jun 15 · 00:00'
];
window.TIMELINE_TICK_LABELS = ['Jun 10','Jun 11','Jun 12','Jun 13','Jun 14','Jun 15'];
