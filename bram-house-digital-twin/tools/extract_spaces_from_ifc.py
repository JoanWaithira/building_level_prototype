import json, math
import ifcopenshell, ifcopenshell.geom
from shapely.geometry import Polygon
from shapely.ops import unary_union

# --- CONFIG (mirrors the Dynamo script) ---
ORIGIN_LON, ORIGIN_LAT = 6.626996517, 52.380256653
ROTATION_DEGREES = 0.0
X_OFFSET_METERS = Y_OFFSET_METERS = HEIGHT_OFFSET_METERS = 0.0
STOREYS = [(0.0,"Level 0"),(3.0,"Level 1"),(6.0,"Level 2"),(9.0,"Roof")]
MLAT = 111320.0; MLON = 111320.0*math.cos(math.radians(ORIGIN_LAT))
R = math.radians(ROTATION_DEGREES); CR, SR = math.cos(R), math.sin(R)

def to_lonlat(x, y):
    x += X_OFFSET_METERS; y += Y_OFFSET_METERS
    xr, yr = x*CR - y*SR, x*SR + y*CR
    return [round(ORIGIN_LON + xr/MLON, 9), round(ORIGIN_LAT + yr/MLAT, 9)]

def floor_name(z):
    return min(STOREYS, key=lambda s: abs(s[0]-z))[1]

f = ifcopenshell.open("/tmp/spaces_slice.ifc")
settings = ifcopenshell.geom.settings()
settings.set("use-world-coords", True)

features, skipped = [], []
for sp in f.by_type("IfcSpace"):
    try:
        shape = ifcopenshell.geom.create_shape(settings, sp)
        v = shape.geometry.verts; fc = shape.geometry.faces
        pts = [(v[i], v[i+1], v[i+2]) for i in range(0, len(v), 3)]
        zmin = min(p[2] for p in pts); zmax = max(p[2] for p in pts)
        tris = []
        for i in range(0, len(fc), 3):
            a,b,c = pts[fc[i]], pts[fc[i+1]], pts[fc[i+2]]
            t = Polygon([(a[0],a[1]),(b[0],b[1]),(c[0],c[1])])
            if t.is_valid and t.area > 1e-6: tris.append(t)
        fp = unary_union(tris)
        if fp.geom_type == "MultiPolygon":
            fp = max(fp.geoms, key=lambda g: g.area)
        fp = fp.simplify(0.01)
        if fp.is_empty or fp.area < 0.05:
            skipped.append(sp.LongName or sp.Name); continue
        rings = [[to_lonlat(x,y) for x,y in fp.exterior.coords]]
        for hole in fp.interiors:
            rings.append([to_lonlat(x,y) for x,y in hole.coords])
        number = sp.Name or str(sp.id())
        floor = floor_name(zmin)
        rid = f"{floor}_{number}".upper().replace(" ","_")
        features.append({"type":"Feature","properties":{
            "room_id": rid, "room_name": sp.LongName or f"Room {number}",
            "room_number": number, "floor": floor,
            "base_height": round(zmin + HEIGHT_OFFSET_METERS, 3),
            "extruded_height": round(zmax + HEIGHT_OFFSET_METERS, 3),
            "revit_id": sp.id(), "ifc_guid": sp.GlobalId,
        },"geometry":{"type":"Polygon","coordinates":rings}})
    except Exception as e:
        skipped.append(f"{sp.LongName or sp.Name}: {e}")

fc_out = {"type":"FeatureCollection","name":"bram_house_rooms","features":features}
out = "/sessions/funny-keen-faraday/mnt/MVP_Building_Twin/bram-house-digital-twin/public/data/bram_house_rooms.geojson"
with open(out, "w") as fo: json.dump(fc_out, fo, indent=2)
print(f"Exported {len(features)} rooms, skipped {len(skipped)}: {skipped}")
for ft in features:
    p = ft["properties"]
    print(f'  {p["floor"]:8} #{p["room_number"]:>3} {p["room_name"]:<14} {p["base_height"]}–{p["extruded_height"]} m')
