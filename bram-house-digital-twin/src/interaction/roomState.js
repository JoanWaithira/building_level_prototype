// Shared room presence state (no UI or tour imports — avoids circular deps).
let insideRoom = null;
let roomViewActive = false;
let patrolActive = false;

export function currentRoom() {
  return insideRoom;
}

export function isRoomViewActive() {
  return roomViewActive;
}

export function isPatrolActive() {
  return patrolActive;
}

export function setPatrolActive(active) {
  patrolActive = active;
}

export function setInsideRoom(roomId) {
  insideRoom = roomId;
  if (roomId) roomViewActive = true;
}

export function clearInsideRoom() {
  insideRoom = null;
  roomViewActive = false;
}
