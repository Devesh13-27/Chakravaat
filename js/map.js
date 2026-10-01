/* =========================================================
   CHAKRAVAAT — GOOGLE MAPS RENDERER
   ========================================================= */

const ChakravaatMap = (() => {
  // -------------------------------------------------------
  // Configuration
  // -------------------------------------------------------

  const DEFAULT_CENTER = {
    lat: 16.5,
    lng: 82.0
  };

  const DEFAULT_ZOOM = 5;

  let mapInstance = null;
  let mapsReadyPromise = null;

  const overlayGroups = {
    historical: [],
    predicted: [],
    uncertainty: [],
    current: [],
    landfall: [],
    sst: [],
    shear: [],
    cloud: [],
    pressure: []
  };

  let currentStormOverlays = [];
  let pulseAnimationIds = [];

  // -------------------------------------------------------
  // Google Maps Loader
  // -------------------------------------------------------

  function loadGoogleMaps() {

    if (window.google && window.google.maps) {
      return Promise.resolve();
    }

    if (mapsReadyPromise) {
      return mapsReadyPromise;
    }

    const config =
      window.CHAKRAVAAT_CONFIG || {};

    const apiKey =
      config.googleMapsApiKey;

    if (!apiKey) {
      return Promise.reject(
        new Error(
          "Google Maps API key not found. Check js/config.local.js"
        )
      );
    }

    mapsReadyPromise =
      new Promise((resolve, reject) => {

        const callbackName =
          "__chakravaatGoogleMapsReady";

        window[callbackName] = () => {

          console.log(
            "Chakravaat: Google Maps API loaded."
          );

          resolve();
        };

        const script =
          document.createElement("script");

        script.src =
          "https://maps.googleapis.com/maps/api/js" +
          "?key=" +
          encodeURIComponent(apiKey) +
          "&libraries=geometry" +
          "&v=weekly" +
          "&callback=" +
          callbackName;

        script.async = true;
        script.defer = true;

        script.onerror = () => {

          reject(
            new Error(
              "Failed to load Google Maps JavaScript API."
            )
          );
        };

        document.head.appendChild(script);
      });

    return mapsReadyPromise;
  }
  // -------------------------------------------------------
  // Map Initialization
  // -------------------------------------------------------

async function initMap() {

  if (mapInstance) {
    return mapInstance;
  }

  await loadGoogleMaps();

  const container =
    document.getElementById(
      "mapSvgWrapper"
    );

  if (!container) {

    throw new Error(
      "Map container #mapSvgWrapper was not found."
    );
  }

  container.innerHTML = "";

  console.log(
    "Google Maps version:",
    google.maps.version
  );

  console.log(
    "Google Maps constructor:",
    typeof google.maps.Map
  );

  mapInstance =
    new google.maps.Map(
      container,
      {

        center: DEFAULT_CENTER,

        zoom: DEFAULT_ZOOM,

        minZoom: 3,

        maxZoom: 10,

        mapTypeId: "roadmap",

        backgroundColor:
          "#07111F",

        disableDefaultUI: true,

        clickableIcons: false,

        keyboardShortcuts: true,

        gestureHandling: "greedy",

        styles:
          getDarkMapStyle()
      }
    );

  return mapInstance;
}

  // -------------------------------------------------------
  // Premium Dark Meteorological Map Style
  // -------------------------------------------------------

  function getDarkMapStyle() {

    return [

      {
        elementType: "geometry",
        stylers: [
          { color: "#07111F" }
        ]
      },

      {
        elementType: "labels.text.fill",
        stylers: [
          { color: "#8FAEC4" }
        ]
      },

      {
        elementType: "labels.text.stroke",
        stylers: [
          { color: "#07111F" }
        ]
      },

      {
        featureType: "administrative.country",
        elementType: "geometry.stroke",
        stylers: [
          { color: "#27506B" },
          { weight: 1.2 }
        ]
      },

      {
        featureType: "administrative.province",
        elementType: "geometry.stroke",
        stylers: [
          { color: "#17374D" },
          { weight: 0.7 }
        ]
      },

      {
        featureType: "landscape",
        elementType: "geometry",
        stylers: [
          { color: "#102238" }
        ]
      },

      {
        featureType: "landscape.natural",
        elementType: "geometry",
        stylers: [
          { color: "#0D1E31" }
        ]
      },

      {
        featureType: "water",
        elementType: "geometry",
        stylers: [
          { color: "#061421" }
        ]
      },

      {
        featureType: "water",
        elementType: "labels.text.fill",
        stylers: [
          { color: "#285D78" }
        ]
      },

      {
        featureType: "road",
        elementType: "geometry",
        stylers: [
          { visibility: "off" }
        ]
      },

      {
        featureType: "road",
        elementType: "labels",
        stylers: [
          { visibility: "off" }
        ]
      },

      {
        featureType: "poi",
        stylers: [
          { visibility: "off" }
        ]
      },

      {
        featureType: "transit",
        stylers: [
          { visibility: "off" }
        ]
      },

      {
        featureType: "administrative.locality",
        elementType: "labels.text.fill",
        stylers: [
          { color: "#6E91A8" }
        ]
      }

    ];
  }

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------

  function toLatLng(point) {

    if (!point) return null;

    return {
      lat: Number(point.lat),
      lng: Number(
        point.lng !== undefined
          ? point.lng
          : point.lon
      )
    };
  }

  function validPoint(point) {

    if (!point) return false;

    const lat = Number(point.lat);

    const lng = Number(
      point.lng !== undefined
        ? point.lng
        : point.lon
    );

    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }

  function addOverlay(group, overlay) {

    if (!overlay) return;

    if (!overlayGroups[group]) {
      overlayGroups[group] = [];
    }

    overlayGroups[group].push(overlay);
  }

  // -------------------------------------------------------
  // Clear Map
  // -------------------------------------------------------

  function clearOverlays() {

    Object.keys(overlayGroups).forEach(group => {

      overlayGroups[group].forEach(overlay => {

        if (overlay && overlay.setMap) {
          overlay.setMap(null);
        }

      });

      overlayGroups[group] = [];
    });

    currentStormOverlays = [];

    pulseAnimationIds.forEach(id => {
      cancelAnimationFrame(id);
    });

    pulseAnimationIds = [];
  }

 // =========================================================
// CHAKRAVAAT — CYCLONE UI
// =========================================================

function getCycloneColor(storm = {}) {

  // IMD codes (see README classification table) are the
  // authoritative source — categoryLabel is often just the
  // same abbreviation ("VSCS") so text matching on it alone
  // would silently fall through to the default color.
  const code = String(
    storm.category || ""
  ).toLowerCase().trim();

  const byCode = {
    escs: "#F43F5E",
    vscs: "#FB7185",
    scs:  "#FBBF24",
    cs:   "#2DD4BF",
    dd:   "#38BDF8",
    d:    "#22D3EE"
  };

  if (byCode[code]) {
    return byCode[code];
  }

  const label = String(
    storm.categoryLabel || ""
  ).toLowerCase();

  if (
    label.includes("extremely severe") ||
    label.includes("super")
  ) {
    return "#F43F5E";
  }

  if (
    label.includes("very severe")
  ) {
    return "#FB7185";
  }

  if (
    label.includes("severe")
  ) {
    return "#FBBF24";
  }

  if (
    label.includes("cyclonic")
  ) {
    return "#2DD4BF";
  }

  if (
    label.includes("deep")
  ) {
    return "#38BDF8";
  }

  return "#22D3EE";
}


// ---------------------------------------------------------
// Premium cyclone SVG
// ---------------------------------------------------------

// Wind in km/h from whatever field the storm carries. Unknown ('—', missing) -> 0 so radii stay finite;
// a NaN radius makes the Maps library throw on every repaint.
function stormWind(storm = {}) {

  const value = Number(
    storm.windSpeed ||
    storm.wind ||
    storm.maxWind ||
    0
  );

  return Number.isFinite(value) ? value : 0;
}


function createCycloneIcon(storm = {}) {

  const color = getCycloneColor(storm);

  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="96"
      height="96"
      viewBox="0 0 96 96"
    >

      <defs>

        <filter
          id="glow"
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur
            stdDeviation="3"
            result="blur"
          />

          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        <radialGradient
          id="core"
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop
            offset="0%"
            stop-color="#FFFFFF"
          />

          <stop
            offset="25%"
            stop-color="${color}"
          />

          <stop
            offset="100%"
            stop-color="${color}"
            stop-opacity="0.05"
          />
        </radialGradient>

      </defs>


      <!-- outer atmospheric rings -->

      <circle
        cx="48"
        cy="48"
        r="38"
        fill="none"
        stroke="${color}"
        stroke-width="1"
        opacity="0.18"
      />

      <circle
        cx="48"
        cy="48"
        r="31"
        fill="none"
        stroke="${color}"
        stroke-width="1"
        stroke-dasharray="3 5"
        opacity="0.35"
      />

      <circle
        cx="48"
        cy="48"
        r="24"
        fill="none"
        stroke="${color}"
        stroke-width="1.5"
        opacity="0.65"
      />


      <!-- cyclone spiral -->

      <path
        d="
          M48 48
          C48 36 62 32 69 40
          C77 49 69 64 56 67
          C38 72 24 60 26 44
          C28 27 44 18 59 23
          C75 28 82 45 76 59
        "
        fill="none"
        stroke="${color}"
        stroke-width="4"
        stroke-linecap="round"
        opacity="0.9"
        filter="url(#glow)"
      />

      <path
        d="
          M48 48
          C48 41 55 38 60 42
          C66 47 62 56 55 58
          C45 61 37 54 38 46
          C39 38 47 33 55 35
        "
        fill="none"
        stroke="#FFFFFF"
        stroke-width="2"
        stroke-linecap="round"
        opacity="0.9"
      />


      <!-- eye -->

      <circle
        cx="48"
        cy="48"
        r="9"
        fill="url(#core)"
        filter="url(#glow)"
      />

      <circle
        cx="48"
        cy="48"
        r="3.5"
        fill="#FFFFFF"
      />

      <circle
        cx="48"
        cy="48"
        r="1.5"
        fill="${color}"
      />

    </svg>
  `;

  return {
    url:
      "data:image/svg+xml;charset=UTF-8," +
      encodeURIComponent(svg),

    scaledSize:
      new google.maps.Size(96, 96),

    anchor:
      new google.maps.Point(48, 48)
  };
}


// ---------------------------------------------------------
// Animated cyclone pulse
// ---------------------------------------------------------

function createCyclonePulse(
  position,
  color
) {

  const pulse = new google.maps.Circle({

    map: mapInstance,

    center: position,

    radius: 12000,

    strokeColor: color,

    strokeOpacity: 0.45,

    strokeWeight: 1,

    fillColor: color,

    fillOpacity: 0.035,

    clickable: false,

    zIndex: 90

  });

  addOverlay(
    "current",
    pulse
  );

  let radius = 12000;
  let opacity = 0.45;

  const animate = () => {

    radius += 5000;

    opacity -= 0.012;

    if (
      radius > 75000 ||
      opacity <= 0
    ) {

      radius = 12000;
      opacity = 0.45;

    }

    pulse.setRadius(radius);

    pulse.setOptions({
      strokeOpacity: opacity,
      fillOpacity: opacity * 0.08
    });

    const id =
      requestAnimationFrame(animate);

    pulseAnimationIds.push(id);

  };

  animate();
}


// ---------------------------------------------------------
// Intensity / wind rings
// ---------------------------------------------------------

function createIntensityRings(
  position,
  storm = {}
) {

  const wind = stormWind(storm);

  const color =
    getCycloneColor(storm);

  const rings = [
    {
      radius: Math.max(
        30000,
        wind * 500
      ),
      opacity: 0.08,
      weight: 1
    },

    {
      radius: Math.max(
        18000,
        wind * 300
      ),
      opacity: 0.12,
      weight: 1
    },

    {
      radius: Math.max(
        8000,
        wind * 140
      ),
      opacity: 0.20,
      weight: 1.5
    }
  ];

  rings.forEach(
    ring => {

      const circle =
        new google.maps.Circle({

          map: mapInstance,

          center: position,

          radius: ring.radius,

          strokeColor: color,

          strokeOpacity:
            ring.opacity * 2,

          strokeWeight:
            ring.weight,

          fillColor: color,

          fillOpacity:
            ring.opacity,

          clickable: false,

          zIndex: 50

        });

      addOverlay(
        "current",
        circle
      );

    }
  );
}


// ---------------------------------------------------------
// Illustrative environment layers
// (Sea Surface Temp / Wind Shear / Cloud Top Temp / Pressure)
// These are frontend-only visual placeholders derived from
// existing storm fields, not real satellite/reanalysis data.
// Replace with real overlays once ENV_DATA has geospatial
// fields to back them.
// ---------------------------------------------------------

const COMPASS_BEARINGS = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5
};

function createSSTOverlay(position, storm = {}) {

  const color = "#2A9D8F"; // --teal

  const circle = new google.maps.Circle({
    map: mapInstance,
    center: position,
    radius: 160000,
    strokeColor: color,
    strokeOpacity: 0.25,
    strokeWeight: 1,
    fillColor: color,
    fillOpacity: 0.06,
    clickable: false,
    zIndex: 20
  });

  addOverlay("sst", circle);
}

function createShearIndicator(position, storm = {}) {

  const color = "#F4A261"; // --amber

  const bearing =
    COMPASS_BEARINGS[String(storm.direction || "").toUpperCase()] ?? 45;

  const tip = google.maps.geometry.spherical.computeOffset(
    position,
    90000,
    bearing
  );

  const arrow = new google.maps.Polyline({
    map: mapInstance,
    path: [position, tip],
    strokeColor: color,
    strokeOpacity: 0.85,
    strokeWeight: 2,
    icons: [{
      icon: {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 2.5,
        strokeColor: color,
        fillColor: color,
        fillOpacity: 1
      },
      offset: "100%"
    }],
    clickable: false,
    zIndex: 55
  });

  addOverlay("shear", arrow);
}

function createCloudTopOverlay(position, storm = {}) {

  const color = "#9B59B6";

  const wind = stormWind(storm);
  const radius = Math.max(45000, wind * 550);

  const circle = new google.maps.Circle({
    map: mapInstance,
    center: position,
    radius,
    strokeColor: color,
    strokeOpacity: 0.4,
    strokeWeight: 1,
    fillColor: color,
    fillOpacity: 0.05,
    clickable: false,
    zIndex: 15
  });

  addOverlay("cloud", circle);
}

function createPressureContours(position, storm = {}) {

  const color = "#2C5282"; // --navy-mid

  const pressure = Number(storm.pressure) || 1004;
  // Lower central pressure → steeper gradient → tighter, denser isobars.
  const gradient = Math.max(0.4, Math.min(1.4, (1010 - pressure) / 40));
  const ringCount = 4;

  for (let i = 1; i <= ringCount; i++) {

    const circle = new google.maps.Circle({
      map: mapInstance,
      center: position,
      radius: i * 55000 * gradient,
      strokeColor: color,
      strokeOpacity: 0.35,
      strokeWeight: 1,
      fillColor: "transparent",
      fillOpacity: 0,
      clickable: false,
      zIndex: 10
    });

    addOverlay("pressure", circle);
  }
}

  // -------------------------------------------------------
  // Track Rendering
  // -------------------------------------------------------

  function renderTrack(storm) {

    if (!storm || !storm.track) {
      return;
    }

    const historical =
      Array.isArray(storm.track.historical)
        ? storm.track.historical
        : [];

    const predicted =
      Array.isArray(storm.track.predicted)
        ? storm.track.predicted
        : [];

    // -------------------------------
    // Historical Track
    // -------------------------------

    const historicalPath =
      historical
        .filter(validPoint)
        .map(toLatLng);

    if (historicalPath.length >= 2) {

      const historicalLine =
        new google.maps.Polyline({

          map: mapInstance,

          path: historicalPath,

          geodesic: true,

          strokeColor: "#4B9FC7",

          strokeOpacity: 0.55,

          strokeWeight: 2,

          clickable: false
        });

      addOverlay(
        "historical",
        historicalLine
      );
    }

    // -------------------------------
    // Current Position
    // -------------------------------

    const current =
      validPoint(storm)
        ? toLatLng(storm)
        : null;

    if (!current) {
      return;
    }

    const currentColor =
      getCycloneColor(storm);

    const marker =
      new google.maps.Marker({

        map: mapInstance,

        position: current,

        title:
          storm.name ||
          "Cyclone",

        icon:
          createCycloneIcon(
            storm
          ),

        zIndex: 1000
      });

    addOverlay(
      "current",
      marker
    );

    currentStormOverlays.push(marker);

    // -------------------------------
    // Cyclone Name
    // -------------------------------

    if (storm.name) {

      const nameMarker =
        new google.maps.Marker({

          map: mapInstance,

          position: current,

          label: {
            text: String(storm.name),
            color: "#E6EDF5",
            fontSize: "12px",
            fontWeight: "700",
            fontFamily: "Inter, Arial"
          },

          icon: {
            path:
              google.maps.SymbolPath.CIRCLE,

            scale: 0,

            fillOpacity: 0,

            strokeOpacity: 0
          },

          zIndex: 1001
        });

      addOverlay(
        "current",
        nameMarker
      );
    }

    createCyclonePulse(
      current,
      currentColor
    );

    createIntensityRings(
      current,
      storm
    );

    createSSTOverlay(current, storm);
    createShearIndicator(current, storm);
    createCloudTopOverlay(current, storm);
    createPressureContours(current, storm);

    // -------------------------------
    // Forecast Track
    // -------------------------------

    const forecastPath =
      [current]
        .concat(
          predicted
            .filter(validPoint)
            .map(toLatLng)
        );

    if (forecastPath.length >= 2) {

      const predictedLine =
        new google.maps.Polyline({

          map: mapInstance,

          path: forecastPath,

          geodesic: true,

          strokeColor:
            currentColor,

          strokeOpacity: 0.95,

          strokeWeight: 3,

          clickable: false
        });

      addOverlay(
        "predicted",
        predictedLine
      );
    }

    // -------------------------------
    // Forecast Points
    // -------------------------------

    predicted.forEach((wp, index) => {

      if (!validPoint(wp)) {
        return;
      }

      const position =
        toLatLng(wp);

      const point =
        new google.maps.Marker({

          map: mapInstance,

          position,

          icon: {

            path:
              google.maps.SymbolPath.CIRCLE,

            scale: 4,

            fillColor:
              currentColor,

            fillOpacity: 1,

            strokeColor: "#07111F",

            strokeWeight: 1.5
          },

          title:
            wp.label ||
            `Forecast +${index + 1}`,

          zIndex: 500
        });

      addOverlay(
        "predicted",
        point
      );

      // Forecast label

      if (wp.label) {

        const label =
          new google.maps.Marker({

            map: mapInstance,

            position,

            label: {

              text: String(wp.label),

              color:
                currentColor,

              fontSize: "10px",

              fontWeight: "600",

              fontFamily:
                "Inter, Arial"
            },

            icon: {

              path:
                google.maps.SymbolPath.CIRCLE,

              scale: 0,

              fillOpacity: 0,

              strokeOpacity: 0
            },

            zIndex: 501
          });

        addOverlay(
          "predicted",
          label
        );
      }
    });

    // -------------------------------
    // Uncertainty Corridor
    // -------------------------------

    if (forecastPath.length >= 2) {

      const corridor =
        createUncertaintyCorridor(
          storm,
          forecastPath
        );

      if (corridor.length >= 4) {

        const polygon =
          new google.maps.Polygon({

            map: mapInstance,

            paths: corridor,

            strokeColor:
              currentColor,

            strokeOpacity: 0.35,

            strokeWeight: 1,

            fillColor:
              currentColor,

            fillOpacity: 0.09,

            clickable: false,

            zIndex: 50
          });

        addOverlay(
          "uncertainty",
          polygon
        );
      }
    }

    // -------------------------------
    // Landfall
    // -------------------------------

    if (
      storm.isWarning &&
      storm.landfall &&
      validPoint(storm.landfall)
    ) {

      createLandfallMarker(
        storm.landfall
      );
    }
  }

  // -------------------------------------------------------
  // Uncertainty Corridor
  // -------------------------------------------------------

  function createUncertaintyCorridor(
    storm,
    path
  ) {

    const left = [];
    const right = [];

    const predicted =
      Array.isArray(storm.track?.predicted)
        ? storm.track.predicted
        : [];

    path.forEach((point, index) => {

      let heading = 0;

      if (index === 0) {

        heading =
          google.maps.geometry.spherical
            .computeHeading(
              point,
              path[1]
            );

      } else if (
        index === path.length - 1
      ) {

        heading =
          google.maps.geometry.spherical
            .computeHeading(
              path[index - 1],
              point
            );

      } else {

        heading =
          google.maps.geometry.spherical
            .computeHeading(
              path[index - 1],
              path[index + 1]
            );
      }

      const forecastIndex =
        Math.max(0, index - 1);

      const forecastPoint =
        predicted[forecastIndex];

      let uncertaintyKm =
        forecastPoint?.uncertaintyKm;

      if (
        uncertaintyKm === undefined
      ) {
        uncertaintyKm =
          forecastPoint?.uncertainty;
      }

      if (
        !Number.isFinite(
          Number(uncertaintyKm)
        )
      ) {

        uncertaintyKm =
          Math.min(
            140,
            25 + index * 35
          );
      }

      uncertaintyKm =
        Number(uncertaintyKm);

      const leftPoint =
        google.maps.geometry.spherical
          .computeOffset(
            point,
            uncertaintyKm * 1000,
            heading + 90
          );

      const rightPoint =
        google.maps.geometry.spherical
          .computeOffset(
            point,
            uncertaintyKm * 1000,
            heading - 90
          );

      left.push(leftPoint);
      right.push(rightPoint);
    });

    return left.concat(
      right.reverse()
    );
  }

  // -------------------------------------------------------
  // Landfall Marker
  // -------------------------------------------------------

  function createLandfallMarker(
    landfall
  ) {

    const position =
      toLatLng(landfall);

    if (!position) return;

    const marker =
      new google.maps.Marker({

        map: mapInstance,

        position,

        title: "Potential Landfall",

        label: {

          text: "⚠ LANDFALL",

          color: "#FCA5A5",

          fontSize: "10px",

          fontWeight: "700",

          fontFamily:
            "Inter, Arial"
        },

        icon: {

          path:
            google.maps.SymbolPath.CIRCLE,

          scale: 5,

          fillColor: "#F87171",

          fillOpacity: 1,

          strokeColor: "#FFFFFF",

          strokeWeight: 1
        },

        zIndex: 900
      });

    addOverlay(
      "landfall",
      marker
    );
  }

  // -------------------------------------------------------
  // Main Renderer
  // -------------------------------------------------------

  async function renderMap(storms = [], { recenter = true } = {}) {

    try {

      await initMap();

      clearOverlays();

      if (!Array.isArray(storms)) {
        storms = [];
      }

      storms.forEach(storm => {
        renderTrack(storm);
      });

      if (recenter) {

        mapInstance.setCenter(
          DEFAULT_CENTER
        );

        mapInstance.setZoom(
          DEFAULT_ZOOM
        );

        updateMapAttr(
          "GOOGLE MAPS • NORTH INDIAN OCEAN"
        );
      }

    } catch (error) {

      console.error(
        "Chakravaat map initialization failed:",
        error
      );

      const container =
        document.getElementById(
          "mapSvgWrapper"
        );

      if (container) {

        container.innerHTML = `
          <div style="
            height:100%;
            display:flex;
            align-items:center;
            justify-content:center;
            color:#F87171;
            font-family:Inter,Arial,sans-serif;
            font-size:13px;
            background:#07111F;
            text-align:center;
            padding:30px;
          ">
            <div>
              <strong>MAP INITIALIZATION FAILED</strong>
              <br>
              <span style="
                color:#94A3B8;
                display:block;
                margin-top:8px;
              ">
                Check your Google Maps API key
                and Maps JavaScript API configuration.
              </span>
            </div>
          </div>
        `;
      }
    }
  }

  // -------------------------------------------------------
  // Detection Overlay
  // -------------------------------------------------------

  // Detection confidence as a 0-100 percentage, or null when the storm has none.
  function detectionPercent(storm) {

    const raw =
      storm.detection?.confidence ??
      storm.confidence ??
      storm.detectionConfidence;

    const value = Number(raw);

    if (raw === null || raw === undefined || !Number.isFinite(value)) {
      return null;
    }

    return value <= 1 ? value * 100 : value;
  }

  function updateDetectionOverlay(
    storm
  ) {

    if (!storm) return;

    const title =
      document.getElementById(
        "detectTitle"
      );

    const status =
      document.getElementById(
        "detectStatus"
      );

    const confidence =
      document.getElementById(
        "detectConf"
      );

    const center =
      document.getElementById(
        "detectCenter"
      );

    const model =
      document.getElementById(
        "detectModel"
      );

    const bar =
      document.getElementById(
        "detectConfBar"
      );

    if (title) {

      title.textContent =
        storm.name ||
        "Tropical Cyclone";
    }

    if (status) {

      status.textContent =
        storm.categoryLabel ||
        "DETECTED";
    }

    if (confidence) {

      const value = detectionPercent(storm);

      confidence.textContent =
        value === null
          ? "—"
          : `${Math.round(value)}%`;
    }

    if (center) {

      const lat =
        Number(storm.lat);

      const lon =
        Number(
          storm.lon ??
          storm.lng
        );

      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {

        center.textContent =
          `${lat.toFixed(2)}°N / ` +
          `${Math.abs(lon).toFixed(2)}°E`;
      }
    }

    if (model) {

      model.textContent =
        storm.detection?.model ||
        storm.model ||
        "CycloneAI";
    }

    if (bar) {

      const value = detectionPercent(storm);

      bar.style.width =
        `${Math.max(
          0,
          Math.min(
            100,
            value ?? 0
          )
        )}%`;
    }
  }

  // -------------------------------------------------------
  // Map Attribution
  // -------------------------------------------------------

  function updateMapAttr(
    text
  ) {

    const element =
      document.getElementById(
        "mapAttr"
      );

    if (element) {
      element.textContent =
        text || "";
    }
  }

  // -------------------------------------------------------
  // Layer Visibility
  // -------------------------------------------------------

  function setLayerVisible(
    layer,
    visible
  ) {

    if (!layer) return;

    const normalized =
      String(layer)
        .toLowerCase();

    let target = null;

    if (
      normalized.includes("histor")
    ) {
      target = "historical";

    } else if (
      normalized.includes("predict") ||
      normalized.includes("forecast")
    ) {
      target = "predicted";

    } else if (
      normalized.includes("uncert") ||
      normalized.includes("cone")
    ) {
      target = "uncertainty";

    } else if (
      normalized.includes("land")
    ) {
      target = "landfall";

    } else if (
      normalized.includes("current") ||
      normalized.includes("storm")
    ) {
      target = "current";

    } else if (
      normalized.includes("sst") ||
      normalized.includes("sea surface")
    ) {
      target = "sst";

    } else if (
      normalized.includes("shear")
    ) {
      target = "shear";

    } else if (
      normalized.includes("cloud")
    ) {
      target = "cloud";

    } else if (
      normalized.includes("pressure")
    ) {
      target = "pressure";
    }

    if (!target) return;

    overlayGroups[target].forEach(
      overlay => {

        if (
          overlay &&
          overlay.setMap
        ) {

          overlay.setMap(
            visible
              ? mapInstance
              : null
          );
        }
      }
    );
  }

  // -------------------------------------------------------
  // Replay helpers
  // -------------------------------------------------------

  // Dashed path of what actually happened after the forecast start.
  function renderActualTrack(points) {

    const path =
      (points || [])
        .filter(validPoint)
        .map(toLatLng);

    if (path.length < 2 || !mapInstance) return;

    const line =
      new google.maps.Polyline({

        map: mapInstance,

        path,

        geodesic: true,

        clickable: false,

        strokeOpacity: 0,

        icons: [{
          icon: {
            path: "M 0,-1 0,1",
            strokeOpacity: 0.85,
            strokeColor: "#E2E8F0",
            scale: 2
          },
          offset: "0",
          repeat: "10px"
        }],

        zIndex: 40
      });

    addOverlay(
      "historical",
      line
    );
  }

  function fitTo(points) {

    const valid =
      (points || []).filter(validPoint);

    if (!valid.length || !mapInstance) return;

    const bounds =
      new google.maps.LatLngBounds();

    valid.forEach(p => bounds.extend(toLatLng(p)));

    mapInstance.fitBounds(
      bounds,
      { top: 60, right: 40, bottom: 90, left: 40 }
    );
  }

  // -------------------------------------------------------
  // Zoom Controls
  // -------------------------------------------------------

  function zoom(direction) {

    if (!mapInstance) return;

    const currentZoom =
      mapInstance.getZoom();

    if (
      typeof currentZoom !== "number"
    ) {
      return;
    }

    const newZoom =
      direction > 0
        ? currentZoom + 1
        : currentZoom - 1;

    const clampedZoom =
      Math.max(
        3,
        Math.min(
          10,
          newZoom
        )
      );

    mapInstance.setZoom(
      clampedZoom
    );

    return clampedZoom;
  }

  function resetZoom() {

    if (!mapInstance) return;

    mapInstance.setCenter(
      DEFAULT_CENTER
    );

    mapInstance.setZoom(
      DEFAULT_ZOOM
    );
  }

  function getZoom() {

    if (!mapInstance) {
      return DEFAULT_ZOOM;
    }

    return mapInstance.getZoom();
  }

  // -------------------------------------------------------
  // Public API
  // -------------------------------------------------------

  return {

    initMap,

    renderMap,

    updateDetectionOverlay,

    updateMapAttr,

    setLayerVisible,

    zoom,

    resetZoom,

    getZoom,

    renderActualTrack,

    fitTo

  };

})();