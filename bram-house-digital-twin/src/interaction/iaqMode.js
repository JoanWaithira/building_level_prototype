// Toggle IAQ heatmap overlay on room footprints (GeoJSON polygons).
import { setRoomDisplayMode, applyIAQColors, clearIAQColors } from "../viewer/geojsonRooms.js";
import { getAllReadings } from "../data/sensorDataService.js";

let active = false;
let metric = "co2";

export function isIAQModeActive() {
  return active;
}

export function getIAQMetric() {
  return metric;
}

export function toggleIAQMode() {
  active = !active;
  const btn = document.getElementById("btnIAQ");
  btn?.classList.toggle("active", active);

  if (active) {
    setRoomDisplayMode("footprints");
    applyIAQColors(getAllReadings(), metric);
    barSyncViewMode("footprints");
  } else {
    clearIAQColors();
    setRoomDisplayMode("hidden");
    barSyncViewMode("hidden");
  }
  return active;
}

export function refreshIAQColors() {
  if (!active) return;
  applyIAQColors(getAllReadings(), metric);
}

/** Turn on IAQ footprint overlay without toggling off (for replay). */
export function ensureIAQOverlay() {
  if (!active) {
    active = true;
    document.getElementById("btnIAQ")?.classList.add("active");
    setRoomDisplayMode("footprints");
    barSyncViewMode("footprints");
  }
  applyIAQColors(getAllReadings(), metric);
}

function barSyncViewMode(mode) {
  document.querySelectorAll("#toolbar [data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
}

/** Called when user picks Footprints/IFC manually — turn off IAQ mode if leaving footprints. */
export function onDisplayModeChanged(mode) {
  if (active && mode !== "footprints") {
    active = false;
    clearIAQColors();
    document.getElementById("btnIAQ")?.classList.remove("active");
  }
}
