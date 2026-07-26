// X-ray view — hide building envelope (walls/slabs/roof) so fixtures stay visible.

let buildingTileset = null;
let xrayOn = false;

/** IFC types treated as opaque envelope (hidden in x-ray mode). */
const ENVELOPE_IFC_TYPES = [
  "IfcWall",
  "IfcWallStandardCase",
  "IfcSlab",
  "IfcRoof",
  "IfcCovering",
  "IfcCurtainWall",
  "IfcPlate",
  "IfcBuildingElementProxy",
];

function envelopeStyleConditions() {
  const conditions = [];
  for (const t of ENVELOPE_IFC_TYPES) {
    conditions.push([`\${ifcType} === '${t}'`, false]);
    conditions.push([`\${elementType} === '${t}'`, false]);
    conditions.push([`regExp('^${t}', \${ifcType})`, false]);
    conditions.push([`regExp('^${t}', \${elementType})`, false]);
  }
  conditions.push([true, true]);
  return conditions;
}

export function registerBuildingTileset(tileset) {
  buildingTileset = tileset ?? null;
  applyXRayMode();
}

export function isXRayMode() {
  return xrayOn;
}

export function setXRayMode(on) {
  xrayOn = !!on;
  applyXRayMode();
  syncXRayToggle();
  return xrayOn;
}

export function toggleXRayMode() {
  return setXRayMode(!xrayOn);
}

export function applyXRayMode() {
  if (!buildingTileset) return;

  if (!xrayOn) {
    buildingTileset.style = undefined;
    return;
  }

  buildingTileset.style = new Cesium.Cesium3DTileStyle({
    show: { conditions: envelopeStyleConditions() },
  });
}

export function mountXRayToggle(container) {
  if (!container || document.getElementById("xrayToggle")) return;

  const row = document.createElement("label");
  row.className = "vp-row";
  row.innerHTML = `<input type="checkbox" id="xrayToggle"> X-ray (hide walls)`;
  container.appendChild(row);

  document.getElementById("xrayToggle")?.addEventListener("change", (e) => {
    setXRayMode(e.target.checked);
  });
}

function syncXRayToggle() {
  const el = document.getElementById("xrayToggle");
  if (el) el.checked = xrayOn;
  document.getElementById("btnXRay")?.classList.toggle("active", xrayOn);
}
