// Loads the rooms GeoJSON and renders extruded, clickable room polygons.
// Geometry only — NO sensor values live in the GeoJSON (architecture rule).
import { CONFIG } from "../config.js";
import { viewer, groundHeight } from "./cesiumViewer.js";
import { co2ToCesiumColor, evaluateMetric, statusColor, worstStatus } from "../data/sensorDataService.js";

export const FLOOR_COLORS = {
  "Level 0": "#4fc3f7",
  "Level 1": "#81c784",
  "Level 2": "#ffb74d",
  "Roof": "#ba68c8",
};
const DEFAULT_COLOR = "#90a4ae";

export const roomEntities = []; // { entity, props }
export let floors = [];         // unique floor names, sorted

export async function loadRooms() {
  const path = CONFIG.USE_SAMPLE_GEOJSON
    ? CONFIG.SAMPLE_GEOJSON_PATH
    : CONFIG.ROOMS_GEOJSON_PATH;

  let geojson;
  try {
    const res = await fetch(encodeURI(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    geojson = await res.json();
  } catch (e) {
    console.error(`Could not load rooms GeoJSON (${path}):`, e.message);
    return { count: 0, source: path, error: e.message };
  }

  let count = 0;
  const floorSet = new Set();

  for (const feature of geojson.features ?? []) {
    try {
      const p = feature.properties ?? {};
      const geom = feature.geometry;
      if (!geom || geom.type !== "Polygon" || !geom.coordinates?.length) continue;

      const outer = geom.coordinates[0]; // MVP: outer ring
      if (outer.length < 4) continue;
      const positions = outer.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
      const holes = geom.coordinates.slice(1).map(
        (ring) => new Cesium.PolygonHierarchy(
          ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))));

      const floor = p.floor ?? "Unknown";
      floorSet.add(floor);
      const color = Cesium.Color.fromCssColorString(FLOOR_COLORS[floor] ?? DEFAULT_COLOR);
      const base = groundHeight + (p.base_height ?? 0);
      const top = groundHeight + (p.extruded_height ?? (p.base_height ?? 0) + 3);

      const entity = viewer.entities.add({
        id: `room_${p.room_id ?? count}`,
        name: p.room_name ?? p.room_id,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions, holes),
          height: base,
          extrudedHeight: top,
          material: color.withAlpha(0.45),
          outline: true,
          outlineColor: color.withAlpha(0.95),
        },
        properties: { isRoom: true, ...p },
      });
      // centroid = average of outer-ring vertices (good enough as a waypoint)
      const cLon = outer.reduce((s, c) => s + c[0], 0) / outer.length;
      const cLat = outer.reduce((s, c) => s + c[1], 0) / outer.length;
      roomEntities.push({ entity, props: p, base, top, color, outer, centroid: { lon: cLon, lat: cLat } });
      count++;
    } catch (e) {
      console.warn("Skipping invalid room feature:", e.message);
    }
  }

  floors = [...floorSet].sort();
  setRoomDisplayMode("hidden"); // IFC is the visual model; rooms are data
  return { count, source: path };
}

export function filterByFloor(floor) {
  for (const { entity, props } of roomEntities) {
    entity.show = floor === "ALL" || props.floor === floor;
  }
}

// Room display modes — the GeoJSON is a data spine, not the visual model:
//  "hidden"     = invisible but still pickable/hoverable (DEFAULT — the IFC
//                 model is what you see; rooms light up only on hover/click)
//  "footprints" = thin colored slabs at floor level (analysis overlay)
//  "volumes"    = full extruded prisms (may poke through sloped roofs)
let displayMode = "hidden";
export const getRoomDisplayMode = () => displayMode;

export function setRoomDisplayMode(mode) {
  displayMode = mode;
  for (const { entity, base, top, color } of roomEntities) {
    if (mode === "hidden") {
      entity.polygon.extrudedHeight = top;
      entity.polygon.material = color.withAlpha(0.012); // invisible, still pickable
      entity.polygon.outline = false;
    } else {
      entity.polygon.extrudedHeight = mode === "footprints" ? base + 0.15 : top;
      entity.polygon.material = color.withAlpha(0.45);
      entity.polygon.outline = true;
    }
  }
}

export function setRoomsVisible(visible) {
  for (const { entity } of roomEntities) entity.show = visible;
}

// Waypoints for the interior tour: room centre at eye height, per floor.
export function getWaypoints() {
  return roomEntities
    .map(({ props, centroid }) => ({
      room_id: props.room_id,
      name: props.room_name ?? props.room_id,
      number: props.room_number ?? "",
      floor: props.floor ?? "",
      lon: centroid.lon,
      lat: centroid.lat,
      eyeHeight: (props.base_height ?? 0) + 1.6,
    }))
    .sort((a, b) => a.floor.localeCompare(b.floor) || (+a.number || 0) - (+b.number || 0));
}

export function getRoomRecord(roomId) {
  return roomEntities.find((r) => r.props.room_id === roomId) ?? null;
}

/** Footprint bounds in metres (east/north) relative to the building anchor. */
export function getBuildingEnuBounds() {
  const anchorLon = CONFIG.BUILDING_LONGITUDE;
  const anchorLat = CONFIG.BUILDING_LATITUDE;
  const anchor = Cesium.Cartesian3.fromDegrees(anchorLon, anchorLat, groundHeight);
  const inv = Cesium.Matrix4.inverse(
    Cesium.Transforms.eastNorthUpToFixedFrame(anchor),
    new Cesium.Matrix4(),
  );

  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;

  for (const { outer } of roomEntities) {
    for (const [lon, lat] of outer) {
      const world = Cesium.Cartesian3.fromDegrees(lon, lat, groundHeight);
      const local = Cesium.Matrix4.multiplyByPoint(inv, world, new Cesium.Cartesian3());
      minE = Math.min(minE, local.x);
      maxE = Math.max(maxE, local.x);
      minN = Math.min(minN, local.y);
      maxN = Math.max(maxN, local.y);
    }
  }

  return { minE, maxE, minN, maxN };
}

/** Which room contains this world position (for walk-mode room detection). */
export function findRoomIdAtLonLat(lon, lat, height) {
  let bestId = null;
  let bestScore = Infinity;
  for (const { props, base, top, outer } of roomEntities) {
    if (!pointInRing(lon, lat, outer)) continue;
    const mid = (base + top) * 0.5;
    const score = Math.abs(height - mid);
    if (score < bestScore) {
      bestScore = score;
      bestId = props.room_id;
    }
  }
  return bestId;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pickWorldPosition(screenPosition) {
  if (!viewer) return null;
  const pos = viewer.scene.pickPosition(screenPosition);
  if (Cesium.defined(pos)) return pos;
  const ray = viewer.camera.getPickRay(screenPosition);
  return ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;
}

/** Resolve a room when the IFC shell sits on top of invisible room footprints. */
export function findRoomEntityAtScreen(screenPosition) {
  if (!viewer) return null;

  const drilled = viewer.scene.drillPick(screenPosition, 12);
  for (const hit of drilled) {
    const entity = hit?.id;
    if (entity?.properties?.isRoom?.getValue?.()) return entity;
  }

  const cartesian = pickWorldPosition(screenPosition);
  if (!cartesian) return null;

  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const h = carto.height;

  let best = null;
  let bestScore = Infinity;
  for (const { entity, base, top, outer } of roomEntities) {
    if (!pointInRing(lon, lat, outer)) continue;
    const mid = (base + top) * 0.5;
    const score = Math.abs(h - mid);
    if (score < bestScore) {
      bestScore = score;
      best = entity;
    }
  }
  return best;
}

let iaqOverlayActive = false;

/** Paint room footprints by indoor air quality (CO₂ by default). */
export function applyIAQColors(readings, metric = "co2") {
  iaqOverlayActive = true;
  const byId = new Map(readings.map((r) => [r.room_id, r]));
  for (const { entity, props, color, base } of roomEntities) {
    const reading = byId.get(props.room_id);
    const value = reading?.[metric];
    const status = metric === "comfort" ? worstStatus(reading) : evaluateMetric(metric, value);
    const mat = reading && (metric === "comfort" || Number.isFinite(value))
      ? (metric === "co2"
        ? co2ToCesiumColor(value, 0.58)
        : Cesium.Color.fromCssColorString(statusColor(status)).withAlpha(0.58))
      : color.withAlpha(0.25);
    entity.polygon.extrudedHeight = base + 0.15;
    entity.polygon.material = mat;
    entity.polygon.outline = true;
    entity.polygon.outlineColor = mat.withAlpha(0.95);
  }
}

export function clearIAQColors() {
  iaqOverlayActive = false;
  if (displayMode === "footprints" || displayMode === "volumes") {
    setRoomDisplayMode(displayMode);
  }
}

export function isIAQOverlayActive() {
  return iaqOverlayActive;
}
