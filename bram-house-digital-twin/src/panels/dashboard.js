// Building-level energy dashboard + compact toolbar.
import { formatValue } from "../data/energyDataService.js";
import { filterByFloor, floors, setRoomDisplayMode } from "../viewer/geojsonRooms.js";
import { resetCamera } from "../viewer/cesiumViewer.js";
import { setSectionCut, clearClipPlanes } from "../viewer/viewControls.js";
import { openChartsDashboard } from "./energyCharts.js";
import { openIaqAnalytics } from "./iaqAnalytics.js";
import { toggleTour, toggleWalk } from "../interaction/interiorTour.js";
import { toggleIAQMode, onDisplayModeChanged } from "../interaction/iaqMode.js";
import { toggleIAQQuest } from "../interaction/iaqQuest.js";
import { openAppliancesPanel } from "../interaction/appliances.js";
import { toggleXRayMode } from "../viewer/ifcXRay.js";

let summaryRef = null;

export function renderDashboard(summary, roomsInfo) {
  summaryRef = summary;
  const el = document.getElementById("dashboard");
  const e = summary;
  const roomNote = roomsInfo?.count
    ? `${roomsInfo.count} rooms (GeoJSON footprints · IFC is the 3D shell)`
    : "Building-level meters · room IAQ in the 3D view";

  el.innerHTML = `
    <h3>Energy</h3>
    <div id="ifcLoadBanner" class="ifc-load-banner" style="display:none"></div>
    <div class="kpi-grid">
      <div class="kpi"><span class="kpi-val">${formatValue(e.totalImportedKWh, "kWh")}</span><span class="kpi-lbl">Imported</span></div>
      <div class="kpi"><span class="kpi-val">${formatValue(e.totalExportedKWh, "kWh")}</span><span class="kpi-lbl">Exported</span></div>
      <div class="kpi"><span class="kpi-val">${formatValue(e.latestBatterySoC, "%")}</span><span class="kpi-lbl">Battery</span></div>
      <div class="kpi"><span class="kpi-val">${formatValue(e.latestGasReading, "m³", 1)}</span><span class="kpi-lbl">Gas</span></div>
    </div>
    <button class="tbtn wide charts-cta" id="openCharts">Open energy analytics</button>
    <button class="tbtn wide charts-cta iaq-cta" id="openDecisions">Open decision analytics</button>
    <button class="tbtn wide charts-cta iaq-cta" id="openIaqAnalytics">Open IAQ analytics</button>
    <p class="muted compact-note">${roomNote}</p>
  `;

  document.getElementById("openCharts").onclick = () => openChartsDashboard(summary);
  document.getElementById("openDecisions").onclick = () => openChartsDashboard(summary, "decisions");
  document.getElementById("openIaqAnalytics").onclick = () => openIaqAnalytics();
  renderToolbar();
}

function renderToolbar() {
  const bar = document.getElementById("toolbar");
  const floorBtns = ["ALL", ...floors]
    .map((f) => `<button class="tbtn tbtn-sm ${f === "ALL" ? "active" : ""}" data-floor="${f}">${f === "ALL" ? "All" : f.replace("Level ", "L")}</button>`)
    .join("");

  bar.innerHTML = `
    <div class="dock-group dock-compact dock-floors" aria-label="Floor filter">
      <span class="dock-label">Floor</span>
      ${floorBtns}
    </div>
    <div class="dock-group dock-compact dock-tools" aria-label="Tools">
      <button class="tbtn tbtn-sm" id="resetCam">Reset</button>
      <button class="tbtn tbtn-sm" id="btnWalk" title="Press F inside a room — WASD + mouse look">Walk (F)</button>
      <button class="tbtn tbtn-sm" id="btnAppliances">Appliances</button>
      <button class="tbtn tbtn-sm" id="btnTour">Tour</button>
      <button class="tbtn tbtn-sm" id="toggleScene">Scene</button>
    </div>
    <details class="dock-more">
      <summary class="tbtn tbtn-sm">More</summary>
      <div class="dock-more-menu">
        <span class="dock-label">View</span>
        <button class="tbtn tbtn-sm active" data-mode="hidden">IFC</button>
        <button class="tbtn tbtn-sm" data-mode="footprints">Footprints</button>
        <button class="tbtn tbtn-sm" data-mode="volumes">Volumes</button>
        <button class="tbtn tbtn-sm" id="btnXRay" title="Hide walls — show fixtures">X-ray</button>
        <span class="dock-label">IAQ</span>
        <button class="tbtn tbtn-sm" id="btnIAQ">IAQ map</button>
        <button class="tbtn tbtn-sm" id="btnIAQAnalytics">IAQ history</button>
        <button class="tbtn tbtn-sm" id="btnIAQQuest">Air patrol</button>
        <button class="tbtn tbtn-sm" id="btnWhatIf">What-if</button>
      </div>
    </details>`;

  bar.querySelectorAll("[data-floor]").forEach((btn) => {
    btn.onclick = () => {
      bar.querySelectorAll("[data-floor]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filterByFloor(btn.dataset.floor);
    };
  });
  bar.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = () => {
      bar.querySelectorAll("[data-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setRoomDisplayMode(btn.dataset.mode);
      onDisplayModeChanged(btn.dataset.mode);
    };
  });
  document.getElementById("resetCam").onclick = () => {
    clearClipPlanes();
    setSectionCut(null);
    resetCamera();
  };
  document.getElementById("btnTour").onclick = toggleTour;
  document.getElementById("btnWalk").onclick = toggleWalk;
  document.getElementById("btnAppliances").onclick = () => openAppliancesPanel();
  document.getElementById("btnXRay").onclick = () => toggleXRayMode();
  document.getElementById("btnIAQ").onclick = toggleIAQMode;
  document.getElementById("btnIAQAnalytics").onclick = () => openIaqAnalytics();
  document.getElementById("btnIAQQuest").onclick = () => toggleIAQQuest();
  document.getElementById("btnWhatIf")?.addEventListener("click", () => {
    if (summaryRef) openChartsDashboard(summaryRef, "scenarios");
  });
  document.getElementById("toggleScene")?.addEventListener("click", () => {
    document.getElementById("sceneDrawer")?.classList.toggle("open");
  });
}

export function showIfcLoadStatus({ ok, error }) {
  const banner = document.getElementById("ifcLoadBanner");
  if (!banner) return;
  if (ok) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "block";
  banner.className = "ifc-load-banner warn";
  banner.innerHTML = error === "no_asset_id"
    ? "<strong>IFC shell off</strong> — set <code>BUILDING_ASSET_ID</code> in config.js"
    : `<strong>IFC not loaded</strong> — ${error ?? "check Cesium ion token & asset access"}. Open DevTools console for details.`;
}
