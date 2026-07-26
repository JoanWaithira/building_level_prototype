// Basemap / terrain imagery picker — Cesium, ESRI satellite, Google street map.
import { viewer } from "./cesiumViewer.js";
import { CONFIG } from "../config.js";

const STORAGE_KEY = "twinlink_basemap_v1";

export const BASEMAP_OPTIONS = [
  { id: "cesium", label: "Cesium" },
  { id: "esri", label: "ESRI" },
  { id: "street", label: "Google Street" },
];

let activeId = CONFIG.DEFAULT_BASEMAP ?? "cesium";

async function createProvider(id) {
  switch (id) {
    case "cesium":
      return Cesium.createWorldImageryAsync({
        style: Cesium.IonWorldImageryStyle.AERIAL,
      });
    case "esri":
      return Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
      );
    case "street":
      if (CONFIG.GOOGLE_MAPS_API_KEY) {
        return new Cesium.UrlTemplateImageryProvider({
          url: `https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${CONFIG.GOOGLE_MAPS_API_KEY}`,
          subdomains: ["0", "1", "2", "3"],
          maximumLevel: 21,
          credit: "© Google",
        });
      }
      return new Cesium.UrlTemplateImageryProvider({
        url: "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
        subdomains: ["0", "1", "2", "3"],
        maximumLevel: 21,
        credit: "© Google",
      });
    default:
      return Cesium.createWorldImageryAsync({
        style: Cesium.IonWorldImageryStyle.AERIAL,
      });
  }
}

export function getActiveBasemapId() {
  return activeId;
}

export async function setBasemap(id) {
  if (!viewer) return;
  const option = BASEMAP_OPTIONS.find((o) => o.id === id) ?? BASEMAP_OPTIONS[0];
  activeId = option.id;

  try {
    const provider = await createProvider(option.id);
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(provider);
    localStorage.setItem(STORAGE_KEY, option.id);
  } catch (e) {
    console.warn(`Basemap "${option.id}" failed, falling back to Cesium:`, e.message);
    if (option.id !== "cesium") await setBasemap("cesium");
  }
}

export async function initBasemap() {
  let saved = CONFIG.DEFAULT_BASEMAP ?? "cesium";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && BASEMAP_OPTIONS.some((o) => o.id === stored)) saved = stored;
  } catch { /* private mode */ }
  await setBasemap(saved);
}

export function mountBasemapPicker(container) {
  if (!container) return;
  const row = document.createElement("div");
  row.className = "vp-row vp-basemap";
  row.innerHTML = `
    <label for="basemapSelect" class="vp-label">Basemap</label>
    <select id="basemapSelect" class="vp-select">
      ${BASEMAP_OPTIONS.map(
        (o) => `<option value="${o.id}"${o.id === activeId ? " selected" : ""}>${o.label}</option>`,
      ).join("")}
    </select>`;
  container.prepend(row);

  document.getElementById("basemapSelect")?.addEventListener("change", (e) => {
    setBasemap(e.target.value);
  });
}
