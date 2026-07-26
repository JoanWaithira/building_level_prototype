// Interior room tour — eye-level view across the room (living-space perspective).
import { viewer } from "../viewer/cesiumViewer.js";
import { roomEntities, setRoomsVisible, setRoomDisplayMode, clearIAQColors } from "../viewer/geojsonRooms.js";
import { setFloorSlice, setSectionCut } from "../viewer/viewControls.js";
import { getRoomCameraOverride } from "./roomCameraOverrides.js";

let tourAbort = false;
let tourGen = 0;
let savedFov = null;

const INTERIOR_FOV_DEG = 82;

function isActiveTour(gen) {
  return !tourAbort && gen === tourGen;
}

export function stopRoomTour() {
  tourAbort = true;
  tourGen += 1;
  cancelCameraFlight();
  restoreFov();
  releaseCameraLock();
  hideTourCaption();
}

function cancelCameraFlight() {
  try {
    viewer?.camera?.cancelFlight();
  } catch { /* viewer not ready */ }
}

function releaseCameraLock() {
  try {
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch { /* viewer not ready */ }
}

function saveAndWidenFov(rec) {
  if (!viewer?.camera) return;
  const frustum = viewer.camera.frustum;
  if (!(frustum instanceof Cesium.PerspectiveFrustum)) return;
  if (savedFov == null) savedFov = frustum.fovy;
  const override = getRoomCameraOverride(rec.props.room_id);
  const span = interiorViewParams(rec).span;
  const deg = override?.fov ?? fovForSpan(span);
  const fovyRad = Cesium.Math.toRadians(deg);
  const ar = frustum.aspectRatio ?? 1;
  frustum.fov = ar > 1.0 ? 2.0 * Math.atan(Math.tan(fovyRad * 0.5) * ar) : fovyRad;
}

function restoreFov() {
  if (!viewer?.camera) return;
  const frustum = viewer.camera.frustum;
  if (savedFov != null && frustum instanceof Cesium.PerspectiveFrustum) {
    const ar = frustum.aspectRatio ?? 1;
    frustum.fov = ar > 1.0 ? 2.0 * Math.atan(Math.tan(savedFov * 0.5) * ar) : savedFov;
  }
  savedFov = null;
}

function showTourCaption(html) {
  const el = document.getElementById("tourCaption");
  if (!el) return;
  el.style.display = html ? "block" : "none";
  el.innerHTML = html ?? "";
}

function hideTourCaption() {
  showTourCaption(null);
}

function applyFloorSlice(rec) {
  const baseRel = rec.props.base_height ?? 0;
  const ceilRel = rec.props.extruded_height ?? baseRel + 3;
  setFloorSlice(baseRel, ceilRel);
}

export function prepareInteriorView(rec) {
  if (!rec || !viewer) return;
  setRoomDisplayMode("hidden");
  setRoomsVisible(false);
  clearIAQColors();
  applyFloorSlice(rec);
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
}

function polygonPositions(rec) {
  try {
    return rec.entity.polygon.hierarchy.getValue(Cesium.JulianDate.now()).positions;
  } catch {
    return null;
  }
}

function roomBoundingSphere(rec) {
  const positions = polygonPositions(rec);
  const pts = [];
  if (positions?.length) {
    for (const p of positions) {
      pts.push(p);
      const c = Cesium.Cartographic.fromCartesian(p);
      pts.push(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, rec.top));
    }
  } else {
    const mid = (rec.base + rec.top) * 0.5;
    pts.push(Cesium.Cartesian3.fromDegrees(rec.centroid.lon, rec.centroid.lat, mid));
  }
  const sphere = Cesium.BoundingSphere.fromPoints(pts);
  return new Cesium.BoundingSphere(sphere.center, Math.max(sphere.radius, 2.5));
}

function enuToCartographic(anchorLon, anchorLat, anchorH, eastM, northM, upM) {
  const anchor = Cesium.Cartesian3.fromDegrees(anchorLon, anchorLat, anchorH);
  const world = Cesium.Matrix4.multiplyByPoint(
    Cesium.Transforms.eastNorthUpToFixedFrame(anchor),
    new Cesium.Cartesian3(eastM, northM, upM),
    new Cesium.Cartesian3(),
  );
  return Cesium.Cartographic.fromCartesian(world);
}

function cartographicToCartesian(c) {
  return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);
}

function polygonEnu(rec) {
  const positions = polygonPositions(rec);
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
}

function scalePoint(x, y, maxR) {
  const d = Math.hypot(x, y);
  if (d < 1e-6) return { x: 0, y: 0 };
  const s = Math.min(1, maxR / d);
  return { x: x * s, y: y * s };
}

function roomFootprintSpan(verts) {
  if (!verts.length) return 4;
  let maxR = 0;
  for (const v of verts) maxR = Math.max(maxR, Math.hypot(v.x, v.y));
  return maxR * 2;
}

function fovForSpan(span) {
  if (span >= 7) return INTERIOR_FOV_DEG;
  if (span >= 4.5) return 80;
  return 76;
}

function roomBoundsEnu(verts) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    spanX: maxX - minX,
    spanY: maxY - minY,
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

/**
 * Eye-level interior shot for every room — scales from small (WC) to large (Woonkamer).
 */
function interiorViewParams(rec) {
  const { lon, lat } = rec.centroid;
  const roomH = rec.top - rec.base;
  let eyeUp = Math.max(1.48, Math.min(1.72, roomH * 0.4));
  let aimUp = Math.max(1.1, Math.min(1.42, roomH * 0.3));

  const verts = polygonEnu(rec);
  let eyeEast = -0.9;
  let eyeNorth = -1.1;
  let aimEast = 0.9;
  let aimNorth = 1.1;
  const span = roomFootprintSpan(verts);

  const override = getRoomCameraOverride(rec.props.room_id);
  if (override && verts.length >= 2) {
    const bounds = roomBoundsEnu(verts);
    const ep = enuFromFraction(bounds, override.eye.fx, override.eye.fy);
    const ap = enuFromFraction(bounds, override.aim.fx, override.aim.fy);
    eyeEast = ep.east;
    eyeNorth = ep.north;
    aimEast = ap.east;
    aimNorth = ap.north;
    eyeUp = override.eye.up ?? eyeUp;
    aimUp = override.aim.up ?? aimUp;
  } else {
    const wallMargin = span < 3.5 ? 0.35 : span < 5.5 ? 0.42 : 0.5;
    const sizeT = Cesium.Math.clamp((span - 3) / 5, 0, 1);

    if (verts.length >= 2) {
      if (span < 4.5) {
        let far = verts[0];
        let farDist = 0;
        for (const v of verts) {
          const d = Math.hypot(v.x, v.y);
          if (d > farDist) {
            farDist = d;
            far = v;
          }
        }
        const nearK = 0.22 + sizeT * 0.08;
        const farK = 0.28 + sizeT * 0.1;
        eyeEast = -far.x * nearK;
        eyeNorth = -far.y * nearK;
        aimEast = far.x * farK;
        aimNorth = far.y * farK;
      } else {
        let bestA = verts[0];
        let bestB = verts[1];
        let bestLen = 0;
        for (let i = 0; i < verts.length; i++) {
          for (let j = i + 1; j < verts.length; j++) {
            const len = Cesium.Cartesian3.distance(verts[i], verts[j]);
            if (len > bestLen) {
              bestLen = len;
              bestA = verts[i];
              bestB = verts[j];
            }
          }
        }

        const eyeInset = Math.max(0, (Math.hypot(bestA.x, bestA.y) - wallMargin) / Math.hypot(bestA.x, bestA.y));
        const aimInset = Math.max(0, (Math.hypot(bestB.x, bestB.y) - wallMargin) / Math.hypot(bestB.x, bestB.y));
        const eyeFrac = 0.9 + sizeT * 0.04;
        const aimFrac = 0.84 + sizeT * 0.06;
        const maxEyeR = span * (0.38 + sizeT * 0.06);
        const maxAimR = span * (0.36 + sizeT * 0.04);

        const eye = scalePoint(bestA.x * eyeInset * eyeFrac, bestA.y * eyeInset * eyeFrac, maxEyeR);
        const aim = scalePoint(bestB.x * aimInset * aimFrac, bestB.y * aimInset * aimFrac, maxAimR);
        eyeEast = eye.x;
        eyeNorth = eye.y;
        aimEast = aim.x;
        aimNorth = aim.y;
      }
    }
  }

  const eye = enuToCartographic(lon, lat, rec.base, eyeEast, eyeNorth, eyeUp);
  const target = enuToCartographic(lon, lat, rec.base, aimEast, aimNorth, aimUp);
  const panDeg = Cesium.Math.clamp(span * 5.5, 14, 40);

  return { eye, target, panDeg, span };
}

function orientationAt(eye, target) {
  const eyeCart = cartographicToCartesian(eye);
  const targetCart = cartographicToCartesian(target);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(eyeCart);
  const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
  const local = Cesium.Matrix4.multiplyByPoint(inv, targetCart, new Cesium.Cartesian3());
  const horiz = Math.hypot(local.x, local.y);
  return {
    heading: Math.atan2(local.x, local.y),
    pitch: Math.atan2(local.z, horiz),
  };
}

function applyInteriorView(eye, target, panProgress = 0, panRad = 0) {
  const destination = cartographicToCartesian(eye);
  const { heading, pitch } = orientationAt(eye, target);
  const startH = heading - panRad * 0.5;
  viewer.camera.setView({
    destination,
    orientation: {
      heading: startH + panRad * panProgress,
      pitch,
      roll: 0,
    },
  });
}

function flyCamera(opts, gen) {
  return new Promise((resolve) => {
    if (!isActiveTour(gen)) {
      resolve(false);
      return;
    }
    viewer.camera.flyTo({
      ...opts,
      easingFunction: Cesium.EasingFunction.CUBIC_OUT,
      complete: () => resolve(isActiveTour(gen)),
      cancel: () => resolve(false),
    });
  });
}

function flyToBoundingSphere(sphere, offset, duration, gen) {
  return new Promise((resolve) => {
    if (!isActiveTour(gen)) {
      resolve(false);
      return;
    }
    viewer.camera.flyToBoundingSphere(sphere, {
      duration,
      offset,
      complete: () => resolve(isActiveTour(gen)),
      cancel: () => resolve(false),
    });
  });
}

function animateCamera(frameFn, durationMs, gen) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    function tick() {
      if (!isActiveTour(gen)) {
        resolve(false);
        return;
      }
      const t = Math.min(1, (performance.now() - t0) / durationMs);
      frameFn(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve(true);
    }
    requestAnimationFrame(tick);
  });
}

async function interiorPan(rec, gen, { durationMs = 2400 } = {}) {
  const { eye, target, panDeg } = interiorViewParams(rec);
  const panRad = Cesium.Math.toRadians(panDeg);

  return animateCamera((t) => {
    const e = Cesium.EasingFunction.SINUSOIDAL_IN_OUT(t);
    applyInteriorView(eye, target, e, panRad);
  }, durationMs, gen);
}

export async function playRoomTour(roomId, options = {}) {
  const { onComplete, skipOrbit = false, keepCaption = false, directInterior = false } = options;
  const rec = roomEntities.find((r) => r.props.room_id === roomId);
  if (!rec) {
    console.warn("Room tour: unknown room_id", roomId);
    onComplete?.();
    return false;
  }
  if (!viewer?.camera) {
    console.error("Room tour: viewer not ready");
    onComplete?.();
    return false;
  }

  // Abort any in-flight tour; playRoomTour owns tour lifecycle (no external stopRoomTour).
  tourAbort = true;
  cancelCameraFlight();
  releaseCameraLock();
  tourAbort = false;
  const gen = ++tourGen;

  const name = rec.props.room_name ?? roomId;
  const floor = rec.props.floor ?? "";
  showTourCaption(`<b>📍 ${name}</b> · ${floor}`);

  try {
    const view = interiorViewParams(rec);
    const { eye, target } = view;
    const { heading: h, pitch } = orientationAt(eye, target);

    if (directInterior) {
      prepareInteriorView(rec);
      saveAndWidenFov(rec);

      const flew = await flyCamera({
        destination: cartographicToCartesian(eye),
        orientation: { heading: h, pitch, roll: 0 },
        duration: 0.9,
      }, gen);

      if (!flew || !isActiveTour(gen)) {
        if (!isActiveTour(gen)) return false;
        applyInteriorView(eye, target, 0, 0);
      }
    } else {
      const sphere = roomBoundingSphere(rec);
      const approachRange = Math.max(
        sphere.radius * 2.8,
        view.span * 1.1,
        view.span < 4 ? 4.5 : 7,
      );

      const zoomed = await flyToBoundingSphere(
        sphere,
        new Cesium.HeadingPitchRange(
          orientationAt(view.eye, view.target).heading,
          Cesium.Math.toRadians(-22),
          approachRange,
        ),
        1.0,
        gen,
      );

      if (!zoomed || !isActiveTour(gen)) return false;

      prepareInteriorView(rec);
      saveAndWidenFov(rec);

      await flyCamera({
        destination: cartographicToCartesian(eye),
        orientation: { heading: h, pitch, roll: 0 },
        duration: 1.1,
      }, gen);
    }

    if (!skipOrbit && isActiveTour(gen)) {
      await interiorPan(rec, gen, { durationMs: options.panMs ?? 2400 });
    }

    if (!isActiveTour(gen)) return false;

    if (!keepCaption) hideTourCaption();
    onComplete?.();
    return true;
  } catch (err) {
    console.error("Room tour failed:", err);
    const { eye, target } = interiorViewParams(rec);
    applyInteriorView(eye, target, 0, 0);
    prepareInteriorView(rec);
    if (!keepCaption) hideTourCaption();
    onComplete?.();
    return false;
  }
}

export function flyToRoomInterior(roomId, options = {}) {
  return playRoomTour(roomId, {
    skipOrbit: options.skipOrbit ?? true,
    directInterior: options.directInterior ?? false,
    onComplete: options.onComplete,
  });
}

export function getRoomRecord(roomId) {
  return roomEntities.find((r) => r.props.room_id === roomId) ?? null;
}

/** Standing pose for in-room patrol — fixed position, look-only scan. */
export function getPatrolPose(roomId) {
  const rec = getRoomRecord(roomId);
  if (!rec) return null;
  const { eye, target } = interiorViewParams(rec);
  const { heading, pitch } = orientationAt(eye, target);
  return { rec, eye, heading, pitch };
}

/** Patrol pose from the camera's current in-room landing position. */
export function getPatrolPoseFromCamera(roomId) {
  const rec = getRoomRecord(roomId);
  if (!rec || !viewer?.camera) return null;
  const eye = Cesium.Cartographic.fromCartesian(viewer.camera.position);
  return {
    rec,
    eye,
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
  };
}

/** Elevated corner pose — slow orbit over the room centre (dollhouse-style scan). */
export function getPatrolElevatedPose(roomId) {
  const rec = getRoomRecord(roomId);
  if (!rec) return null;

  const { lon, lat } = rec.centroid;
  const roomH = rec.top - rec.base;
  const verts = polygonEnu(rec);
  const span = roomFootprintSpan(verts);

  const eyeUp = Math.min(roomH - 0.18, Math.max(roomH * 0.78, 2.1));
  let eyeEast = 0;
  let eyeNorth = 0;
  if (verts.length >= 2) {
    const bounds = roomBoundsEnu(verts);
    eyeEast = bounds.minX + bounds.spanX * 0.14;
    eyeNorth = bounds.minY + bounds.spanY * 0.14;
  }

  const aimUp = Math.max(0.85, roomH * 0.3);
  const eye = enuToCartographic(lon, lat, rec.base, eyeEast, eyeNorth, eyeUp);
  const target = enuToCartographic(lon, lat, rec.base, 0, 0, aimUp);
  const { heading, pitch } = orientationAt(eye, target);

  return { rec, eye, target, heading, pitch, span };
}

export function releaseRoomCamera() {
  releaseCameraLock();
}

/** Cancel in-flight camera moves without tearing down room-view state. */
export function interruptCameraMotion() {
  cancelCameraFlight();
  releaseCameraLock();
}

/** Snap to elevated patrol pose (upper corner, looking down at room centre). */
export function snapToElevatedPatrolView(roomId) {
  const pose = getPatrolElevatedPose(roomId);
  if (!pose || !viewer?.camera) return null;

  prepareInteriorView(pose.rec);
  const frustum = viewer.camera.frustum;
  if (frustum instanceof Cesium.PerspectiveFrustum) {
    const deg = pose.span >= 7 ? 84 : pose.span >= 4.5 ? 80 : 76;
    frustum.fovy = Cesium.Math.toRadians(deg);
  }

  const dest = cartographicToCartesian(pose.eye);
  const pitch = Cesium.Math.clamp(pose.pitch, -0.9, -0.18);
  viewer.camera.setView({
    destination: dest,
    orientation: { heading: pose.heading, pitch, roll: 0 },
  });
  viewer.scene.requestRender();
  return pose;
}

/** Jump straight to interior eye-level view (no fly animation). */
export function snapToRoomInterior(roomId) {
  const rec = getRoomRecord(roomId);
  if (!rec || !viewer?.camera) return false;

  cancelCameraFlight();
  releaseCameraLock();
  prepareInteriorView(rec);
  saveAndWidenFov(rec);
  const { eye, target } = interiorViewParams(rec);
  applyInteriorView(eye, target, 0, 0);
  viewer.scene.requestRender();
  return true;
}

export function clearRoomView() {
  stopRoomTour();
  setSectionCut(null);
}
