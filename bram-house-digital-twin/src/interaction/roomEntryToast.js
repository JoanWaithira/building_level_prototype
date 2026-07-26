// Brief toast when the user enters a room while exploring.
import { getRoomRecord } from "../viewer/geojsonRooms.js";

let lastAnnounced = null;
let hideTimer = null;

function ensureToastEl() {
  let el = document.getElementById("roomEntryToast");
  if (el) return el;
  el = document.createElement("div");
  el.id = "roomEntryToast";
  el.setAttribute("aria-live", "polite");
  el.setAttribute("role", "status");
  document.getElementById("viewerStage")?.appendChild(el);
  return el;
}

function roomLabel(rec) {
  const name = rec.props.room_name ?? rec.props.room_id;
  const num = rec.props.room_number;
  return num ? `${name} · Rm ${num}` : name;
}

function showToast(text) {
  const el = ensureToastEl();
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}

export function announceMessage(text) {
  if (!text) return;
  showToast(text);
}

export function announceRoomEntry(roomId, { force = false } = {}) {
  if (!roomId) return;
  if (!force && roomId === lastAnnounced) return;

  const rec = getRoomRecord(roomId);
  if (!rec) return;

  lastAnnounced = roomId;
  showToast(`You have entered ${roomLabel(rec)}`);
}

export function resetRoomEntryAnnounce() {
  lastAnnounced = null;
  clearTimeout(hideTimer);
  document.getElementById("roomEntryToast")?.classList.remove("visible");
}
