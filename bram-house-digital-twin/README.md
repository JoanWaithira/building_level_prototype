# Bram House — Building-Level Digital Twin (MVP)

Revit Rooms → Dynamo → GeoJSON → CesiumJS extruded rooms → building-level energy dashboard → (later) indoor sensors by `room_id`.

**Architecture rule:** static spatial geometry (GeoJSON) is strictly separated from dynamic data. The GeoJSON contains only `room_id, room_name, room_number, floor, base_height, extruded_height, revit_id, geometry` — never temperature/humidity/CO₂/energy. Dynamic data joins later via `room_id`.

## 1. Run

```bash
cd bram-house-digital-twin
npm install
npm run dev
```

Open the printed URL (usually http://localhost:5173). You should see Cesium at Bram House, extruded sample rooms (Level 0 blue, Level 1 green), floor filter + reset camera at the bottom, energy dashboard on the right, and a room panel when you click a room.

## 2. File locations

- Energy CSVs → `public/energy/` (already copied: battery, Total_power, Total_gas, Skt ×2, water)
- Real room GeoJSON (from Dynamo) → `public/data/bram_house_rooms.geojson`
- Future mappings → `public/data/room_sensor_mapping.json`, `public/data/room_energy_mapping.json`

## 3. Switch sample → real GeoJSON

In `src/config.js`:

```js
USE_SAMPLE_GEOJSON: false,
ROOMS_GEOJSON_PATH: "/data/bram_house_rooms.geojson",
```

## 4. Cesium configuration (`src/config.js`)

- `CESIUM_ION_TOKEN` — your ion token. If satellite/terrain don't appear, the token lacks access to Cesium's assets: on ion.cesium.com → Access Tokens, use the Default token or enable `assets:read` + "All assets". The app still works on OSM + flat ground without it.
- `BUILDING_ASSET_ID` — the tiled IFC shell (currently 5041854). Set `null` for rooms-only.

## 5. Correcting placement

| Symptom | Fix |
|---|---|
| Whole scene in wrong place | `BUILDING_LONGITUDE/LATITUDE` in config.js AND `ORIGIN_LON/LAT` in the Dynamo script |
| Rooms shifted a few metres | `X_OFFSET_METERS` / `Y_OFFSET_METERS` in the Dynamo script, re-export |
| Rooms rotated | `ROTATION_DEGREES` in the Dynamo script (try 90/180/270, refine by 5°) |
| 3D shell rotated | `BUILDING_HEADING_DEGREES` in config.js |
| Floats / sinks | `BUILDING_HEIGHT` (shell) or `HEIGHT_OFFSET_METERS` (Dynamo, rooms) |

## 6. Extract rooms from Revit with Dynamo

1. Open the Bram House model in Revit → **Manage → Dynamo** → New graph.
2. Add nodes: **Categories** (select *Rooms*) → **All Elements of Category**.
3. Add a **Python Script** node; paste the contents of `dynamo/export_rooms_to_geojson.py`; wire *All Elements of Category* → `IN[0]`.
4. Edit the CONFIG block at the top of the script (`OUTPUT_PATH` = where the .geojson lands; anchor/rotation as needed).
5. **Run.** The script writes the file itself and returns a report ("Exported N rooms…"). Optionally wire `OUT[0]` → **File.WriteText** (with a **File Path** node) instead of using `OUTPUT_PATH`.
6. Copy the result to `public/data/bram_house_rooms.geojson` and set `USE_SAMPLE_GEOJSON: false`.

## 7. Test the exported GeoJSON

**In QGIS:** Layer → Add Layer → Add Vector Layer → pick the .geojson. Add the *OpenStreetMap* XYZ basemap underneath. The rooms must land on the Bram House parcel (Kerkweg 18, Aadorp) and have the right shape/orientation vs. the `Floorplans/` DXF. If shifted/rotated → §5.

**In Cesium (this app):** switch config to the real file, reload, use the floor filter, click rooms and check names/numbers/floors match Revit.

## 8. Troubleshooting

- **`features` array is empty** — rooms aren't *placed* in Revit, or have zero area. Place rooms first (Architecture → Room).
- **Some rooms missing** — not enclosed; add Room Separator lines or close wall gaps. The script's report lists skipped rooms.
- **Wrong location / rotated / floating** — see §5.
- **CSV missing** — the app logs a warning and shows "—" for that metric; it never crashes. Filenames must match `ENERGY_FILE_PATHS` in config.js.
- **Black globe / no terrain** — token issue, see §4.
- **Note on energy math** — `Total_power` and `Total_gas` are *cumulative meter readings*; the dashboard computes period totals as last − first, and shows latest values for L1–L3 max, battery SoC, and the gas meter.

## 9. Later

1. Real GeoJSON from Dynamo (§6) → replace sample.
2. Indoor sensors: implement `GET /api/sensors/latest?room_id=...` returning `{ room_id, timestamp, temperature, humidity, co2 }`, fill `room_sensor_mapping.json`, and render the values in the room panel (placeholder is already there).
3. Room-level energy: fill `room_energy_mapping.json` when sub-metering exists.
4. Realistic shell: keep `BUILDING_ASSET_ID`, tune `BUILDING_HEADING_DEGREES`/`BUILDING_HEIGHT`.
