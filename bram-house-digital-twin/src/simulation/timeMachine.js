// Time Machine: scrub through the real year of data — the house shows each day.
//  - rooms glow orange with that day's gas (heating) intensity
//  - green tint on high solar-export days
//  - chimney smoke particles on heavy-gas days
//  - sun position follows the selected date
//  - night lights: windows glow room-by-room in the evening (see updateNightLights)
import { viewer, groundHeight } from "../viewer/cesiumViewer.js";
import { roomEntities, setRoomDisplayMode, getRoomDisplayMode } from "../viewer/geojsonRooms.js";
import { CONFIG } from "../config.js";

let S = null;            // summary.series
let dates = [];          // aligned date axis (from importDaily)
let byDate = new Map();  // date -> {imp, exp, gas, soc}
let active = false;
let playTimer = null;
let originalColors = null;
let smoke = null;
const nightLightEntities = [];

export function initTimeMachine(summary) {
  S = summary.series ?? {};
  dates = (S.importDaily ?? []).map((d) => d.date);
  const g = new Map((S.gasDaily ?? []).map((d) => [d.date, d.value]));
  const e = new Map((S.exportDaily ?? []).map((d) => [d.date, d.value]));
  const soc = new Map((S.batterySoCRange ?? []).map((d) => [d.date, d]));
  for (const d of S.importDaily ?? []) {
    byDate.set(d.date, { imp: d.value, exp: e.get(d.date) ?? 0, gas: g.get(d.date) ?? 0, soc: soc.get(d.date) });
  }
  // Bottom-bar Time Machine UI removed — sun/night helpers still available.
}

const maxOf = (s) => Math.max(0.001, ...(s ?? []).map((d) => d.value));

function renderBar() {
  const el = document.getElementById("timeMachine");
  if (!el) return;
  if (!dates.length) { el.style.display = "none"; return; }
  el.innerHTML = `
    <button class="tbtn tbtn-sm" id="tmToggle" title="Replay the real year of data on the house">Time Machine</button>
    <div id="tmControls" style="display:none">
      <button class="tbtn tbtn-sm" id="tmPlay">▶</button>
      <input type="range" id="tmSlider" min="0" max="${dates.length - 1}" value="${dates.length - 1}">
      <div id="tmReadout"></div>
    </div>`;
  document.getElementById("tmToggle").onclick = toggle;
  document.getElementById("tmSlider").oninput = () => showDay(+document.getElementById("tmSlider").value);
  document.getElementById("tmPlay").onclick = playPause;
}

let previousMode = "hidden";
function toggle() {
  active = !active;
  document.getElementById("tmToggle").classList.toggle("active", active);
  document.getElementById("tmControls").style.display = active ? "flex" : "none";
  if (active) {
    // visualize on flat footprints so nothing pokes through the roof
    previousMode = getRoomDisplayMode();
    setRoomDisplayMode("footprints");
    originalColors = roomEntities.map(({ entity }) => entity.polygon.material);
    showDay(+document.getElementById("tmSlider").value);
  } else {
    stopPlay();
    setRoomDisplayMode(previousMode); // restores materials + extrusion
    setSmoke(0);
    document.getElementById("tmReadout").innerHTML = "";
  }
}

function playPause() {
  if (playTimer) { stopPlay(); return; }
  document.getElementById("tmPlay").textContent = "⏸";
  playTimer = setInterval(() => {
    const s = document.getElementById("tmSlider");
    const next = (+s.value + 1) % dates.length;
    s.value = next;
    showDay(next);
    if (next === dates.length - 1) stopPlay();
  }, 120);
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  const b = document.getElementById("tmPlay");
  if (b) b.textContent = "▶";
}

function showDay(i) {
  const date = dates[i];
  const d = byDate.get(date);
  if (!d) return;

  // 1. house tint: orange = gas heating, green = solar surplus
  const gasN = Math.min(1, d.gas / (maxOf(S.gasDaily) * 0.7));
  const expN = Math.min(1, d.exp / (maxOf(S.exportDaily) * 0.7));
  for (const { entity } of roomEntities) {
    const r = 0.3 + 0.65 * gasN, g = 0.45 + 0.4 * expN, b = 0.55 - 0.3 * gasN;
    entity.polygon.material = new Cesium.Color(r, g, Math.max(0.05, b), 0.5);
  }

  // 2. chimney smoke on heavy-heating days
  setSmoke(gasN);

  // 3. sun follows the date (13:00 local)
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(`${date}T13:00:00`));
  viewer.clock.shouldAnimate = false;

  // 4. readout
  const season = ["winter","winter","spring","spring","spring","summer","summer","summer","autumn","autumn","autumn","winter"][+date.slice(5,7)-1];
  document.getElementById("tmReadout").innerHTML =
    `<b>${date}</b> <span class="muted">(${season})</span> · ⚡ ${d.imp.toFixed(1)} kWh in / ${d.exp.toFixed(1)} out
     · 🔥 ${d.gas.toFixed(1)} m³${d.soc ? ` · 🔋 ${d.soc.min}–${d.soc.max}%` : ""}`;
}

/* ---------- chimney smoke (particle system) ---------- */
function smokeImage() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, "rgba(200,200,205,0.85)");
  grad.addColorStop(1, "rgba(200,200,205,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return c.toDataURL();
}

function setSmoke(intensity) {
  if (intensity < 0.15) {
    if (smoke) smoke.show = false;
    return;
  }
  if (!smoke) {
    const pos = Cesium.Cartesian3.fromDegrees(
      CONFIG.BUILDING_LONGITUDE + 0.00028, CONFIG.BUILDING_LATITUDE - 0.00008, groundHeight + 9.5);
    smoke = viewer.scene.primitives.add(new Cesium.ParticleSystem({
      image: smokeImage(),
      startColor: Cesium.Color.WHITE.withAlpha(0.5),
      endColor: Cesium.Color.WHITE.withAlpha(0),
      startScale: 1, endScale: 5,
      particleLife: 4, speed: 1.2,
      imageSize: new Cesium.Cartesian2(2, 2),
      emissionRate: 6,
      lifetime: Number.MAX_VALUE,
      emitter: new Cesium.CircleEmitter(0.4),
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(pos),
      emitterModelMatrix: Cesium.Matrix4.IDENTITY,
    }));
  }
  smoke.show = true;
  smoke.emissionRate = 3 + 12 * intensity;
}

/* ---------- night lights (called from the sun-hour slider) ---------- */
// Rooms light up in a realistic evening order.
const EVENING_ORDER = ["Keuken", "Woonkamer", "Eetkamer", "Hal", "Badkamer", "Slaapkamer"];

export function updateNightLights(hour) {
  const night = hour < 7.5 || hour >= 19;
  if (!night) {
    nightLightEntities.forEach((e) => (e.show = false));
    return;
  }
  if (!nightLightEntities.length) {
    for (const { props, base, centroid } of roomEntities) {
      // base already includes groundHeight
      nightLightEntities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(centroid.lon, centroid.lat, base + 1.4),
        point: {
          pixelSize: 22,
          color: Cesium.Color.fromCssColorString("#ffd97a").withAlpha(0.9),
          outlineColor: Cesium.Color.fromCssColorString("#ffb340").withAlpha(0.35),
          outlineWidth: 10,
          disableDepthTestDistance: 60,
        },
        show: false,
        roomLight: props.room_name,
      }));
    }
  }
  // later in the evening -> more rooms lit; bedrooms last, then lights out
  const lateness = hour >= 19 ? (hour - 19) / 5 : 1; // 19:00→0 … 24:00→1
  nightLightEntities.forEach((e) => {
    const idx = EVENING_ORDER.findIndex((n) => (e.roomLight ?? "").startsWith(n));
    const order = idx === -1 ? 0.5 : idx / EVENING_ORDER.length;
    e.show = hour < 7.5 ? false : lateness >= order * 0.8 && lateness < 0.95;
  });
}
