// Gamified air-quality patrol — interior walk-through of highest-CO₂ rooms.
import { viewer } from "../viewer/cesiumViewer.js";
import { resetCamera } from "../viewer/cesiumViewer.js";
import { roomEntities, setRoomsVisible } from "../viewer/geojsonRooms.js";
import {
  getAllReadings,
  getReading,
  worstStatus,
  statusColor,
  formatIAQ,
  iaqLabel,
} from "../data/sensorDataService.js";
import { markRoomNavActive } from "./roomNavigator.js";
import { playRoomTour, clearRoomView } from "./roomFly.js";
import { closeRoomDetailPanel } from "./roomInteraction.js";

const STORAGE_KEY = "twinlink_iaq_quest";
const QUEST_SIZE = 6;
const BASE_POINTS = 100;
const BONUS_WARN = 25;
const BONUS_BAD = 50;

let questing = false;
let score = 0;
let visited = 0;
let queue = [];

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveProgress(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function caption(html) {
  const el = document.getElementById("tourCaption");
  el.style.display = html ? "block" : "none";
  el.innerHTML = html ?? "";
}

function updateHud() {
  const el = document.getElementById("iaqQuestHud");
  if (!el) return;
  el.style.display = questing ? "block" : "none";
  if (!questing) return;
  el.innerHTML = `
    <div class="iqh-title">🌬 Air Quality Patrol</div>
    <div class="iqh-score"><span>${score}</span> pts</div>
    <div class="iqh-progress">${visited} / ${queue.length} rooms inspected</div>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildQueue() {
  const readings = getAllReadings()
    .slice()
    .sort((a, b) => b.co2 - a.co2);
  return readings.slice(0, Math.min(QUEST_SIZE, readings.length));
}

function pointsForRoom(reading) {
  const status = worstStatus(reading);
  let pts = BASE_POINTS;
  if (status === "warn") pts += BONUS_WARN;
  if (status === "bad") pts += BONUS_BAD;
  return pts;
}

function statusBadge(reading) {
  const s = worstStatus(reading);
  const col = statusColor(s);
  return `<span class="iaq-pill" style="background:${col}22;color:${col};border-color:${col}55">${iaqLabel(s)}</span>`;
}

export function isQuestActive() {
  return questing;
}

export async function toggleIAQQuest() {
  if (questing) {
    questing = false;
    return;
  }
  await startIAQQuest();
}

export async function startIAQQuest(roomIds) {
  if (questing) return;
  queue = roomIds?.length
    ? roomIds.map((id) => getReading(id)).filter(Boolean)
    : buildQueue();

  if (!queue.length) {
    caption("No room sensor data — load rooms first.");
    setTimeout(() => caption(null), 2500);
    return;
  }

  questing = true;
  score = 0;
  visited = 0;
  document.getElementById("btnIAQQuest")?.classList.add("active");
  setRoomsVisible(false);
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

  caption(`<b>Air Quality Patrol</b> — inspect ${queue.length} rooms with the highest CO₂ · Esc to stop`);

  for (let i = 0; i < queue.length && questing; i++) {
    const reading = queue[i];
    const rec = roomEntities.find((r) => r.props.room_id === reading.room_id);
    const name = rec?.props.room_name ?? reading.room_id;
    const floor = rec?.props.floor ?? "";

    markRoomNavActive(reading.room_id);
    updateHud();

    caption(`
      <b>Stop ${i + 1}/${queue.length}</b> — flying to <em>${name}</em>
      <span class="muted">(${floor})</span>`);

    await playRoomTour(reading.room_id, { skipOrbit: false });
    if (!questing) break;

    const { openRoomPanelById } = await import("./roomInteraction.js");
    openRoomPanelById(reading.room_id);

    const pts = pointsForRoom(reading);
    score += pts;
    visited++;

    caption(`
      ${statusBadge(reading)}
      <b>${name}</b> · ${formatIAQ(reading)}
      <span class="muted">+${pts} pts · ${i + 1}/${queue.length}</span>`);

    updateHud();
  }

  endQuest(false);
}

function endQuest(cancelled = false) {
  const finished = !cancelled && visited === queue.length && queue.length > 0;
  questing = false;
  document.getElementById("btnIAQQuest")?.classList.remove("active");
  markRoomNavActive(null);
  closeRoomDetailPanel();
  caption(null);
  updateHud();

  if (finished) {
    const prev = loadProgress();
    const best = Math.max(prev.bestScore ?? 0, score);
    const runs = (prev.runs ?? 0) + 1;
    saveProgress({ bestScore: best, runs, lastScore: score, lastRun: Date.now() });
    // Stay in the last room after the 180° tour — no fly-out or summary screen.
  } else {
    clearRoomView();
    setRoomsVisible(true);
    resetCamera();
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && questing) {
    questing = false;
    endQuest(true);
  }
});

export function getQuestStats() {
  return loadProgress();
}

export function renderIAQQuestHint() {
  const p = loadProgress();
  if (!p.runs) return "";
  return `Best patrol: ${p.bestScore ?? 0} pts · ${p.runs} run(s)`;
}
