# =============================================================================
# Bram House — Revit Rooms -> GeoJSON exporter (Dynamo Python Script node)
# =============================================================================
# Graph:  Categories(Rooms) -> All Elements of Category -> Python Script (IN[0])
# The script writes the GeoJSON file itself (OUTPUT_PATH below) AND returns the
# GeoJSON text as OUT[0], so you can also wire OUT[0] -> File.WriteText if you
# prefer. OUT[1] is a human-readable report.
#
# Works in Dynamo 2.x, both IronPython2 and CPython3 engines.
#
# TROUBLESHOOTING
# - features array empty            -> rooms are not PLACED in Revit, or area=0.
#                                      Place rooms (Architecture > Room) first.
# - a room missing                  -> it is not enclosed; add Room Separator
#                                      lines or fix wall gaps.
# - output in the wrong place       -> adjust ORIGIN_LON / ORIGIN_LAT, then
#                                      fine-tune with X_OFFSET_METERS /
#                                      Y_OFFSET_METERS (≈1 m per step).
# - output rotated vs. reality      -> adjust ROTATION_DEGREES (try 90/180/270,
#                                      then refine by 5°). Revit project north
#                                      often differs from true north.
# - floats/sinks in Cesium          -> adjust HEIGHT_OFFSET_METERS here, or the
#                                      terrain/ground offset in the Cesium app.
# =============================================================================

import clr
import json
import math

clr.AddReference("RevitAPI")
from Autodesk.Revit.DB import (
    FilteredElementCollector, BuiltInCategory, BuiltInParameter,
    SpatialElementBoundaryOptions,
)

clr.AddReference("RevitServices")
from RevitServices.Persistence import DocumentManager

# ------------------------- CONFIG (edit these) -------------------------------
ORIGIN_LON = 6.626996517       # Bram House anchor (WGS84)
ORIGIN_LAT = 52.380256653
ROTATION_DEGREES = 0.0         # rotate local XY around origin (counter-clockwise)
X_OFFSET_METERS = 0.0          # shift east(+) / west(-)
Y_OFFSET_METERS = 0.0          # shift north(+) / south(-)
HEIGHT_OFFSET_METERS = 0.0     # add to all base heights
DEFAULT_ROOM_HEIGHT = 3.0      # metres, used when Revit room height is missing
OUTPUT_PATH = r"C:\Users\joanw\Desktop\bram_house_rooms.geojson"  # or None
# ------------------------------------------------------------------------------

FEET_TO_M = 0.3048
doc = DocumentManager.Instance.CurrentDBDocument

# Approximate local-metre -> degree conversion (fine for a single building)
METERS_PER_DEG_LAT = 111320.0
METERS_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))
ROT = math.radians(ROTATION_DEGREES)
COS_R, SIN_R = math.cos(ROT), math.sin(ROT)


def local_to_lonlat(x_m, y_m):
    """Revit local metres (project origin) -> [lon, lat]."""
    x = x_m + X_OFFSET_METERS
    y = y_m + Y_OFFSET_METERS
    # rotation correction around the origin
    xr = x * COS_R - y * SIN_R
    yr = x * SIN_R + y * COS_R
    lon = ORIGIN_LON + xr / METERS_PER_DEG_LON
    lat = ORIGIN_LAT + yr / METERS_PER_DEG_LAT
    return [round(lon, 9), round(lat, 9)]


def get_param(elem, built_in, default=""):
    try:
        p = elem.get_Parameter(built_in)
        if p is None:
            return default
        if p.StorageType.ToString() == "String":
            return p.AsString() or default
        return p.AsDouble()
    except Exception:
        return default


def sanitize(text):
    out = []
    for ch in str(text).strip().upper():
        out.append(ch if ch.isalnum() else "_")
    return "".join(out)


# --- collect rooms: from IN[0] if wired, else from the document -------------
rooms = []
try:
    if IN and len(IN) > 0 and IN[0]:
        src = IN[0] if isinstance(IN[0], list) else [IN[0]]
        rooms = [UnwrapElement(r) for r in src]
except Exception:
    rooms = []
if not rooms:
    rooms = list(
        FilteredElementCollector(doc)
        .OfCategory(BuiltInCategory.OST_Rooms)
        .WhereElementIsNotElementType()
        .ToElements()
    )

opts = SpatialElementBoundaryOptions()
features = []
skipped = []

for room in rooms:
    try:
        # 1-2: only placed rooms with positive area
        if room.Location is None or room.Area <= 0:
            skipped.append("unplaced/zero-area id=%s" % room.Id)
            continue

        # identity
        name = get_param(room, BuiltInParameter.ROOM_NAME, "Room")
        number = str(get_param(room, BuiltInParameter.ROOM_NUMBER, room.Id))
        level = room.Level
        floor_name = level.Name if level else "Unknown"
        room_id = "%s_%s" % (sanitize(floor_name), sanitize(number))

        # heights (metres)
        base_h = (level.Elevation * FEET_TO_M if level else 0.0) + HEIGHT_OFFSET_METERS
        h_param = get_param(room, BuiltInParameter.ROOM_HEIGHT, None)
        room_h = h_param * FEET_TO_M if isinstance(h_param, float) and h_param > 0 else DEFAULT_ROOM_HEIGHT
        extruded_h = base_h + room_h

        # 3: boundary -> rings (outer boundary first; holes kept if present)
        loops = room.GetBoundarySegments(opts)
        if not loops or len(loops) == 0:
            skipped.append("no boundary %s" % room_id)
            continue

        rings = []
        for loop in loops:
            ring = []
            for seg in loop:
                curve = seg.GetCurve()
                # tessellate handles arcs as well as lines
                for pt in curve.Tessellate():
                    ring.append(local_to_lonlat(pt.X * FEET_TO_M, pt.Y * FEET_TO_M))
            if len(ring) >= 3:
                # remove consecutive duplicates, close the ring
                dedup = [ring[0]]
                for p in ring[1:]:
                    if p != dedup[-1]:
                        dedup.append(p)
                if dedup[0] != dedup[-1]:
                    dedup.append(dedup[0])
                if len(dedup) >= 4:
                    rings.append(dedup)
        if not rings:
            skipped.append("invalid boundary %s" % room_id)
            continue

        features.append({
            "type": "Feature",
            "properties": {
                "room_id": room_id,
                "room_name": name,
                "room_number": number,
                "floor": floor_name,
                "base_height": round(base_h, 3),
                "extruded_height": round(extruded_h, 3),
                "revit_id": room.Id.IntegerValue if hasattr(room.Id, "IntegerValue") else int(str(room.Id)),
            },
            "geometry": {"type": "Polygon", "coordinates": rings},
        })
    except Exception as ex:
        # 11: never crash the whole export because of one bad room
        skipped.append("error %s: %s" % (getattr(room, "Id", "?"), ex))

geojson = {"type": "FeatureCollection", "name": "bram_house_rooms", "features": features}
text = json.dumps(geojson, indent=2)

report = "Exported %d room(s). Skipped %d: %s" % (
    len(features), len(skipped), "; ".join(str(s) for s in skipped[:10]) or "-")

if OUTPUT_PATH:
    try:
        with open(OUTPUT_PATH, "w") as f:
            f.write(text)
        report += " | written to " + OUTPUT_PATH
    except Exception as ex:
        report += " | FILE WRITE FAILED: %s (wire OUT[0] to File.WriteText instead)" % ex

OUT = text, report
