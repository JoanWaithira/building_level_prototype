// Building explorer — left panel: spaces, IAQ status, appliances.
import { APP } from "../config.js";
import { resetCamera } from "../viewer/cesiumViewer.js";
import { roomEntities, setRoomsVisible } from "../viewer/geojsonRooms.js";
import {
  getReading,
  getAllReadings,
  worstStatus,
  statusColor,
  iaqLabel,
} from "../data/sensorDataService.js";
import { clearRoomView } from "./roomFly.js";
import { stopRoomExplore } from "./roomExplore.js";
import { stopPatrol, initPatrolControls } from "./roomPatrol.js";
import { resetRoomEntryAnnounce } from "./roomEntryToast.js";
import {
  enterRoom,
  setRoomHooks,
} from "./roomActions.js";
import {
  currentRoom,
  setInsideRoom,
  clearInsideRoom,
} from "./roomState.js";

let activeTab = "spaces";
let searchQuery = "";

export function initRoomNavigator() {
  setRoomHooks({
    onSelect: (roomId) => {
      document.getElementById("appLayout")?.classList.remove("left-collapsed");
      markRoomNavActive(roomId);
    },
    onReady: (roomId) => {
      import("./roomInteraction.js").then((m) => m.openRoomPanelById(roomId));
    },
  });
  ensureRoomNavShell();
  ensureRoomDetailDock();
  initPatrolControls();
  wirePatrolButton();
  renderSummary();
  renderRoomList();
}

function wirePatrolButton() {
  // Kept for call-site compatibility — real wiring is document-level in initPatrolControls().
  initPatrolControls();
}

function ensureRoomDetailDock() {
  const panel = document.querySelector(".explore-panel");
  if (!panel || panel.querySelector("#roomDetailDock")) return;
  const dock = document.createElement("div");
  dock.id = "roomDetailDock";
  dock.className = "room-detail-dock hidden";
  dock.setAttribute("aria-label", "Selected room details");
  panel.appendChild(dock);
}

function ensureRoomNavShell() {
  const el = document.getElementById("roomNav");
  if (!el || el.querySelector(".explore-panel")) return;

  el.innerHTML = `
    <div class="explore-panel">
      <header class="ep-head">
        <p class="ep-kicker">Building explorer</p>
        <h2 class="ep-title">${APP.buildingName}</h2>
      </header>
      <div class="ep-summary" id="epSummary" aria-live="polite"></div>
      <nav class="ep-tabs" role="tablist" aria-label="Explorer sections">
        <button type="button" class="ep-tab active" data-tab="spaces" role="tab" aria-selected="true">Spaces</button>
        <button type="button" class="ep-tab" data-tab="appliances" role="tab" aria-selected="false">Appliances</button>
      </nav>
      <div class="ep-search-wrap">
        <input type="search" class="ep-search" id="epSearch" placeholder="Search spaces…" autocomplete="off" aria-label="Search spaces">
      </div>
      <div class="ep-scroll">
        <div class="ep-pane ep-pane-spaces" id="spacesPane" role="tabpanel"></div>
        <div class="ep-pane ep-pane-appliances hidden" id="appliancesPane" role="tabpanel" hidden></div>
      </div>
      <div id="roomDetailDock" class="room-detail-dock hidden" aria-label="Selected room details"></div>
    </div>`;

  el.querySelectorAll(".ep-tab").forEach((btn) => {
    btn.addEventListener("click", () => setExploreTab(btn.dataset.tab));
  });

  document.getElementById("epSearch")?.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderRoomList();
  });
}

export function setExploreTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".ep-tab").forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const spaces = document.getElementById("spacesPane");
  const appliances = document.getElementById("appliancesPane");
  const searchWrap = document.querySelector(".ep-search-wrap");
  if (spaces) {
    spaces.classList.toggle("hidden", tab !== "spaces");
    spaces.hidden = tab !== "spaces";
  }
  if (appliances) {
    appliances.classList.toggle("hidden", tab !== "appliances");
    appliances.hidden = tab !== "appliances";
  }
  if (searchWrap) searchWrap.style.display = tab === "spaces" ? "" : "none";
}

export function renderSummary() {
  const el = document.getElementById("epSummary");
  if (!el) return;

  const readings = getAllReadings();
  let good = 0;
  let warn = 0;
  let bad = 0;
  for (const r of readings) {
    const s = worstStatus(r);
    if (s === "good") good++;
    else if (s === "warn") warn++;
    else if (s === "bad") bad++;
  }

  el.innerHTML = `
    <div class="ep-stat">
      <span class="ep-stat-val">${roomEntities.length}</span>
      <span class="ep-stat-lbl">spaces</span>
    </div>
    <div class="ep-stat ep-stat-good">
      <span class="ep-stat-val">${good}</span>
      <span class="ep-stat-lbl">fresh</span>
    </div>
    <div class="ep-stat ep-stat-warn">
      <span class="ep-stat-val">${warn}</span>
      <span class="ep-stat-lbl">watch</span>
    </div>
    <div class="ep-stat ep-stat-bad">
      <span class="ep-stat-val">${bad}</span>
      <span class="ep-stat-lbl">ventilate</span>
    </div>`;
}

function matchesSearch(props) {
  if (!searchQuery) return true;
  const blob = [
    props.room_name,
    props.room_number,
    props.floor,
    props.room_id,
  ].join(" ").toLowerCase();
  return blob.includes(searchQuery);
}

function renderSpaceCard(props) {
  const reading = getReading(props.room_id);
  const st = reading ? worstStatus(reading) : "unknown";
  const col = statusColor(st);
  const label = iaqLabel(st);
  const co2 = reading ? `${reading.co2}` : "—";
  const temp = reading ? `${reading.temperature}°` : "—";

  return `
    <button type="button" class="space-card" data-room="${props.room_id}" title="${label}">
      <span class="space-accent" style="background:${col}"></span>
      <span class="space-main">
        <span class="space-name">${props.room_name ?? props.room_id}</span>
        <span class="space-meta">Rm ${props.room_number ?? "—"}</span>
      </span>
      <span class="space-metrics">
        <span class="space-metric" style="--metric-color:${col}">
          <span class="space-metric-val">${co2}</span>
          <span class="space-metric-unit">ppm</span>
        </span>
        <span class="space-metric space-metric-muted">
          <span class="space-metric-val">${temp}</span>
        </span>
      </span>
    </button>`;
}

function renderRoomList() {
  const pane = document.getElementById("spacesPane");
  if (!pane) return;
  ensureRoomNavShell();

  const byFloor = new Map();
  for (const { props } of roomEntities) {
    if (!matchesSearch(props)) continue;
    const f = props.floor ?? "Unknown";
    if (!byFloor.has(f)) byFloor.set(f, []);
    byFloor.get(f).push(props);
  }

  if (!byFloor.size) {
    pane.innerHTML = `<p class="ep-empty">No spaces match your search.</p>`;
    return;
  }

  let html = "";
  const floors = [...byFloor.entries()].sort(([a], [b]) => a.localeCompare(b));
  floors.forEach(([floor, rooms], idx) => {
    const sorted = rooms.sort((a, b) => (+a.room_number || 0) - (+b.room_number || 0));
    html += `
      <details class="ep-floor" ${idx === 0 ? "open" : ""}>
        <summary class="ep-floor-head">
          <span class="ep-floor-name">${floor}</span>
          <span class="ep-floor-badge">${sorted.length}</span>
        </summary>
        <div class="ep-floor-list">
          ${sorted.map(renderSpaceCard).join("")}
        </div>
      </details>`;
  });

  pane.innerHTML = html;

  pane.querySelectorAll(".space-card[data-room]").forEach((row) => {
    row.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      enterRoom(row.dataset.room);
    };
  });

  if (currentRoom()) markRoomNavActive(currentRoom());
}

export function refreshRoomNavIAQ() {
  if (!document.getElementById("roomNav")?.querySelector(".explore-panel")) return;
  renderSummary();
  renderRoomList();
  if (currentRoom()) markRoomNavActive(currentRoom());
}

export function markRoomNavActive(roomId) {
  document.querySelectorAll(".space-card[data-room]").forEach((r) =>
    r.classList.toggle("active", r.dataset.room === roomId));
  const exit = document.getElementById("rnExitBar");
  if (exit) exit.style.display = roomId ? "flex" : "none";
  const label = document.getElementById("rnExitLabel");
  if (label) {
    if (!roomId) {
      label.textContent = "Inside room view";
    } else {
      const rec = roomEntities.find((r) => r.props.room_id === roomId);
      label.textContent = rec?.props.room_name ?? roomId;
    }
  }
}

export function selectRoom(roomId) {
  setInsideRoom(roomId);
  document.getElementById("appLayout")?.classList.remove("left-collapsed");
  markRoomNavActive(roomId);
}

export { enterRoom, currentRoom } from "./roomActions.js";

export function leaveRoomView({ resetCam = false } = {}) {
  stopPatrol();
  clearInsideRoom();
  markRoomNavActive(null);
  stopRoomExplore();
  resetRoomEntryAnnounce();
  setRoomsVisible(true);
  clearRoomView();
  import("./roomInteraction.js").then((m) => m.closeRoomDetailPanel());
  document.getElementById("roomPanel")?.classList.remove("open");
  if (resetCam) resetCamera();
}

export function exitRoom() {
  leaveRoomView({ resetCam: true });
}

/** Mount point for appliance list (appliances.js). */
export function getAppliancesPane() {
  ensureRoomNavShell();
  return document.getElementById("appliancesPane");
}

export function openAppliancesTab() {
  document.getElementById("appLayout")?.classList.remove("left-collapsed");
  setExploreTab("appliances");
  document.getElementById("appliancesPane")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
