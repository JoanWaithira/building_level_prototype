// Click a room -> highlight + side panel with identity, sensor status, energy.
import { viewer } from "../viewer/cesiumViewer.js";
import { formatValue } from "../data/energyDataService.js";
import {
  getReading,
  worstStatus,
  statusColor,
  formatIAQ,
  iaqLabel,
  evaluateMetric,
} from "../data/sensorDataService.js";
import { findRoomEntityAtScreen } from "../viewer/geojsonRooms.js";
import { tryMatchIfcFeature, focusAppliance } from "./appliances.js";
import { enterRoom } from "./roomActions.js";
import { currentRoom } from "./roomState.js";
import { initPatrolControls } from "./roomPatrol.js";

let highlightedEntity = null;
let originalMaterial = null;
let energySummary = null;

export function setEnergySummary(summary) {
  energySummary = summary;
}

export function initRoomInteraction() {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(onHover, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  document.addEventListener("iaq-readings-updated", refreshRoomDetailIAQ);
  initPatrolControls();
}

/* ---------- hover highlight + tooltip ---------- */
let hoveredEntity = null;
let hoveredMaterial = null;

function onHover(movement) {
  const tooltip = document.getElementById("roomTooltip");
  const dock = document.getElementById("roomDetailDock");
  if (dock && !dock.classList.contains("hidden")) {
    tooltip.style.display = "none";
    return;
  }
  const entity = findRoomEntityAtScreen(movement.endPosition);
  const isRoom = !!entity;

  // restore previous hover (never touch the click-highlighted entity)
  if (hoveredEntity && hoveredEntity !== entity && hoveredEntity !== highlightedEntity) {
    hoveredEntity.polygon.material = hoveredMaterial;
  }
  if (!isRoom) {
    hoveredEntity = null;
    tooltip.style.display = "none";
    viewer.canvas.style.cursor = "default";
    return;
  }

  if (entity !== hoveredEntity && entity !== highlightedEntity) {
    hoveredEntity = entity;
    hoveredMaterial = entity.polygon.material;
    const c = hoveredMaterial?.color?.getValue?.() ?? Cesium.Color.WHITE;
    entity.polygon.material = new Cesium.Color(c.red, c.green, c.blue, Math.min(0.75, c.alpha + 0.3));
  }
  viewer.canvas.style.cursor = "pointer";
  const name = entity.properties.room_name?.getValue() ?? entity.name;
  const floor = entity.properties.floor?.getValue() ?? "";
  const roomId = entity.properties.room_id?.getValue();
  const reading = roomId ? getReading(roomId) : null;
  const iaqLine = reading
    ? `<br><span style="color:${statusColor(worstStatus(reading))}">${formatIAQ(reading)}</span>`
    : "";
  tooltip.innerHTML = `<b>${name}</b> · ${floor}${iaqLine}`;
  tooltip.style.display = "block";
  tooltip.style.left = movement.endPosition.x + 14 + "px";
  tooltip.style.top = movement.endPosition.y + 14 + "px";
}

function onClick(movement) {
  // undo any hover tint first so we store the room's true material
  if (hoveredEntity) {
    hoveredEntity.polygon.material = hoveredMaterial;
    hoveredEntity = null;
    document.getElementById("roomTooltip").style.display = "none";
  }
  clearHighlight();
  const picked = viewer.scene.pick(movement.position);

  if (picked instanceof Cesium.Cesium3DTileFeature) {
    const match = tryMatchIfcFeature(picked);
    if (match) {
      focusAppliance(match.id);
      return;
    }
  }

  let entity = picked?.id;
  if (!entity?.properties?.isRoom?.getValue?.()) {
    entity = findRoomEntityAtScreen(movement.position);
  }
  if (!entity) {
    closePanel();
    return;
  }

  highlightedEntity = entity;
  originalMaterial = entity.polygon.material;
  entity.polygon.material = Cesium.Color.YELLOW.withAlpha(0.6);

  const roomId = entity.properties.room_id?.getValue();
  if (roomId) {
    enterRoom(roomId);
  } else {
    showPanel(entity);
  }
}

function clearHighlight() {
  if (highlightedEntity) {
    highlightedEntity.polygon.material = originalMaterial;
    highlightedEntity = null;
  }
}

function val(entity, key) {
  const v = entity.properties[key]?.getValue();
  return v === undefined || v === null || v === "" ? "—" : v;
}

function showPanel(entity) {
  let el = document.getElementById("roomDetailDock");
  if (!el) {
    el = document.getElementById("roomPanel");
  } else {
    document.getElementById("roomPanel")?.classList.remove("open");
    document.getElementById("appLayout")?.classList.remove("left-collapsed");
  }
  if (!el) return;

  document.getElementById("roomTooltip").style.display = "none";

  const e = energySummary;
  const roomId = val(entity, "room_id");
  document.dispatchEvent(new CustomEvent("room-selected", { detail: { roomId } }));
  const reading = roomId !== "—" ? getReading(roomId) : null;
  const iaqStatus = reading ? worstStatus(reading) : "unknown";
  const inDock = el.id === "roomDetailDock";
  const iaqBlock = reading
    ? `
    <div class="iaq-summary" style="border-color:${statusColor(iaqStatus)}55">
      <div class="iaq-head">
        <span class="iaq-pill" style="background:${statusColor(iaqStatus)}22;color:${statusColor(iaqStatus)};border-color:${statusColor(iaqStatus)}55">
          ${iaqLabel(iaqStatus)}
        </span>
        <span class="muted">${new Date(reading.timestamp).toLocaleTimeString()}</span>
      </div>
      <table class="props iaq-table">
        <tr><td>Temperature</td><td style="color:${statusColor(evaluateMetric("temperature", reading.temperature))}">${reading.temperature} °C</td></tr>
        <tr><td>Humidity</td><td style="color:${statusColor(evaluateMetric("humidity", reading.humidity))}">${reading.humidity} %</td></tr>
        <tr><td>CO₂</td><td style="color:${statusColor(evaluateMetric("co2", reading.co2))}">${reading.co2} ppm</td></tr>
      </table>
    </div>`
    : `<p class="muted">Sensor data not loaded for this room.</p>`;

  const metaBlock = inDock
    ? `<p class="room-dock-meta muted">Rm ${val(entity, "room_number")} · ${val(entity, "floor")}</p>`
    : `
    <table class="props">
      <tr><td>Name</td><td>${val(entity, "room_name")}</td></tr>
      <tr><td>ID</td><td>${val(entity, "room_id")}</td></tr>
      <tr><td>Number</td><td>${val(entity, "room_number")}</td></tr>
      <tr><td>Floor</td><td>${val(entity, "floor")}</td></tr>
      <tr><td>Base height</td><td>${val(entity, "base_height")} m</td></tr>
      <tr><td>Extruded height</td><td>${val(entity, "extruded_height")} m</td></tr>
    </table>`;

  const energyBlock = inDock ? "" : `
    <h4>Energy <span class="badge">building-level</span></h4>
    ${e ? `
    <table class="props">
      <tr><td>Imported (period)</td><td>${formatValue(e.totalImportedKWh, "kWh")}</td></tr>
      <tr><td>Exported (period)</td><td>${formatValue(e.totalExportedKWh, "kWh")}</td></tr>
      <tr><td>Battery SoC</td><td>${formatValue(e.latestBatterySoC, "%")}</td></tr>
      <tr><td>Gas (latest reading)</td><td>${formatValue(e.latestGasReading, "m³", 3)}</td></tr>
    </table>
    <p class="muted">Values are for the whole building — room-level metering not connected yet.</p>
    ` : `<p class="muted">Energy data not loaded.</p>`}`;

  el.innerHTML = `
    <span class="closeBtn" id="roomPanelClose">✕</span>
    <h3>${val(entity, "room_name")}</h3>
    ${metaBlock}
    <h4>Indoor air quality</h4>
    ${iaqBlock}
    <div class="room-dock-actions">
      <button type="button" class="tbtn tbtn-sm" id="roomPatrolBtn" data-room="${roomId}">Patrol this room (10s scan)</button>
      ${roomId !== "—" ? `<button type="button" class="tbtn tbtn-sm" id="roomIaqTrendsBtn">View IAQ trends →</button>` : ""}
    </div>
    ${energyBlock}
  `;

  if (inDock) {
    el.classList.remove("hidden");
  } else {
    el.classList.add("open");
  }

  document.getElementById("roomPanelClose").onclick = () => {
    clearHighlight();
    closePanel();
  };

  document.getElementById("roomIaqTrendsBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = roomId !== "—" ? roomId : currentRoom();
    if (id) import("../panels/iaqAnalytics.js").then((m) => m.openIaqAnalytics(id, "trends"));
  });
}

/** Refresh IAQ block in room detail dock when replay scrubber moves. */
export function refreshRoomDetailIAQ() {
  const dock = document.getElementById("roomDetailDock");
  if (!dock || dock.classList.contains("hidden")) return;
  const roomId = currentRoom();
  if (!roomId) return;
  const entity = viewer.entities.getById(`room_${roomId}`);
  if (entity) showPanel(entity);
}

function closePanel() {
  closeRoomDetailPanel();
}

export function closeRoomDetailPanel() {
  const dock = document.getElementById("roomDetailDock");
  if (dock) {
    dock.classList.add("hidden");
    dock.innerHTML = "";
  }
  document.getElementById("roomPanel")?.classList.remove("open");
}

// Open the info panel for a room by its room_id (used by the room navigator).
export function openRoomPanelById(roomId) {
  const entity = viewer.entities.getById(`room_${roomId}`);
  if (entity) showPanel(entity);
}
