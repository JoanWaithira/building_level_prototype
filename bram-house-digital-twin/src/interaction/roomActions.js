// Core room enter / switch logic — no panel UI imports (avoids circular deps).
import { playRoomTour, getRoomRecord } from "./roomFly.js";
import { roomEntities, setRoomsVisible } from "../viewer/geojsonRooms.js";
import { stopRoomExplore, showWalkInvite } from "./roomExplore.js";
import { announceRoomEntry } from "./roomEntryToast.js";
import { stopPatrol } from "./roomPatrol.js";
import { currentRoom, setInsideRoom } from "./roomState.js";

let onRoomSelected = null;
let onRoomReady = null;

/** roomNavigator registers nav highlight + panel open callbacks. */
export function setRoomHooks({ onSelect, onReady } = {}) {
  if (onSelect) onRoomSelected = onSelect;
  if (onReady) onRoomReady = onReady;
}

function resolveRoomId(roomId) {
  if (!roomId) return null;
  const id = String(roomId).trim();
  if (getRoomRecord(id)) return id;
  const rec = roomEntities.find(
    (r) => String(r.props.room_id).toLowerCase() === id.toLowerCase(),
  );
  return rec?.props.room_id ?? null;
}

function completeRoomEntry(roomId) {
  onRoomReady?.(roomId);
  announceRoomEntry(roomId, { force: true });
  showWalkInvite();
}

export function enterRoom(roomId) {
  roomId = resolveRoomId(roomId);
  if (!roomId || !getRoomRecord(roomId)) {
    console.warn("enterRoom: unknown room", roomId);
    return;
  }

  const prevRoom = currentRoom();
  const switching = prevRoom != null && prevRoom !== roomId;

  stopPatrol();
  stopRoomExplore();

  setInsideRoom(roomId);
  setRoomsVisible(false);
  onRoomSelected?.(roomId);

  // First click: exterior zoom → interior. Toggling: stay in room view, quick interior fly.
  playRoomTour(roomId, {
    skipOrbit: true,
    directInterior: switching,
    onComplete: () => {
      if (currentRoom() !== roomId) return;
      completeRoomEntry(roomId);
    },
  });
}

export { currentRoom, setInsideRoom, clearInsideRoom } from "./roomState.js";
