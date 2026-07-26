// View controls: sun & shadows + floor-isolated section cuts for room tours.
import { viewer, groundHeight } from "./cesiumViewer.js";
import { mountBasemapPicker } from "./basemapService.js";
import { mountXRayToggle, registerBuildingTileset } from "./ifcXRay.js";
import { updateNightLights } from "../simulation/timeMachine.js";
import { CONFIG } from "../config.js";

let buildingTileset = null;
let clipPlanes = null;
/** When set, isolates one storey: baseRel <= geometry <= ceilRel (metres above ground). */
let floorSlice = null;

export function initViewControls(shellPromise) {
  renderPanel();
  enableSceneDrawerDrag();
  shellPromise?.then((ts) => {
    buildingTileset = ts;
    clearClipPlanes();
    registerBuildingTileset(ts);
  });
}

function enableSceneDrawerDrag() {
  const drawer = document.getElementById("sceneDrawer");
  const handle = document.getElementById("vpToggle");
  if (!drawer || !handle) return;

  const stage = drawer.offsetParent || document.getElementById("viewerStage");
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const clamp = (left, top) => {
    const sw = stage?.clientWidth ?? window.innerWidth;
    const sh = stage?.clientHeight ?? window.innerHeight;
    const dw = drawer.offsetWidth;
    const dh = drawer.offsetHeight;
    const maxL = Math.max(8, sw - dw - 8);
    const maxT = Math.max(8, sh - Math.min(dh, sh - 16) - 8);
    return {
      left: Math.min(maxL, Math.max(8, left)),
      top: Math.min(maxT, Math.max(8, top)),
    };
  };

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const rect = drawer.getBoundingClientRect();
    const stageRect = (stage || document.body).getBoundingClientRect();
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    originLeft = rect.left - stageRect.left;
    originTop = rect.top - stageRect.top;
    drawer.classList.add("dragging");
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    const { left, top } = clamp(originLeft + dx, originTop + dy);
    drawer.style.left = `${left}px`;
    drawer.style.top = `${top}px`;
    drawer.style.right = "auto";
  };

  const onPointerUp = (e) => {
    if (!dragging) return;
    dragging = false;
    drawer.classList.remove("dragging");
    try {
      handle.releasePointerCapture?.(e.pointerId);
    } catch { /* already released */ }
    // If the user dragged, skip the collapse toggle from the click
    if (moved) {
      handle.dataset.skipToggle = "1";
      setTimeout(() => delete handle.dataset.skipToggle, 0);
    }
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
}

function renderPanel() {
  const el = document.getElementById("viewPanel");
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="vp-head" id="vpToggle" title="Drag to move">🔆 View controls <span id="vpArrow">▾</span></div>
    <div class="vp-body" id="vpBody">
      <label class="vp-row"><input type="checkbox" id="sunToggle"> Sun &amp; shadows</label>
      <div class="vp-row">
        <input type="date" id="sunDate" value="${today}">
      </div>
      <div class="vp-row">
        <input type="range" id="sunHour" min="5" max="22" step="0.25" value="13" style="flex:1">
        <span id="sunHourLabel" class="vp-val">13:00</span>
      </div>
      <hr class="vp-sep">
      <label class="vp-row"><input type="checkbox" id="sliceToggle"> Floor slicer (section cut)</label>
      <div class="vp-row">
        <input type="range" id="sliceHeight" min="0.3" max="12" step="0.1" value="3" style="flex:1">
        <span id="sliceLabel" class="vp-val">3.0 m</span>
      </div>
    </div>
  `;

  document.getElementById("vpToggle").onclick = () => {
    if (document.getElementById("vpToggle")?.dataset.skipToggle === "1") return;
    const b = document.getElementById("vpBody");
    const open = b.style.display !== "none";
    b.style.display = open ? "none" : "block";
    document.getElementById("vpArrow").textContent = open ? "▸" : "▾";
  };
  document.getElementById("vpBody").style.display = "none";
  document.getElementById("vpArrow").textContent = "▸";

  document.getElementById("sunToggle").onchange = updateSun;
  document.getElementById("sunDate").onchange = updateSun;
  document.getElementById("sunHour").oninput = () => {
    const h = parseFloat(document.getElementById("sunHour").value);
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    document.getElementById("sunHourLabel").textContent =
      `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    updateSun();
  };

  document.getElementById("sliceToggle").onchange = () => {
    floorSlice = null;
    updateSlice();
  };
  document.getElementById("sliceHeight").oninput = () => {
    floorSlice = null;
    document.getElementById("sliceLabel").textContent =
      `${parseFloat(document.getElementById("sliceHeight").value).toFixed(1)} m`;
    updateSlice();
  };

  mountBasemapPicker(document.getElementById("vpBody"));
  mountXRayToggle(document.getElementById("vpBody"));
}

function updateSun() {
  const on = document.getElementById("sunToggle").checked;
  viewer.shadows = on;
  viewer.scene.globe.enableLighting = on;
  viewer.terrainShadows = on ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
  if (viewer.shadowMap) {
    viewer.shadowMap.softShadows = true;
    viewer.shadowMap.size = 2048;
  }
  if (!on) return;

  const date = document.getElementById("sunDate").value;
  const h = parseFloat(document.getElementById("sunHour").value);
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const local = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`);
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(local);
  viewer.clock.shouldAnimate = false;
  updateNightLights(h);
}

/** Isolate a single floor slab for room tours (dual clip planes). */
export function setFloorSlice(baseRel, ceilRel) {
  floorSlice = { base: baseRel, ceil: ceilRel };
  const toggle = document.getElementById("sliceToggle");
  const slider = document.getElementById("sliceHeight");
  if (toggle) toggle.checked = true;
  if (slider) {
    slider.value = ceilRel - 0.2;
    document.getElementById("sliceLabel").textContent = `${(ceilRel - 0.2).toFixed(1)} m`;
  }
  applyClipPlanes();
}

/** Legacy single-height cut, or null to disable. */
export function setSectionCut(h) {
  if (h == null) {
    floorSlice = null;
    const toggle = document.getElementById("sliceToggle");
    if (toggle) toggle.checked = false;
    clearClipPlanes();
    return;
  }
  setFloorSlice(Math.max(0, h - 3), h);
}

/** Remove all section cuts from the IFC tileset. */
export function clearClipPlanes() {
  floorSlice = null;
  if (clipPlanes) {
    clipPlanes.enabled = false;
  }
  if (buildingTileset?.clippingPlanes === clipPlanes) {
    buildingTileset.clippingPlanes = clipPlanes;
  }
}

let clipOffset = 0; // corrects for where Cesium anchored the clipping frame

function ensureClipCollection() {
  if (!buildingTileset) return null;

  if (!clipPlanes) {
    clipPlanes = new Cesium.ClippingPlaneCollection({
      planes: [
        new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 0, -1), 4),
        new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 0, 1), -0.1),
      ],
      unionClippingRegions: false,
      edgeColor: Cesium.Color.WHITE.withAlpha(0.85),
      edgeWidth: 1.5,
      enabled: false,
    });
    buildingTileset.clippingPlanes = clipPlanes;

    // NO custom modelMatrix (a bad matrix can make the whole tileset vanish).
    // Instead, measure where Cesium put the clipping frame and express our
    // heights (metres above ground) relative to it via a simple offset.
    clipOffset = 0;
    try {
      const origin = Cesium.Matrix4.getTranslation(
        buildingTileset.clippingPlanesOriginMatrix, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.magnitude(origin) > 6.0e6) { // near the earth surface
        const originH = Cesium.Cartographic.fromCartesian(origin)?.height;
        if (originH != null && isFinite(originH) && Math.abs(originH) < 10000) {
          clipOffset = groundHeight - originH;
        }
      }
      console.log(`[slicer] clip frame offset = ${clipOffset.toFixed(2)} m`);
    } catch (e) {
      console.warn("Slicer calibration skipped:", e.message);
    }
  }
  return clipPlanes;
}

function applyClipPlanes() {
  const planes = ensureClipCollection();
  if (!planes) return;

  if (floorSlice) {
    if (planes.length < 2) {
      planes.add(new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 0, 1), -0.1));
    }
    const { base, ceil } = floorSlice;
    planes.get(0).normal = new Cesium.Cartesian3(0, 0, -1);
    planes.get(0).distance = ceil - 0.12 + clipOffset;
    planes.get(1).normal = new Cesium.Cartesian3(0, 0, 1);
    planes.get(1).distance = -(base + 0.06 + clipOffset);
    planes.enabled = true;
    return;
  }

  updateSlice();
}

function updateSlice() {
  const planes = ensureClipCollection();
  if (!planes) return;

  const toggle = document.getElementById("sliceToggle");
  const on = toggle?.checked ?? false;
  if (!on) {
    planes.enabled = false;
    return;
  }

  const h = parseFloat(document.getElementById("sliceHeight").value);
  if (planes.length < 2) {
    planes.add(new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 0, 1), -0.1));
  }
  planes.get(0).normal = new Cesium.Cartesian3(0, 0, -1);
  planes.get(0).distance = h + clipOffset;
  planes.get(1).normal = new Cesium.Cartesian3(0, 0, 1);
  planes.get(1).distance = -(0.05 + clipOffset);
  planes.enabled = true;
}

export function getBuildingTileset() {
  return buildingTileset;
}
