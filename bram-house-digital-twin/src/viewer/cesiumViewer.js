 // Cesium viewer creation, terrain, optional 3D Tiles building shell.
// Cesium is loaded globally from the CDN in index.html.
import { CONFIG } from "../config.js";
import { initBasemap } from "./basemapService.js";

export let viewer = null;
export let groundHeight = 0; // ellipsoidal ground height at the anchor

/** Optional: hide IfcGeographicElement (site trees etc.) — exact match only, no regex. */
function applyIfcLandscapingFilter(tileset) {
  tileset.style = new Cesium.Cesium3DTileStyle({
    show: {
      conditions: [
        ["${ifcType} === 'IfcGeographicElement'", false],
        ["${elementType} === 'IfcGeographicElement'", false],
        [true, true],
      ],
    },
  });
}

export async function initViewer() {
  Cesium.Ion.defaultAccessToken = CONFIG.CESIUM_ION_TOKEN;

  viewer = new Cesium.Viewer("cesiumContainer", {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
  });
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#3d4a3d");

  await initBasemap();

  if (CONFIG.USE_WORLD_TERRAIN) {
    try {
      const tp = await Cesium.createWorldTerrainAsync();
      const s = await Cesium.sampleTerrainMostDetailed(tp, [
        Cesium.Cartographic.fromDegrees(CONFIG.BUILDING_LONGITUDE, CONFIG.BUILDING_LATITUDE),
      ]);
      if (s?.[0] && isFinite(s[0].height)) {
        viewer.terrainProvider = tp;
        groundHeight = s[0].height;
      }
    } catch (e) {
      console.warn("World Terrain unavailable, flat ellipsoid (ground=0):", e.message);
    }
  }

  viewer.scene.globe.depthTestAgainstTerrain = true;
  if ("pickTranslucentDepth" in viewer.scene) {
    viewer.scene.pickTranslucentDepth = true;
  }

  return viewer;
}

export function resetCamera() {
  if (!viewer) return;
  const targetLon = CONFIG.BUILDING_LONGITUDE + 0.00025;
  const targetLat = CONFIG.BUILDING_LATITUDE - 0.0001;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      targetLon,
      targetLat - 0.00040,
      groundHeight + 30,
    ),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-30), roll: 0 },
    duration: 1.2,
  });
}

/** Frame the loaded IFC tileset (call after tileset.ready). */
export function frameBuildingTileset(tileset) {
  if (!viewer || !tileset?.boundingSphere) return;
  const site = Cesium.Cartesian3.fromDegrees(
    CONFIG.BUILDING_LONGITUDE, CONFIG.BUILDING_LATITUDE, groundHeight);
  const dist = Cesium.Cartesian3.distance(tileset.boundingSphere.center, site);
  const radius = Math.max(tileset.boundingSphere.radius, 8);
  viewer.camera.flyToBoundingSphere(tileset.boundingSphere, {
    duration: 1.4,
    offset: new Cesium.HeadingPitchRange(
      0,
      Cesium.Math.toRadians(-32),
      radius * 2.8,
    ),
  });
  console.info(`IFC framed (centre ${dist.toFixed(0)} m from site anchor, radius ${radius.toFixed(1)} m).`);
}

export async function loadContextBuildings() {
  if (!CONFIG.SHOW_CONTEXT_BUILDINGS || !CONFIG.CONTEXT_TILESET_URL) return null;
  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(CONFIG.CONTEXT_TILESET_URL, {
      maximumScreenSpaceError: 24,
      skipLevelOfDetail: true,
    });
    try {
      tileset.style = new Cesium.Cesium3DTileStyle({
        show: `!defined(\${identificatie}) || \${identificatie} !== '${CONFIG.OWN_BAG_PAND_ID}'`,
        color: "color('#d8d2c4')",
      });
    } catch (e) {
      console.warn("3D BAG style not applied:", e.message);
    }
    try {
      const R = CONFIG.CONTEXT_RADIUS_M ?? 600;
      const center = Cesium.Cartesian3.fromDegrees(
        CONFIG.BUILDING_LONGITUDE, CONFIG.BUILDING_LATITUDE, 0);
      tileset.clippingPlanes = new Cesium.ClippingPlaneCollection({
        modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(center),
        planes: [
          new Cesium.ClippingPlane(new Cesium.Cartesian3(1, 0, 0), R),
          new Cesium.ClippingPlane(new Cesium.Cartesian3(-1, 0, 0), R),
          new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 1, 0), R),
          new Cesium.ClippingPlane(new Cesium.Cartesian3(0, -1, 0), R),
        ],
        unionClippingRegions: false,
      });
    } catch (e) {
      console.warn("3D BAG clipping not applied:", e.message);
    }
    viewer.scene.primitives.add(tileset);
    return tileset;
  } catch (e) {
    console.warn("3D BAG context buildings not loaded:", e.message);
    return null;
  }
}

export async function loadBuildingShell() {
  if (!CONFIG.BUILDING_ASSET_ID) {
    console.warn("BUILDING_ASSET_ID is null — IFC shell disabled (rooms-only mode).");
    return { tileset: null, error: "no_asset_id" };
  }
  try {
    const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(CONFIG.BUILDING_ASSET_ID);
    await tileset.readyPromise;
    tileset.maximumScreenSpaceError = 8;
    tileset.style = undefined;

    if (CONFIG.HIDE_IFC_LANDSCAPING) {
      applyIfcLandscapingFilter(tileset);
    }

    viewer.scene.primitives.add(tileset);

    const site = Cesium.Cartesian3.fromDegrees(
      CONFIG.BUILDING_LONGITUDE, CONFIG.BUILDING_LATITUDE, groundHeight);
    const dist = Cesium.Cartesian3.distance(tileset.boundingSphere.center, site);
    if (!isFinite(dist) || dist > 3000) {
      const origin = Cesium.Cartesian3.fromDegrees(
        CONFIG.BUILDING_LONGITUDE,
        CONFIG.BUILDING_LATITUDE,
        groundHeight + CONFIG.BUILDING_HEIGHT,
      );
      const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(CONFIG.BUILDING_HEADING_DEGREES), 0, 0);
      tileset.modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(origin, hpr);
      console.info("IFC shell manually anchored at Bram House site.");
    } else {
      console.info(`IFC shell loaded (ion asset ${CONFIG.BUILDING_ASSET_ID}, ${dist.toFixed(0)} m from anchor).`);
    }

    return { tileset, error: null };
  } catch (e) {
    console.error("Building shell not loaded:", e.message);
    return { tileset: null, error: e.message };
  }
}
