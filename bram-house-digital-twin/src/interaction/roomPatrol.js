// Per-room elevated scan — slow orbit looking down into the room (dollhouse view).
import { viewer } from "../viewer/cesiumViewer.js";
import {
  getPatrolElevatedPose,
  snapToElevatedPatrolView,
  stopRoomTour,
  interruptCameraMotion,
} from "./roomFly.js";
import { stopRoomExplore, showWalkInvite } from "./roomExplore.js";
import { getReading, formatIAQ, worstStatus, statusColor } from "../data/sensorDataService.js";
import {
  currentRoom,
  setInsideRoom,
  isPatrolActive,
  setPatrolActive,
} from "./roomState.js";

const PATROL_MS = 10_000;

let patrolGen = 0;
let rafId = null;
let keyHandler = null;
let savedCameraInputs = null;
let patrolDelegated = false;

function caption(html) {
  const el = document.getElementById("tourCaption");
  if (!el) return;
  el.style.display = html ? "block" : "none";
  el.innerHTML = html ?? "";
}

function cartographicToCartesian(c) {
  return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);
}

export { isPatrolActive };

/** Reliable click handling for the patrol button (dock or floating panel). */
export function initPatrolControls() {
  if (patrolDelegated) return;
  patrolDelegated = true;
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest?.("#roomPatrolBtn");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const roomId = btn.dataset.room || currentRoom();
      if (!roomId || roomId === "—") return;
      void patrolRoom(roomId);
    },
    true,
  );
}

function lockCameraForPatrol() {
  if (!viewer?.scene) return;
  const ctrl = viewer.scene.screenSpaceCameraController;
  savedCameraInputs = {
    enableInputs: ctrl.enableInputs,
    enableRotate: ctrl.enableRotate,
    enableTranslate: ctrl.enableTranslate,
    enableZoom: ctrl.enableZoom,
    enableTilt: ctrl.enableTilt,
  };
  ctrl.enableInputs = false;
  ctrl.enableRotate = false;
  ctrl.enableTranslate = false;
  ctrl.enableZoom = false;
  ctrl.enableTilt = false;
}

function unlockCameraForPatrol() {
  if (!viewer?.scene || !savedCameraInputs) return;
  const ctrl = viewer.scene.screenSpaceCameraController;
  Object.assign(ctrl, savedCameraInputs);
  savedCameraInputs = null;
}

export function stopPatrol() {
  setPatrolActive(false);
  patrolGen += 1;
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (keyHandler) {
    window.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
  unlockCameraForPatrol();
  interruptCameraMotion();
}

function finishPatrol(roomId) {
  stopPatrol();
  const reading = getReading(roomId);
  if (reading) {
    const st = worstStatus(reading);
    const col = statusColor(st);
    caption(
      `<b>Patrol complete</b> · <span style="color:${col}">${formatIAQ(reading)}</span> · Press <b>F</b> to walk`,
    );
  } else {
    caption("<b>Patrol complete</b> · Press <b>F</b> to walk");
  }
  showWalkInvite();
}

function orientationAt(eyeCarto, targetCarto) {
  const eye = cartographicToCartesian(eyeCarto);
  const target = cartographicToCartesian(targetCarto);
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(eye);
  const inv = Cesium.Matrix4.inverseTransformation(transform, new Cesium.Matrix4());
  const local = Cesium.Matrix4.multiplyByPoint(inv, target, new Cesium.Cartesian3());
  const heading = Math.atan2(local.y, local.x) - Cesium.Math.PI_OVER_TWO;
  const pitch = Math.atan2(local.z, Math.hypot(local.x, local.y));
  return { heading, pitch };
}

function startScan(pose, roomId) {
  if (!viewer?.camera || !pose?.eye || !pose?.target) {
    caption('<b>Room scan</b> <span class="muted">· could not start camera</span>');
    return;
  }

  const gen = ++patrolGen;
  setPatrolActive(true);
  lockCameraForPatrol();
  interruptCameraMotion(); // ensure no leftover lookAt lock

  const t0 = performance.now();
  const center = cartographicToCartesian(pose.target);
  const startEye = cartographicToCartesian(pose.eye);
  const radius = Math.max(1.5, Cesium.Cartesian3.distance(startEye, center) * 0.95);
  const centerCarto = Cesium.Cartographic.fromCartesian(center);
  const eyeHeight = Cesium.Cartographic.fromCartesian(startEye).height;
  const heightAboveCenter = Math.max(0.8, eyeHeight - centerCarto.height);

  // Orbit angle from initial eye offset in ENU at room centre
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const inv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
  const local0 = Cesium.Matrix4.multiplyByPoint(inv, startEye, new Cesium.Cartesian3());
  const baseAngle = Math.atan2(local0.y, local0.x);

  keyHandler = (e) => {
    if (e.key !== "Escape") return;
    stopPatrol();
    showWalkInvite();
  };
  window.addEventListener("keydown", keyHandler);

  const applyFrame = (angle) => {
    const local = new Cesium.Cartesian3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      heightAboveCenter,
    );
    const eyeWorld = Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
    const eyeCarto = Cesium.Cartographic.fromCartesian(eyeWorld);
    const { heading, pitch } = orientationAt(eyeCarto, pose.target);
    viewer.camera.setView({
      destination: eyeWorld,
      orientation: {
        heading,
        pitch: Cesium.Math.clamp(pitch, -0.85, -0.2),
        roll: 0,
      },
    });
    viewer.scene.requestRender();
  };

  try {
    applyFrame(baseAngle);
  } catch (err) {
    console.error("patrol start frame failed:", err);
    stopPatrol();
    caption('<b>Room scan</b> <span class="muted">· camera error — try again</span>');
    return;
  }

  caption(`<b>Room scan</b> <span class="muted">· elevated orbit · 10s · Esc stop</span>`);

  const tick = () => {
    if (!isPatrolActive() || gen !== patrolGen) return;

    const elapsed = performance.now() - t0;
    const t = Math.min(1, elapsed / PATROL_MS);
    const secs = Math.max(0, Math.ceil((PATROL_MS - elapsed) / 1000));
    const angle = baseAngle + t * Cesium.Math.TWO_PI;

    try {
      applyFrame(angle);
    } catch (err) {
      console.error("patrol frame failed:", err);
      stopPatrol();
      caption('<b>Room scan</b> <span class="muted">· stopped (camera error)</span>');
      return;
    }

    caption(`<b>Room scan</b> <span class="muted">· elevated orbit · ${secs}s · Esc stop</span>`);

    if (elapsed >= PATROL_MS) {
      finishPatrol(roomId);
      return;
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

/**
 * Run a 10-second elevated orbit scan of one room (360° overview, looking down).
 */
export function patrolRoom(roomId) {
  roomId = roomId ?? currentRoom();
  if (!roomId || roomId === "—" || !viewer?.camera) {
    console.warn("patrolRoom: missing room or viewer", roomId);
    caption('<b>Room scan</b> <span class="muted">· no room selected</span>');
    return;
  }

  stopPatrol();
  stopRoomExplore();
  stopRoomTour();
  interruptCameraMotion();

  caption(`<b>Room scan</b> <span class="muted">· starting…</span>`);

  if (currentRoom() !== roomId) {
    setInsideRoom(roomId);
    import("./roomNavigator.js").then((m) => m.markRoomNavActive(roomId));
  }

  let pose = null;
  try {
    pose = snapToElevatedPatrolView(roomId) ?? getPatrolElevatedPose(roomId);
  } catch (err) {
    console.error("patrol pose failed:", err);
  }

  if (!pose?.eye || !pose?.target) {
    caption('<b>Room scan</b> <span class="muted">· could not position camera</span>');
    return;
  }

  startScan(pose, roomId);
}
