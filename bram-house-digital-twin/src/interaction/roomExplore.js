// First-person walk inside rooms — press F to move like a game agent.
import { viewer } from "../viewer/cesiumViewer.js";
import { getWaypoints, setRoomsVisible, findRoomIdAtLonLat } from "../viewer/geojsonRooms.js";
import { playRoomTour, stopRoomTour, getRoomRecord } from "./roomFly.js";
import { currentRoom, isPatrolActive } from "./roomState.js";
import { announceRoomEntry } from "./roomEntryToast.js";

let exploring = false;
let navReady = false;
const keys = {};
let lastT = null;
let walkHeight = null;
let lookHeading = 0;
let lookPitch = 0;
let lastPresenceCheck = 0;

const MOVE_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "PageUp", "PageDown",
]);

function caption(html) {
  const el = document.getElementById("tourCaption");
  if (!el) return;
  el.style.display = html ? "block" : "none";
  el.innerHTML = html ?? "";
}

function walkHelpText() {
  return `<b>Walk mode</b> <span class="muted">↑↓ walk · ←→ turn · E/Q height · scroll zoom height · drag look · Shift fast · Esc exit</span>`;
}

export function showWalkInvite() {
  if (exploring || isPatrolActive()) return;
  caption(`Press <b>F</b> to walk · ↑↓ move · ←→ turn · <b>E/Q</b> raise/lower · scroll height`);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function viewerHasFocus() {
  const active = document.activeElement;
  return active === viewer?.canvas || active === document.body;
}

function moveKeysActive() {
  return (
    keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || keys.KeyQ || keys.KeyE ||
    keys["ArrowUp"] || keys["ArrowDown"] || keys["ArrowLeft"] || keys["ArrowRight"] ||
    keys["PageUp"] || keys["PageDown"]
  );
}

function syncLookFromCamera() {
  const cam = viewer.camera;
  lookHeading = cam.heading;
  lookPitch = cam.pitch;
  walkHeight = Cesium.Cartographic.fromCartesian(cam.position).height;
}

function heightLimits() {
  const rec = getRoomRecord(currentRoom());
  if (!rec) return null;
  return { min: rec.base + 0.2, max: rec.top - 0.08 };
}

function clampWalkHeight(h) {
  const lim = heightLimits();
  if (!lim) return h;
  return Cesium.Math.clamp(h, lim.min, lim.max);
}

function currentWalkHeight() {
  const c = Cesium.Cartographic.fromCartesian(viewer.camera.position);
  return walkHeight ?? c.height;
}

function applyWalkPose() {
  const cam = viewer.camera;
  const c = Cesium.Cartographic.fromCartesian(cam.position);
  walkHeight = clampWalkHeight(currentWalkHeight());
  cam.setView({
    destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, walkHeight),
    orientation: { heading: lookHeading, pitch: lookPitch, roll: 0 },
  });
}

function nudgeHeight(amount) {
  if (!viewer) return;
  walkHeight = clampWalkHeight(currentWalkHeight() + amount);
  if (exploring) {
    applyWalkPose();
    return;
  }
  const cam = viewer.camera;
  const c = Cesium.Cartographic.fromCartesian(cam.position);
  cam.setView({
    destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, walkHeight),
    orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 },
  });
}

export function isExploring() {
  return exploring;
}

export function initViewerNavigation() {
  if (navReady || !viewer) return;
  navReady = true;

  viewer.canvas.setAttribute("tabindex", "0");
  viewer.canvas.addEventListener("mousedown", onMouseDown);
  viewer.canvas.addEventListener("wheel", onWheel, { passive: false });

  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKey, true);
  viewer.clock.onTick.addEventListener(onTick);
}

export function startRoomExplore() {
  if (exploring || !viewer) return;
  exploring = true;
  document.getElementById("btnWalk")?.classList.add("active");

  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.enableInputs = false;
  ctrl.enableCollisionDetection = false;

  syncLookFromCamera();
  lastT = null;

  caption(walkHelpText());
  viewer.canvas.focus({ preventScroll: true });
}

export function stopRoomExplore() {
  if (!exploring) return;
  exploring = false;
  document.getElementById("btnWalk")?.classList.remove("active");

  const ctrl = viewer?.scene?.screenSpaceCameraController;
  if (ctrl) {
    ctrl.enableInputs = true;
    ctrl.enableRotate = true;
    ctrl.enableTranslate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;
  }

  if (currentRoom()) {
    showWalkInvite();
  } else {
    const cap = document.getElementById("tourCaption");
    if (cap && !cap.innerHTML.includes("Esc to stop")) caption(null);
  }

  walkHeight = null;
  lastT = null;
}

export function toggleRoomExplore() {
  if (exploring) {
    stopRoomExplore();
    return;
  }

  if (currentRoom()) {
    startRoomExplore();
    return;
  }

  stopRoomTour();
  setRoomsVisible(false);

  const roomId = getWaypoints()[0]?.room_id;
  if (roomId) {
    playRoomTour(roomId, {
      skipOrbit: true,
      onComplete: () => startRoomExplore(),
    });
    return;
  }

  startRoomExplore();
}

function onKey(e) {
  if (isTypingTarget(e.target)) return;

  const moveKey =
    MOVE_KEYS.has(e.key) ||
    e.code === "KeyW" || e.code === "KeyS" || e.code === "KeyA" || e.code === "KeyD" ||
    e.code === "KeyQ" || e.code === "KeyE";

  if (e.type === "keydown") {
    if (e.code === "KeyF" && currentRoom()) {
      e.preventDefault();
      if (isPatrolActive()) {
        import("./roomPatrol.js").then((m) => m.stopPatrol());
      }
      toggleRoomExplore();
      return;
    }
    if (e.key === "Escape" && isPatrolActive()) {
      import("./roomPatrol.js").then((m) => {
        m.stopPatrol();
        showWalkInvite();
      });
      return;
    }
    if (e.key === "Escape" && exploring) {
      stopRoomExplore();
      return;
    }
    if (moveKey && (exploring || viewerHasFocus())) e.preventDefault();
  }

  keys[e.code] = e.type === "keydown";
  keys[e.key] = e.type === "keydown";
}

function checkWalkRoomPresence() {
  if (!exploring || !viewer) return;

  const now = performance.now();
  if (now - lastPresenceCheck < 600) return;
  lastPresenceCheck = now;

  const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
  const roomId = findRoomIdAtLonLat(
    Cesium.Math.toDegrees(carto.longitude),
    Cesium.Math.toDegrees(carto.latitude),
    carto.height,
  );
  if (!roomId || roomId === currentRoom()) return;

  import("./roomNavigator.js").then((m) => m.selectRoom(roomId));
  announceRoomEntry(roomId);
}

function onTick() {
  if (!viewer) return;

  if (exploring) checkWalkRoomPresence();

  if (!exploring) {
    if (!moveKeysActive() || !viewerHasFocus()) return;

    const now = performance.now();
    const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.016;
    lastT = now;
    const fast = keys.ShiftLeft || keys.ShiftRight;
    const speed = (fast ? 8 : 3.5) * dt;
    const liftSpeed = (fast ? 2.5 : 1.2) * dt;
    const cam = viewer.camera;

    if (keys.KeyW || keys["ArrowUp"]) cam.moveForward(speed);
    if (keys.KeyS || keys["ArrowDown"]) cam.moveBackward(speed);
    if (keys.KeyA || keys["ArrowLeft"]) cam.moveLeft(speed);
    if (keys.KeyD || keys["ArrowRight"]) cam.moveRight(speed);

    if (currentRoom() && (keys.KeyE || keys["PageUp"] || keys.KeyQ || keys["PageDown"])) {
      if (keys.KeyE || keys["PageUp"]) nudgeHeight(liftSpeed);
      if (keys.KeyQ || keys["PageDown"]) nudgeHeight(-liftSpeed);
    } else {
      if (keys.KeyE || keys["PageUp"]) cam.moveUp(speed);
      if (keys.KeyQ || keys["PageDown"]) cam.moveDown(speed);
    }
    return;
  }

  const now = performance.now();
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.016;
  lastT = now;

  const fast = keys.ShiftLeft || keys.ShiftRight;
  const speed = (fast ? 3.6 : 1.4) * dt;
  const turnSpeed = (fast ? 2.4 : 1.5) * dt;
  const liftSpeed = (fast ? 2.2 : 1.1) * dt;
  const cam = viewer.camera;

  const forward = keys.KeyW || keys["ArrowUp"];
  const back = keys.KeyS || keys["ArrowDown"];
  const strafeLeft = keys.KeyA;
  const strafeRight = keys.KeyD;
  const turnLeft = keys["ArrowLeft"];
  const turnRight = keys["ArrowRight"];
  const up = keys.KeyE || keys["PageUp"];
  const down = keys.KeyQ || keys["PageDown"];

  if (forward) cam.moveForward(speed);
  if (back) cam.moveBackward(speed);
  if (strafeLeft) cam.moveLeft(speed);
  if (strafeRight) cam.moveRight(speed);
  if (turnLeft) lookHeading -= turnSpeed;
  if (turnRight) lookHeading += turnSpeed;
  if (up) walkHeight = clampWalkHeight(currentWalkHeight() + liftSpeed);
  if (down) walkHeight = clampWalkHeight(currentWalkHeight() - liftSpeed);

  if (forward || back || strafeLeft || strafeRight || turnLeft || turnRight || up || down) {
    applyWalkPose();
  }
}

function onWheel(e) {
  if (!currentRoom()) return;
  if (!exploring && !viewerHasFocus()) return;
  e.preventDefault();
  const lift = -e.deltaY * 0.006 * (e.shiftKey ? 2 : 1);
  nudgeHeight(lift);
}

function onMouseDown(e) {
  viewer.canvas.focus({ preventScroll: true });
  if (!exploring || e.button !== 0) return;

  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY };

  const onMove = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    start.x = ev.clientX;
    start.y = ev.clientY;
    lookHeading += dx * 0.0035;
    lookPitch = Cesium.Math.clamp(lookPitch - dy * 0.0035, -1.35, 1.35);
    applyWalkPose();
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

export function focusViewer() {
  viewer?.canvas?.focus({ preventScroll: true });
}
