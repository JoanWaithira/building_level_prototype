// IAQ Replay — scrub through hourly history; updates 3D heatmap + alerts.
import { getTimeline, getReadingAtIndex } from "../data/iaqHistoryService.js";
import { applyReadings, resetToLiveReadings } from "../data/sensorDataService.js";
import { roomEntities } from "../viewer/geojsonRooms.js";
import { ensureIAQOverlay, refreshIAQColors } from "../interaction/iaqMode.js";
import { refreshRoomNavIAQ } from "../interaction/roomNavigator.js";
import { evaluateAllReadings, formatAlert } from "./iaqRules.js";

let active = false;
let playTimer = null;
let currentIndex = 0;
let onIndexChange = null;

function formatTs(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateAlertBar(alerts) {
  const bar = document.getElementById("iaqAlertBar");
  if (!bar) return;
  if (!active || !alerts.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  const top = alerts.slice(0, 4).map((a) => formatAlert(a).html).join("");
  const more = alerts.length > 4 ? `<span class="muted"> +${alerts.length - 4} more</span>` : "";
  bar.innerHTML = `<span class="iaq-alert-kicker">IAQ alerts</span>${top}${more}`;
}

function showFrame(index, { silent = false } = {}) {
  const timeline = getTimeline();
  if (!timeline.length) return;
  currentIndex = Math.max(0, Math.min(timeline.length - 1, index));
  const frame = getReadingAtIndex(currentIndex);
  applyReadings(frame.readings);
  refreshIAQColors();
  refreshRoomNavIAQ();
  document.dispatchEvent(new CustomEvent("iaq-readings-updated"));

  const alerts = evaluateAllReadings(frame.readings);
  updateAlertBar(alerts);

  const slider = document.getElementById("iaqSlider");
  const readout = document.getElementById("iaqReadout");
  if (slider) slider.value = String(currentIndex);
  if (readout) {
    readout.innerHTML = `<b>${formatTs(frame.timestamp)}</b>
      <span class="muted">· ${alerts.length} alert${alerts.length === 1 ? "" : "s"}</span>`;
  }

  onIndexChange?.(currentIndex, frame);
  if (!silent) {
    document.dispatchEvent(new CustomEvent("iaq-replay-frame", { detail: frame }));
  }
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  const b = document.getElementById("iaqPlay");
  if (b) b.textContent = "▶";
}

function playPause() {
  if (playTimer) {
    stopPlay();
    return;
  }
  document.getElementById("iaqPlay").textContent = "⏸";
  playTimer = setInterval(() => {
    const timeline = getTimeline();
    const next = currentIndex + 1;
    if (next >= timeline.length) {
      stopPlay();
      return;
    }
    showFrame(next);
  }, 350);
}

function toggle() {
  active = !active;
  document.getElementById("iaqToggle")?.classList.toggle("active", active);
  const controls = document.getElementById("iaqControls");
  if (controls) controls.style.display = active ? "flex" : "none";

  if (active) {
    ensureIAQOverlay();
    showFrame(getTimeline().length - 1);
  } else {
    stopPlay();
    resetToLiveReadings(roomEntities);
    refreshIAQColors();
    refreshRoomNavIAQ();
    document.dispatchEvent(new CustomEvent("iaq-readings-updated"));
    updateAlertBar([]);
    const readout = document.getElementById("iaqReadout");
    if (readout) readout.innerHTML = "";
  }
}

/** Bottom-bar UI removed — replay is started from IAQ analytics only. */
export function initIaqReplay() {
  /* no-op */
}

export function isIaqReplayActive() {
  return active;
}

export function getReplayIndex() {
  return active ? currentIndex : null;
}

export function setReplayIndex(index) {
  if (!getTimeline().length) return;
  if (!active) {
    active = true;
    document.getElementById("iaqToggle")?.classList.add("active");
    const controls = document.getElementById("iaqControls");
    if (controls) controls.style.display = "flex";
    ensureIAQOverlay();
  }
  stopPlay();
  showFrame(index);
}

export function stopIaqReplay() {
  if (!active) return;
  toggle();
}

export function onIaqReplayFrame(cb) {
  onIndexChange = cb;
}

export function openIaqReplayAt(index) {
  const timeline = getTimeline();
  if (!timeline.length) return;
  if (!active) toggle();
  setReplayIndex(index ?? timeline.length - 1);
}
