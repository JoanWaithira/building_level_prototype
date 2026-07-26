# Bram House — Building-Level Digital Twin MVP (Cesium)

Get a 474 MB IFC displayed on Cesium, geolocated, with clickable BIM properties and a simulated sensor overlay — in ~3 steps.

Your IFC is already georeferenced: the `IfcSite` contains **lat 52.3802567, lon 6.6269965** (WGS84). Cesium ion reads this automatically and places the tiled model there.

## Step 1 — Upload the IFC to Cesium ion (~15–30 min tiling)

1. Go to https://ion.cesium.com → **My Assets** → **Add data**.
2. Select `Bram House (Without Site Floor).ifc` (474 MB — fine for ion).
3. When asked what kind of data: choose **BIM/CAD (Architecture, engineering...)** → tiles it as **3D Tiles**.
4. Wait for tiling to finish, then open the asset preview:
   - It should sit near **Vroomshoop / Twente, NL** automatically (from IfcSite).
   - If not: click **Adjust Tileset Location** in the asset page and enter lon `6.6269965`, lat `52.3802567`, then save.
5. Note the **Asset ID** (number shown on the asset page).

## Step 2 — Wire the asset into the viewer

Open `building-twin-viewer.html` in a text editor and set one line in `CONFIG`:

```js
assetId: 2712345,   // ← your Asset ID from step 1
```

Optional knobs in the same block:
- `heightOffset` — raise/lower the model if it floats or sinks into terrain.
- `forceLocation: true` — only if ion placed it in the wrong spot and you didn't fix it in the ion UI.

## Step 3 — Open it

Double-click `building-twin-viewer.html` (works from disk, no server needed). You get:

- **Model on the globe** — on Cesium World Terrain at its real coordinates.
- **Click any element** — wall/window/slab → IFC attributes & property sets in the left panel (ion's Design Tiler preserves IFC metadata).
- **Sensor overlay (right panel)** — simulated temperature / CO₂ / energy per storey (Level 0/1/2 + Roof, from the IFC storey elevations), updating every 3 s. Click a sensor point on the building to inspect a zone. Replace the `setInterval` mock with a `fetch()` to a real API when you have live data.

## Notes

- **Revit file**: not needed for the MVP — the IFC came from Revit 2023 anyway. Later you can install the *Cesium ion for Revit* add-in to push updates directly from Revit.
- **Token**: your ion token is embedded in the HTML. Fine for local use; for a public deployment create a scoped token in ion (Access Tokens page).
- **Alignment with 3DxVERSE D7.2**: this uses OGC 3D Tiles served over the web, matching the deliverable's standards-based architecture (OGC 3D Tiles / OGC API). The mock sensor layer is the placeholder for the real IoT/energy data integration.
- **Next steps**: real sensor feed (MQTT/REST → replace mock), CityGML/3D BAG context buildings, storey filtering, and a shared deployment (any static host works — GitHub Pages, university server).
