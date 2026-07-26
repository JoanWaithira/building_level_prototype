// Appliance energy monitoring — IFC focus + simulated meters; users can add custom appliances.
import { viewer, groundHeight } from "../viewer/cesiumViewer.js";
import { getRoomRecord, stopRoomTour, flyToRoomInterior, prepareInteriorView } from "./roomFly.js";
import { getAppliancesPane, openAppliancesTab, leaveRoomView, markRoomNavActive } from "./roomNavigator.js";
import { setSectionCut, clearClipPlanes } from "../viewer/viewControls.js";
import { getBuildingEnuBounds, roomEntities } from "../viewer/geojsonRooms.js";
import { CONFIG } from "../config.js";
import { announceMessage } from "./roomEntryToast.js";
import { stopRoomExplore } from "./roomExplore.js";
import { currentRoom, setInsideRoom } from "./roomState.js";
import { getApplianceCameraOverride } from "./applianceCameraOverrides.js";

function hideRoomDetailDock() {
  const dock = document.getElementById("roomDetailDock");
  if (dock) {
    dock.classList.add("hidden");
    dock.innerHTML = "";
  }
}

export const applianceEntities = [];

const CUSTOM_STORAGE_KEY = "twinlink_custom_appliances_v1";
const PROFILES = [
  { id: "always_cycling", label: "Always on / cycling" },
  { id: "meals", label: "Meal times" },
  { id: "meals_light", label: "Evening meals" },
  { id: "evening_cycle", label: "Evening cycle" },
  { id: "morning_cycle", label: "Morning cycle" },
  { id: "evening", label: "Evening use" },
  { id: "workday", label: "Workday" },
  { id: "heating", label: "Heating pattern" },
  { id: "night_charge", label: "Night charge" },
  { id: "custom", label: "Steady load" },
];

const ICONS = ["⚡", "🧊", "🍳", "♨️", "🍽️", "🌀", "🌬️", "📺", "🖥️", "🔥", "💡", "🔌", "🧺", "🚿", "🚗"];

let baseAppliances = [];
let customAppliances = [];
let appliances = [];
let selectedId = null;
let focusGen = 0;

function loadCustomAppliances() {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => a?.id && a?.name) : [];
  } catch {
    return [];
  }
}

function saveCustomAppliances() {
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customAppliances));
  } catch { /* private mode */ }
}

function rebuildList() {
  appliances = [...baseAppliances, ...customAppliances];
}

function seeded(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  return () => (h = (h * 48271) % 2147483647) / 2147483647;
}

function hourlyProfile(a) {
  const rnd = seeded(a.id);
  const kW = (a.ratedW ?? 100) / 1000;
  return Array.from({ length: 24 }, (_, h) => {
    const n = () => 0.85 + rnd() * 0.3;
    switch (a.profile) {
      case "always_cycling":     return kW * 0.35 * n();
      case "meals":              return (h === 8 || h === 13 || (h >= 18 && h <= 19)) ? kW * 0.5 * n() : 0.005;
      case "meals_light":        return (h >= 18 && h <= 19) ? kW * 0.55 * n() : 0.002;
      case "evening_cycle":      return (h >= 20 && h <= 21) ? kW * 0.7 * n() : 0.001;
      case "morning_cycle":      return (h >= 9 && h <= 10) ? kW * 0.65 * n() : 0.001;
      case "morning_cycle_late": return (h >= 11 && h <= 12) ? kW * 0.7 * n() : 0.001;
      case "evening":            return (h >= 19 && h <= 23) ? kW * 0.8 * n() : 0.01;
      case "workday":            return (h >= 9 && h <= 17) ? kW * 0.6 * n() : 0.008;
      case "heating":            return (h <= 8 || h >= 17) ? kW * 0.8 * n() : kW * 0.2;
      case "night_charge":       return (h >= 23 || h <= 4) ? kW * 0.85 * n() : 0;
      case "custom":
      default:                   return kW * 0.25 * n();
    }
  });
}

const dayKWh = (profile) => profile.reduce((s, v) => s + v, 0);

function weekSeries(a) {
  const rnd = seeded(a.id + "wk");
  const base = dayKWh(hourlyProfile(a));
  return Array.from({ length: 7 }, () => base * (0.7 + rnd() * 0.6));
}

function matchApplianceFromFeature(feature) {
  if (!(feature instanceof Cesium.Cesium3DTileFeature)) return null;
  const parts = [];
  try {
    for (const key of feature.getPropertyIds?.() ?? []) {
      const v = feature.getProperty(key);
      if (typeof v === "string" && v.length > 1) parts.push(v.toLowerCase());
    }
  } catch { /* batch table varies */ }
  const blob = parts.join(" ");
  if (!blob) return null;

  return appliances.find((a) => {
    const tokens = a.name.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    if (tokens.some((t) => blob.includes(t))) return true;
    if (a.id === "evse" && /ev|charger|charging|wallbox|evse/.test(blob)) return true;
    return false;
  }) ?? null;
}

export async function initAppliances(shellPromise) {
  try {
    const res = await fetch("/data/appliances.json");
    baseAppliances = (await res.json()).appliances ?? [];
  } catch (e) {
    console.warn("appliances.json not loaded:", e.message);
    baseAppliances = [];
  }
  customAppliances = loadCustomAppliances();
  rebuildList();

  shellPromise?.then(() => { /* IFC picks handled in roomInteraction */ });
  renderSidebarSection();
}

function roomOptionsHtml(selected = "") {
  const rooms = [...roomEntities]
    .map((r) => ({ id: r.props.room_id, name: r.props.room_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return rooms
    .map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${r.name}</option>`)
    .join("");
}

function markActiveCard(id) {
  selectedId = id;
  document.querySelectorAll(".appliance-card[data-appliance]").forEach((card) => {
    card.classList.toggle("active", card.dataset.appliance === id);
  });
}

function renderSidebarSection() {
  const mount = getAppliancesPane();
  if (!mount) return;

  const list = appliances.length
    ? `<div class="appliance-grid">
      ${appliances.map((a) => {
        const rec = a.room_id ? getRoomRecord(a.room_id) : null;
        const loc = rec?.props.room_name ?? a.locationLabel ?? (a.outside ? "Outside" : "—");
        const kwh = dayKWh(hourlyProfile(a)).toFixed(1);
        const customBadge = a.custom ? `<span class="appliance-custom-badge">yours</span>` : "";
        return `
          <button type="button" class="appliance-card ${a.id === selectedId ? "active" : ""}" data-appliance="${a.id}">
            <span class="appliance-icon">${a.icon ?? "⚡"}</span>
            <span class="appliance-body">
              <span class="appliance-name">${a.name}${customBadge}</span>
              <span class="appliance-loc">${loc}</span>
            </span>
            <span class="appliance-kwh">
              <span class="appliance-kwh-val">${kwh}</span>
              <span class="appliance-kwh-unit">kWh/d</span>
            </span>
          </button>`;
      }).join("")}
    </div>`
    : `<p class="muted">No appliances yet — add one below.</p>`;

  mount.innerHTML = `
    <p class="ep-pane-intro muted">Select an appliance to inspect it in 3D and monitor estimated energy use.</p>
    ${list}
    <div class="appliance-add">
      <button type="button" class="tbtn wide" id="apAddToggle">＋ Add appliance</button>
      <form id="apAddForm" class="appliance-add-form hidden" autocomplete="off">
        <label>Name
          <input type="text" id="apAddName" required maxlength="48" placeholder="e.g. Desk lamp" />
        </label>
        <label>Icon
          <select id="apAddIcon">${ICONS.map((i) => `<option value="${i}">${i}</option>`).join("")}</select>
        </label>
        <label>Room
          <select id="apAddRoom">${roomOptionsHtml()}</select>
        </label>
        <label>Rated power (W)
          <input type="number" id="apAddWatts" min="1" max="20000" step="1" value="100" required />
        </label>
        <label>Usage pattern
          <select id="apAddProfile">${PROFILES.map((p) => `<option value="${p.id}">${p.label}</option>`).join("")}</select>
        </label>
        <div class="appliance-add-actions">
          <button type="submit" class="tbtn">Save &amp; monitor</button>
          <button type="button" class="tbtn" id="apAddCancel">Cancel</button>
        </div>
        <p class="muted compact-note">Energy is estimated from rated power × usage pattern (mock meter until smart plugs are connected).</p>
      </form>
    </div>`;

  // Event delegation — survives list re-renders; one zoom per click
  if (!mount.dataset.applianceClickWired) {
    mount.dataset.applianceClickWired = "1";
    mount.addEventListener("click", (e) => {
      const card = e.target.closest("button[data-appliance]");
      if (!card || !mount.contains(card)) return;
      e.preventDefault();
      e.stopPropagation();
      focusAppliance(card.dataset.appliance);
    });
  }

  const form = document.getElementById("apAddForm");
  document.getElementById("apAddToggle")?.addEventListener("click", () => {
    form?.classList.toggle("hidden");
  });
  document.getElementById("apAddCancel")?.addEventListener("click", () => {
    form?.classList.add("hidden");
  });
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    addCustomAppliance({
      name: document.getElementById("apAddName").value.trim(),
      icon: document.getElementById("apAddIcon").value,
      room_id: document.getElementById("apAddRoom").value || null,
      ratedW: Number(document.getElementById("apAddWatts").value),
      profile: document.getElementById("apAddProfile").value,
    });
  });
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "appliance";
}

function addCustomAppliance({ name, icon, room_id, ratedW, profile }) {
  if (!name || !Number.isFinite(ratedW) || ratedW <= 0) return;

  const id = `custom_${slugify(name)}_${Date.now().toString(36)}`;
  const offset = [
    (Math.random() - 0.5) * 1.6,
    (Math.random() - 0.5) * 1.6,
    0.85,
  ];

  const appliance = {
    id,
    name,
    icon: icon || "⚡",
    room_id: room_id || null,
    offset,
    ratedW: Math.round(ratedW),
    profile: profile || "custom",
    custom: true,
  };

  customAppliances.push(appliance);
  saveCustomAppliances();
  rebuildList();
  renderSidebarSection();
  focusAppliance(id);
}

function removeCustomAppliance(id) {
  customAppliances = customAppliances.filter((a) => a.id !== id);
  saveCustomAppliances();
  rebuildList();
  if (selectedId === id) {
    selectedId = null;
    document.getElementById("roomPanel")?.classList.remove("open");
  }
  renderSidebarSection();
}

/** Open the left rail on the Appliances tab. */
export function openAppliancesPanel() {
  openAppliancesTab();
  renderSidebarSection();
}

/** Metre offset (east, north, up) from a WGS84 anchor → cartographic. */
function enuToCartographic(anchorLon, anchorLat, anchorH, eastM, northM, upM) {
  const anchor = Cesium.Cartesian3.fromDegrees(anchorLon, anchorLat, anchorH);
  const world = Cesium.Matrix4.multiplyByPoint(
    Cesium.Transforms.eastNorthUpToFixedFrame(anchor),
    new Cesium.Cartesian3(eastM, northM, upM),
    new Cesium.Cartesian3(),
  );
  return Cesium.Cartographic.fromCartesian(world);
}

function headingToward(from, to) {
  return Math.atan2(
    to.longitude - from.longitude,
    to.latitude - from.latitude,
  );
}

function flyToApplianceView(eye, target, { pitchDeg = -10, duration = 0.7, onComplete } = {}) {
  const destination = Cesium.Cartesian3.fromRadians(
    eye.longitude, eye.latitude, eye.height,
  );
  const orientation = {
    heading: headingToward(eye, target),
    pitch: Cesium.Math.toRadians(pitchDeg),
    roll: 0,
  };

  try {
    viewer.camera.cancelFlight();
  } catch { /* ignore */ }

  if (!duration || duration <= 0.05) {
    viewer.camera.setView({ destination, orientation });
    viewer.scene.requestRender();
    onComplete?.();
    return;
  }

  viewer.camera.flyTo({
    destination,
    orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    complete: onComplete,
    cancel: onComplete,
  });
}

function resolveOutsidePose(a) {
  const placement = a.outsidePlacement;
  if (placement) {
    const b = getBuildingEnuBounds();
    const along = placement.along ?? 0.5;
    const height = placement.height ?? 1.35;
    const standoff = placement.standoff ?? 2.6;
    const eyeLift = placement.eyeLift ?? 0.1;
    // lateralOffset shifts the eye sideways along the wall (positive = east/north)
    const lat = placement.lateralOffset ?? 0;

    let targetE;
    let targetN;
    let eyeE;
    let eyeN;

    switch (placement.wall) {
      case "east":
        targetE = b.maxE;
        targetN = b.minN + along * (b.maxN - b.minN);
        eyeE = b.maxE + standoff;
        eyeN = targetN + lat;
        break;
      case "west":
        targetE = b.minE;
        targetN = b.minN + along * (b.maxN - b.minN);
        eyeE = b.minE - standoff;
        eyeN = targetN + lat;
        break;
      case "north":
        targetE = b.minE + along * (b.maxE - b.minE);
        targetN = b.maxN;
        eyeE = targetE + lat;
        eyeN = b.maxN + standoff;
        break;
      case "south":
      default:
        targetE = b.minE + along * (b.maxE - b.minE);
        targetN = b.minN;
        eyeE = targetE + lat;
        eyeN = b.minN - standoff;
        break;
    }

    return {
      target: [targetE, targetN, height],
      eye: [eyeE, eyeN, height + eyeLift],
    };
  }

  const [east, north, up] = a.outside ?? [0, 0, 1];
  const view = a.view ?? {};
  const [eyeE, eyeN, eyeU] = view.eyeOffset ?? [-4, -6, 2.5];
  return {
    target: [east, north, up],
    eye: [east + eyeE, north + eyeN, up + eyeU],
  };
}

function prepareExteriorView() {
  leaveRoomView({ resetCam: false });
  clearClipPlanes();
  setSectionCut(null);
  try {
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch { /* viewer not ready */ }
}

function flyToOutsideAppliance(a, gen) {
  prepareExteriorView();

  const anchorLon = CONFIG.BUILDING_LONGITUDE;
  const anchorLat = CONFIG.BUILDING_LATITUDE;
  const anchorH = groundHeight;
  const { target: targetOffset, eye: eyeOffset } = resolveOutsidePose(a);
  const view = a.view ?? {};

  const target = enuToCartographic(
    anchorLon, anchorLat, anchorH,
    targetOffset[0], targetOffset[1], targetOffset[2],
  );
  const eye = enuToCartographic(
    anchorLon, anchorLat, anchorH,
    eyeOffset[0], eyeOffset[1], eyeOffset[2],
  );

  flyToApplianceView(eye, target, {
    pitchDeg: view.pitchDeg ?? -2,
    duration: view.duration ?? 1.2,
    onComplete: () => {
      if (gen !== focusGen) return;
      if (a.arrivalMessage) announceMessage(a.arrivalMessage);
      else if (a.locationLabel) announceMessage(`You have arrived at the ${a.name} — ${a.locationLabel}`);
      else announceMessage(`You have arrived at the ${a.name}`);
    },
  });
}

function polygonEnu(rec) {
  try {
    const positions = rec.entity.polygon.hierarchy.getValue(Cesium.JulianDate.now()).positions;
    if (!positions?.length) return [];
    const { lon, lat } = rec.centroid;
    const anchor = Cesium.Cartesian3.fromDegrees(lon, lat, rec.base);
    const inv = Cesium.Matrix4.inverse(
      Cesium.Transforms.eastNorthUpToFixedFrame(anchor),
      new Cesium.Matrix4(),
    );
    return positions.map((pos) =>
      Cesium.Matrix4.multiplyByPoint(inv, pos, new Cesium.Cartesian3()),
    );
  } catch {
    return [];
  }
}

function roomBoundsEnu(verts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  return {
    minX, maxX, minY, maxY,
    spanX: Math.max(0.5, maxX - minX),
    spanY: Math.max(0.5, maxY - minY),
  };
}

function enuFromFraction(bounds, fx, fy, wallMargin = 0.12) {
  const t = (fx + 1) * 0.5;
  const u = (fy + 1) * 0.5;
  const insetX = bounds.spanX * wallMargin;
  const insetY = bounds.spanY * wallMargin;
  return {
    east: bounds.minX + insetX + (bounds.spanX - 2 * insetX) * t,
    north: bounds.minY + insetY + (bounds.spanY - 2 * insetY) * u,
  };
}

function resolveIndoorAppliancePose(a, rec) {
  const { lon, lat } = rec.centroid;
  const base = rec.base;
  const verts = polygonEnu(rec);
  if (verts.length < 2) return null;

  const bounds = roomBoundsEnu(verts);
  const override = getApplianceCameraOverride(a.id);

  let eyeFrac;
  let aimFrac;
  let fov = 68;

  if (override?.eye && override?.aim) {
    eyeFrac = override.eye;
    aimFrac = override.aim;
    fov = override.fov ?? fov;
  } else {
    // Custom / untuned appliance: stand near centre looking toward offset
    const [e = 0.4, n = 0.4, up = 0.85] = a.offset ?? [0.4, 0.4, 0.85];
    const aimFx = Cesium.Math.clamp(e / Math.max(bounds.spanX * 0.45, 0.5), -0.8, 0.8);
    const aimFy = Cesium.Math.clamp(n / Math.max(bounds.spanY * 0.45, 0.5), -0.8, 0.8);
    aimFrac = { fx: aimFx, fy: aimFy, up };
    eyeFrac = {
      fx: Cesium.Math.clamp(-aimFx * 0.7, -0.75, 0.75),
      fy: Cesium.Math.clamp(-aimFy * 0.7, -0.75, 0.75),
      up: Math.max(1.28, up + 0.4),
    };
  }

  const ep = enuFromFraction(bounds, eyeFrac.fx, eyeFrac.fy);
  const ap = enuFromFraction(bounds, aimFrac.fx, aimFrac.fy);
  const eye = enuToCartographic(lon, lat, base, ep.east, ep.north, eyeFrac.up ?? 1.35);
  const target = enuToCartographic(lon, lat, base, ap.east, ap.north, aimFrac.up ?? 0.85);

  const eyeCart = Cesium.Cartesian3.fromRadians(eye.longitude, eye.latitude, eye.height);
  const tgtCart = Cesium.Cartesian3.fromRadians(target.longitude, target.latitude, target.height);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(eyeCart);
  const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
  const local = Cesium.Matrix4.multiplyByPoint(inv, tgtCart, new Cesium.Cartesian3());
  const horiz = Math.hypot(local.x, local.y) || 0.01;
  const pitchDeg = Cesium.Math.clamp(
    Cesium.Math.toDegrees(Math.atan2(local.z, horiz)),
    -30,
    -3,
  );

  return { eye, target, pitchDeg, fov };
}

/** Apply floor slice + fly/snap to this appliance's dedicated camera. */
function zoomToIndoorAppliance(a, rec, { gen, instant = false } = {}) {
  if (gen !== focusGen || !viewer?.camera) return;

  const pose = resolveIndoorAppliancePose(a, rec);
  if (!pose) {
    // Fallback: room interior only
    void flyToRoomInterior(a.room_id, { skipOrbit: true, directInterior: true });
    return;
  }

  prepareInteriorView(rec);
  setInsideRoom(a.room_id);
  markRoomNavActive(a.room_id);

  if (viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
    const frustum = viewer.camera.frustum;
    const fovyRad = Cesium.Math.toRadians(pose.fov);
    const ar = frustum.aspectRatio ?? 1;
    frustum.fov = ar > 1.0 ? 2.0 * Math.atan(Math.tan(fovyRad * 0.5) * ar) : fovyRad;
  }

  flyToApplianceView(pose.eye, pose.target, {
    pitchDeg: pose.pitchDeg,
    duration: instant ? 0.45 : 0.75,
    onComplete: () => {
      if (gen !== focusGen) return;
      announceMessage(`You have arrived at the ${a.name}`);
    },
  });
}

/**
 * Focus an appliance: energy panel + dedicated 3D camera.
 * Switching appliances always cancels the previous fly (focusGen) and zooms to the new one.
 */
export function focusAppliance(id) {
  const a = appliances.find((x) => x.id === id);
  if (!a) return;

  const gen = ++focusGen;
  const prevRoom = currentRoom();

  markActiveCard(id);
  hideRoomDetailDock();
  stopRoomTour();
  stopRoomExplore();
  try {
    viewer?.camera?.cancelFlight();
  } catch { /* ignore */ }
  showPanel(a);

  // Outside appliance (EV charger)
  if (!a.room_id) {
    setSectionCut(null);
    requestAnimationFrame(() => {
      if (gen !== focusGen) return;
      flyToOutsideAppliance(a, gen);
    });
    return;
  }

  const rec = getRoomRecord(a.room_id);
  if (!rec) {
    console.warn("focusAppliance: unknown room", a.room_id);
    return;
  }

  const alreadyInside = prevRoom === a.room_id;
  setInsideRoom(a.room_id);
  markRoomNavActive(a.room_id);

  // Same room: zoom straight to the new appliance (fridge → hob, washer → dryer, …)
  if (alreadyInside) {
    requestAnimationFrame(() => {
      if (gen !== focusGen) return;
      zoomToIndoorAppliance(a, rec, { gen, instant: true });
    });
    return;
  }

  // Already inside the building, different room: ONE direct flight to the
  // appliance (zoomToIndoorAppliance applies the new room's floor slice).
  // Chaining the full room tour here took ~3 s and made toggling feel broken.
  if (prevRoom != null) {
    requestAnimationFrame(() => {
      if (gen !== focusGen) return;
      zoomToIndoorAppliance(a, rec, { gen, instant: false });
    });
    return;
  }

  // From the building overview: cinematic room entry, then appliance zoom
  void flyToRoomInterior(a.room_id, { skipOrbit: true }).then(() => {
    if (gen !== focusGen) return;
    requestAnimationFrame(() => {
      if (gen !== focusGen) return;
      zoomToIndoorAppliance(a, rec, { gen, instant: false });
    });
  });
}

function drawMini(canvasId, values, color, labels) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, pad = 12;
  const max = Math.max(...values, 0.001);
  const bw = (W - 4) / values.length;
  ctx.clearRect(0, 0, W, H);
  values.forEach((v, i) => {
    const h = Math.max(1, ((H - pad) * v) / max);
    ctx.fillStyle = color;
    ctx.fillRect(2 + i * bw, H - pad - h, Math.max(1, bw - 1.5), h);
  });
  ctx.fillStyle = "#9aa4b8"; ctx.font = "9px sans-serif";
  ctx.fillText(labels[0], 2, H - 2);
  ctx.fillText(labels[1], W - ctx.measureText(labels[1]).width - 2, H - 2);
}

function showPanel(a) {
  const profile = hourlyProfile(a);
  const week = weekSeries(a);
  const hour = new Date().getHours();
  const nowKW = profile[hour];
  const on = nowKW > 0.02;
  const rec = a.room_id ? getRoomRecord(a.room_id) : null;

  const el = document.getElementById("roomPanel");
  if (!el) return;

  const removeBtn = a.custom
    ? `<button type="button" class="tbtn tbtn-sm" id="apRemove" style="margin-top:10px">Remove this appliance</button>`
    : "";

  el.innerHTML = `
    <span class="closeBtn" id="apClose">✕</span>
    <h3>${a.icon ?? "⚡"} ${a.name}</h3>
    <p class="panel-sub muted">${a.custom ? "Your appliance · " : ""}simulated meter data</p>
    <table class="props">
      <tr><td>Status</td><td class="${on ? "ok" : ""}">${on ? "● On" : "○ Standby"}</td></tr>
      <tr><td>Power now</td><td>${(nowKW * 1000).toFixed(0)} W</td></tr>
      <tr><td>Rated power</td><td>${Number(a.ratedW).toLocaleString()} W</td></tr>
      <tr><td>Today (est.)</td><td>${dayKWh(profile).toFixed(2)} kWh</td></tr>
      <tr><td>Last 7 days</td><td>${week.reduce((s, v) => s + v, 0).toFixed(1)} kWh</td></tr>
      <tr><td>Location</td><td>${rec ? rec.props.room_name : (a.locationLabel ?? "Outside")}</td></tr>
    </table>
    <h4>Today — power by hour (kW)</h4>
    <canvas id="apDay" width="270" height="60"></canvas>
    <h4>Last 7 days (kWh)</h4>
    <canvas id="apWeek" width="270" height="60"></canvas>
    ${removeBtn}
  `;
  el.classList.add("open");
  drawMini("apDay", profile, "#ffd166", ["0h", "23h"]);
  drawMini("apWeek", week, "#7ec8ff", ["6 days ago", "today"]);
  document.getElementById("apClose").onclick = () => {
    el.classList.remove("open");
    setSectionCut(null);
  };
  document.getElementById("apRemove")?.addEventListener("click", () => {
    removeCustomAppliance(a.id);
  });
}

export function isApplianceEntity() {
  return false;
}

export function onApplianceClick() {}

export function tryMatchIfcFeature(feature) {
  return matchApplianceFromFeature(feature);
}
