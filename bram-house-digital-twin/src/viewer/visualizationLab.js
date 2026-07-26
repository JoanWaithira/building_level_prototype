// Unified spatial analytics for the Cesium scene. Energy-at-room values are
// estimates until sub-meter mappings replace the area/IAQ allocation below.
import { viewer, groundHeight } from "./cesiumViewer.js";
import { roomEntities, floors, setRoomDisplayMode, applyIAQColors, filterByFloor } from "./geojsonRooms.js";
import { getAllReadings, applyReadings, worstStatus, statusColor } from "../data/sensorDataService.js";
import { getTimeline, getReadingAtIndex, getHistory } from "../data/iaqHistoryService.js";
import { setSectionCut } from "./viewControls.js";
import { CONFIG } from "../config.js";

let energy = null;
let metric = "co2";
let timer = null;
let frameIndex = 0;
let markers = [];
let columns = [];
let effects = [];
let selectedRoomId = null;

const $ = (id) => document.getElementById(id);
const readingMap = () => new Map(getAllReadings().map((r) => [r.room_id, r]));
const statusRank = { unknown: 0, good: 1, warn: 2, bad: 3 };

function estimatedRoomLoads() {
  const readings = readingMap();
  const total = energy?.dailyImportKWh?.at(-1)?.value ?? 12;
  const weights = roomEntities.map((rec) => {
    const area = Math.max(1, polygonArea(rec.outer));
    const r = readings.get(rec.props.room_id);
    const penalty = r ? 1 + Math.max(0, r.co2 - 700) / 1800 : 1;
    return { rec, weight: area * penalty };
  });
  const sum = weights.reduce((s, x) => s + x.weight, 0) || 1;
  return weights.map((x) => ({ rec: x.rec, kwh: total * x.weight / sum }));
}

function polygonArea(ring) {
  if (!ring?.length) return 1;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length * Math.PI / 180;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x1 = ring[j][0] * 111320 * Math.cos(lat), y1 = ring[j][1] * 110540;
    const x2 = ring[i][0] * 111320 * Math.cos(lat), y2 = ring[i][1] * 110540;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function colorForReading(r) {
  return Cesium.Color.fromCssColorString(statusColor(worstStatus(r)));
}

function renderLegend() {
  const labels = {
    co2: "CO₂: green ≤800 · amber ≤1000 · red >1000 ppm",
    temperature: "Temperature: green 18–26 °C · amber outside",
    humidity: "Humidity: green 30–65% · amber outside",
    comfort: "Combined comfort: worst of temperature, humidity and CO₂",
  };
  $("vizLegend").textContent = labels[metric];
}

function updateHeatmap() {
  setRoomDisplayMode("footprints");
  applyIAQColors(getAllReadings(), metric);
  renderLegend();
  updateMarkers();
}

function clearEntities(list) {
  for (const e of list) viewer.entities.remove(e);
  list.length = 0;
}

function updateMarkers() {
  if (!$("vizMarkers")?.checked) return;
  clearEntities(markers);
  const readings = readingMap();
  for (const rec of roomEntities) {
    const r = readings.get(rec.props.room_id);
    if (!r) continue;
    markers.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(rec.centroid.lon, rec.centroid.lat, rec.top + 0.55),
      label: {
        text: `${rec.props.room_name ?? rec.props.room_id}\n${r.temperature}°C  ${r.humidity}%  ${r.co2} ppm`,
        font: "12px sans-serif", fillColor: Cesium.Color.WHITE,
        showBackground: true, backgroundColor: colorForReading(r).withAlpha(0.82),
        pixelOffset: new Cesium.Cartesian2(0, -16),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 160),
        disableDepthTestDistance: 80,
      },
      point: { pixelSize: 8, color: colorForReading(r), outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
    }));
  }
}

function updateColumns(multiplier = 1) {
  clearEntities(columns);
  if (!$("vizColumns")?.checked) return;
  const loads = estimatedRoomLoads();
  const max = Math.max(...loads.map((x) => x.kwh), 1);
  for (const { rec, kwh } of loads) {
    const h = 1 + 8 * kwh / max * multiplier;
    const color = Cesium.Color.fromHsl(0.34 - 0.34 * kwh / max, 0.78, 0.55, 0.72);
    columns.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(rec.centroid.lon, rec.centroid.lat, rec.top + h / 2),
      cylinder: { length: h, topRadius: 0.35, bottomRadius: 0.6, material: color, outline: true, outlineColor: color.brighten(0.25, new Cesium.Color()) },
      label: { text: `~${kwh.toFixed(1)} kWh/day`, font: "11px sans-serif", fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.7), pixelOffset: new Cesium.Cartesian2(0, -24) },
    }));
  }
}

function setExploded(on) {
  const floorOrder = new Map(floors.map((f, i) => [f, i]));
  for (const rec of roomEntities) {
    const offset = on ? (floorOrder.get(rec.props.floor) ?? 0) * 4 : 0;
    rec.entity.polygon.height = rec.base + offset;
    rec.entity.polygon.extrudedHeight = rec.top + offset;
  }
}

function showAlerts(on) {
  for (const rec of roomEntities) {
    const r = readingMap().get(rec.props.room_id);
    rec.entity.show = !on || statusRank[worstStatus(r)] >= statusRank.warn;
  }
  if (on) updateHeatmap();
}

function buildEnergyFlow(on) {
  clearEntities(effects);
  if (!on) return;
  const center = Cesium.Cartesian3.fromDegrees(CONFIG.BUILDING_LONGITUDE, CONFIG.BUILDING_LATITUDE, groundHeight + 5);
  const nodes = [
    { name: "Grid", east: -18, north: 0, color: "#60a5fa" },
    { name: "Solar", east: 0, north: 15, color: "#fbbf24" },
    { name: "Battery", east: 18, north: 0, color: "#34d399" },
  ];
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  for (const n of nodes) {
    const p = Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(n.east, n.north, 0), new Cesium.Cartesian3());
    const c = Cesium.Color.fromCssColorString(n.color);
    effects.push(viewer.entities.add({ polyline: { positions: [p, center], width: 5, material: new Cesium.PolylineDashMaterialProperty({ color: c, dashLength: 18 }) } }));
    effects.push(viewer.entities.add({ position: p, point: { pixelSize: 14, color: c }, label: { text: n.name, pixelOffset: new Cesium.Cartesian2(0, -20), fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.7) } }));
  }
}

function setSolar(on) {
  viewer.shadows = on;
  viewer.scene.globe.enableLighting = on;
  if (on) {
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(new Date().setHours(13, 0, 0, 0)));
    for (const rec of roomEntities.filter((r) => /roof/i.test(r.props.floor ?? ""))) {
      effects.push(viewer.entities.add({ polygon: { hierarchy: rec.entity.polygon.hierarchy, height: rec.top + 0.2, material: Cesium.Color.GOLD.withAlpha(0.55), outline: true, outlineColor: Cesium.Color.YELLOW } }));
    }
  }
}

function showTrail(roomId) {
  clearEntities(effects);
  const rec = roomEntities.find((x) => x.props.room_id === roomId) ?? roomEntities[0];
  if (!rec) return;
  const history = getHistory(rec.props.room_id, 24);
  const points = history.map((p, i) => Cesium.Cartesian3.fromDegrees(rec.centroid.lon, rec.centroid.lat, rec.top + 0.3 + i * 0.12));
  effects.push(viewer.entities.add({ position: points.at(-1), polyline: { positions: points, width: 7, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.22, color: Cesium.Color.ORANGE }) }, label: { text: "24 h CO₂ trail", pixelOffset: new Cesium.Cartesian2(0, -15), fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.7) } }));
}

function applyFrame(index) {
  const frame = getReadingAtIndex(index);
  if (!frame?.readings?.length) return;
  frameIndex = frame.index;
  applyReadings(frame.readings);
  updateHeatmap();
  $("vizTime").value = String(frameIndex);
  $("vizTimestamp").textContent = new Date(frame.timestamp).toLocaleString();
}

function togglePlayback() {
  if (timer) { clearInterval(timer); timer = null; $("vizPlay").textContent = "Play"; return; }
  $("vizPlay").textContent = "Pause";
  timer = setInterval(() => {
    const timeline = getTimeline();
    applyFrame((frameIndex + 1) % Math.max(1, timeline.length));
  }, 650);
}

function mountControls() {
  const host = $("vpBody");
  if (!host || $("vizLab")) return;
  host.insertAdjacentHTML("beforeend", `
    <hr class="vp-sep"><div id="vizLab" class="viz-lab">
      <div class="viz-title">Spatial analytics</div>
      <label class="vp-row">Metric <select id="vizMetric"><option value="co2">CO₂</option><option value="temperature">Temperature</option><option value="humidity">Humidity</option><option value="comfort">Combined comfort</option></select></label>
      <div id="vizLegend" class="viz-legend"></div>
      <div class="vp-row"><button class="tbtn tbtn-sm" id="vizPlay">Play</button><input id="vizTime" type="range" min="0" max="0" value="0"><span id="vizTimestamp" class="vp-val"></span></div>
      <label class="vp-row"><input type="checkbox" id="vizMarkers"> Floating sensor labels</label>
      <label class="vp-row"><input type="checkbox" id="vizColumns"> Estimated energy columns</label>
      <label class="vp-row"><input type="checkbox" id="vizExplode"> Exploded floors</label>
      <label class="vp-row"><input type="checkbox" id="vizAlerts"> Exceptions only</label>
      <label class="vp-row"><input type="checkbox" id="vizFlow"> Energy flows</label>
      <label class="vp-row"><input type="checkbox" id="vizSolar"> Solar exposure</label>
      <div class="vp-row"><button class="tbtn tbtn-sm" id="vizTrail">24 h trail</button><button class="tbtn tbtn-sm" id="vizScenario">Compare retrofit</button></div>
      <label class="vp-row">Floor <select id="vizFloor"><option value="ALL">All floors</option>${floors.map((f) => `<option>${f}</option>`).join("")}</select></label>
      <label class="vp-row">Section height <input id="vizSection" type="range" min="0" max="12" step="0.2" value="12"><span id="vizSectionLabel" class="vp-val">Off</span></label>
      <p class="viz-note">~ Room energy values are modeled allocations, not sub-meter measurements.</p>
    </div>`);
  const timeline = getTimeline();
  $("vizTime").max = String(Math.max(0, timeline.length - 1));
  $("vizTime").value = String(Math.max(0, timeline.length - 1));
  frameIndex = Math.max(0, timeline.length - 1);
  $("vizMetric").onchange = (e) => { metric = e.target.value; updateHeatmap(); };
  $("vizPlay").onclick = togglePlayback;
  $("vizTime").oninput = (e) => applyFrame(+e.target.value);
  $("vizMarkers").onchange = (e) => e.target.checked ? updateMarkers() : clearEntities(markers);
  $("vizColumns").onchange = () => updateColumns();
  $("vizExplode").onchange = (e) => setExploded(e.target.checked);
  $("vizAlerts").onchange = (e) => showAlerts(e.target.checked);
  $("vizFlow").onchange = (e) => buildEnergyFlow(e.target.checked);
  $("vizSolar").onchange = (e) => { clearEntities(effects); setSolar(e.target.checked); };
  $("vizTrail").onclick = () => showTrail(selectedRoomId);
  $("vizScenario").onclick = () => { $("vizColumns").checked = true; updateColumns(0.7); $("vizLegend").textContent = "Retrofit comparison: shorter columns represent modeled 30% demand reduction."; };
  $("vizFloor").onchange = (e) => filterByFloor(e.target.value);
  $("vizSection").oninput = (e) => { const h = +e.target.value; setSectionCut(h >= 11.9 ? null : h); $("vizSectionLabel").textContent = h >= 11.9 ? "Off" : `${h.toFixed(1)} m`; };
  document.addEventListener("room-selected", (e) => { selectedRoomId = e.detail?.roomId; });
  document.addEventListener("iaq-readings-updated", () => { updateHeatmap(); updateColumns(); });
  renderLegend();
}

export function initVisualizationLab(energySummary) {
  energy = energySummary;
  mountControls();
}
