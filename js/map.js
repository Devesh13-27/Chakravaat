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
    landfall: []
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

  // -------------------------------------------------------
  // Current Cyclone Marker
  // -------------------------------------------------------

  function createCycloneIcon(color = "#22D3EE") {

    const svg = `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="72"
        height="72"
        viewBox="0 0 72 72"
      >

        <defs>

          <radialGradient id="glow">
            <stop
              offset="0%"
              stop-color="${color}"
              stop-opacity="0.95"
            />

            <stop
              offset="45%"
              stop-color="${color}"
              stop-opacity="0.25"
            />

            <stop
              offset="100%"
              stop-color="${color}"
              stop-opacity="0"
            />
          </radialGradient>

        </defs>

        <circle
          cx="36"
          cy="36"
          r="34"
          fill="url(#glow)"
        />

        <circle
          cx="36"
          cy="36"
          r="18"
          fill="#07111F"
          stroke="${color}"
          stroke-width="2.5"
        />

        <circle
          cx="36"
          cy="36"
          r="8"
          fill="${color}"
          opacity="0.95"
        />

        <circle
          cx="36"
          cy="36"
          r="4"
          fill="#FFFFFF"
        />

        <path
          d="
            M36 4
            C49 13 57 22 58 36
            C57 50 49 59 36 68
            C45 55 49 46 49 36
            C49 25 45 16 36 4
          "
          fill="none"
          stroke="${color}"
          stroke-width="1"
          opacity="0.55"
        />

      </svg>
    `;

    return {
      url:
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(svg),

      scaledSize:
        new google.maps.Size(72, 72),

      anchor:
        new google.maps.Point(36, 36)
    };
  }

  // -------------------------------------------------------
  // Pulse Animation
  // -------------------------------------------------------

  function createPulse(position, color) {

    const pulse = new google.maps.Circle({

      map: mapInstance,

      center: position,

      radius: 25000,

      strokeColor: color,

      strokeOpacity: 0.35,

      strokeWeight: 1.5,

      fillColor: color,

      fillOpacity: 0.06,

      clickable: false
    });

    addOverlay("current", pulse);

    let start = performance.now();

    function animate(now) {

      if (!mapInstance) return;

      const elapsed =
        (now - start) % 2200;

      const progress =
        elapsed / 2200;

      const radius =
        20000 + progress * 70000;

      const opacity =
        0.35 * (1 - progress);

      pulse.setRadius(radius);

      pulse.setOptions({
        strokeOpacity: opacity,
        fillOpacity: opacity * 0.18
      });

      const id =
        requestAnimationFrame(animate);

      pulseAnimationIds.push(id);
    }

    const firstId =
      requestAnimationFrame(animate);

    pulseAnimationIds.push(firstId);
  }

  // -------------------------------------------------------
  // Wind / Intensity Rings
  // -------------------------------------------------------

  function createWindRings(position, warning = false) {

    const color =
      warning
        ? "#F87171"
        : "#22D3EE";

    const radii = [
      45000,
      90000,
      150000
    ];

    radii.forEach((radius, index) => {

      const circle =
        new google.maps.Circle({

          map: mapInstance,

          center: position,

          radius,

          strokeColor: color,

          strokeOpacity:
            0.28 - index * 0.06,

          strokeWeight: 1,

          fillOpacity: 0,

          clickable: false
        });

      addOverlay("current", circle);
    });
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

    const warning =
      Boolean(storm.isWarning);

    const currentColor =
      warning
        ? "#F87171"
        : "#22D3EE";

    const marker =
      new google.maps.Marker({

        map: mapInstance,

        position: current,

        title:
          storm.name ||
          "Cyclone",

        icon:
          createCycloneIcon(
            currentColor
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

    createPulse(
      current,
      currentColor
    );

    createWindRings(
      current,
      warning
    );

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
            warning
              ? "#F87171"
              : "#22D3EE",

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
              warning
                ? "#F87171"
                : "#22D3EE",

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
                warning
                  ? "#FCA5A5"
                  : "#7DD3FC",

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
              warning
                ? "#F87171"
                : "#22D3EE",

            strokeOpacity: 0.35,

            strokeWeight: 1,

            fillColor:
              warning
                ? "#F87171"
                : "#22D3EE",

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

  async function renderMap(storms = []) {

    try {

      await initMap();

      clearOverlays();

      if (!Array.isArray(storms)) {
        storms = [];
      }

      storms.forEach(storm => {
        renderTrack(storm);
      });

      mapInstance.setCenter(
        DEFAULT_CENTER
      );

      mapInstance.setZoom(
        DEFAULT_ZOOM
      );

      updateMapAttr(
        "GOOGLE MAPS • NORTH INDIAN OCEAN"
      );

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

      const value =
        Number(
          storm.confidence ??
          storm.detectionConfidence ??
          0
        );

      confidence.textContent =
        `${Math.round(value * 100)}%`;
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
        storm.model ||
        "CycloneAI";
    }

    if (bar) {

      const value =
        Number(
          storm.confidence ??
          storm.detectionConfidence ??
          0
        );

      bar.style.width =
        `${Math.max(
          0,
          Math.min(
            100,
            value * 100
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

    mapInstance.setZoom(
      Math.max(
        3,
        Math.min(
          10,
          newZoom
        )
      )
    );
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

    getZoom

  };

})();