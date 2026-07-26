// Room-level indoor air quality — mock readings keyed by room_id.
// Replace loadSensorReadings() with a real API when sensors are live.
import { mockReading } from "../../shared/iaqMock.js";

let readingsByRoom = new Map();
let loaded = false;

export { mockReading };

export const IAQ_THRESHOLDS = {
  co2: { good: 800, warn: 1000 },
  temperature: { low: 18, high: 26 },
  humidity: { low: 30, high: 65 },
};

export function evaluateMetric(metric, value) {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (metric === "co2") {
    if (value <= IAQ_THRESHOLDS.co2.good) return "good";
    if (value <= IAQ_THRESHOLDS.co2.warn) return "warn";
    return "bad";
  }
  if (metric === "temperature") {
    if (value < IAQ_THRESHOLDS.temperature.low || value > IAQ_THRESHOLDS.temperature.high)
      return "warn";
    return "good";
  }
  if (metric === "humidity") {
    if (value < IAQ_THRESHOLDS.humidity.low || value > IAQ_THRESHOLDS.humidity.high)
      return "warn";
    return "good";
  }
  return "unknown";
}

export function worstStatus(reading) {
  if (!reading) return "unknown";
  const ranks = { good: 0, warn: 1, bad: 2, unknown: -1 };
  return ["co2", "temperature", "humidity"].reduce((worst, m) => {
    const s = evaluateMetric(m, reading[m]);
    return ranks[s] > ranks[worst] ? s : worst;
  }, "good");
}

export function statusColor(status) {
  if (status === "good") return "#34d399";
  if (status === "warn") return "#fbbf24";
  if (status === "bad") return "#f87171";
  return "#64748b";
}

export function co2ToCss(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "#64748b";
  if (v <= 600) return "#34d399";
  if (v <= 800) return "#6ee7b7";
  if (v <= 1000) return "#fbbf24";
  if (v <= 1200) return "#fb923c";
  return "#f87171";
}

export function co2ToCesiumColor(value, alpha = 0.55) {
  return Cesium.Color.fromCssColorString(co2ToCss(value)).withAlpha(alpha);
}

export async function loadSensorReadings(roomList) {
  readingsByRoom.clear();
  for (const room of roomList ?? []) {
    const id = room.room_id ?? room.props?.room_id;
    const name = room.room_name ?? room.props?.room_name ?? "";
    if (!id) continue;
    readingsByRoom.set(id, mockReading(id, name));
  }
  loaded = true;
  return readingsByRoom;
}

export function getReading(roomId) {
  return readingsByRoom.get(roomId) ?? null;
}

export function getAllReadings() {
  return [...readingsByRoom.values()];
}

/** Replace live readings (used by IAQ replay scrubber). */
export function applyReadings(readings) {
  for (const r of readings ?? []) {
    if (r?.room_id) readingsByRoom.set(r.room_id, { ...r });
  }
}

/** Restore latest mock snapshot for all rooms in the list. */
export function resetToLiveReadings(roomList) {
  for (const room of roomList ?? []) {
    const id = room.room_id ?? room.props?.room_id;
    const name = room.room_name ?? room.props?.room_name ?? "";
    if (id) readingsByRoom.set(id, mockReading(id, name));
  }
}

export function isSensorDataLoaded() {
  return loaded;
}

export function formatIAQ(reading) {
  if (!reading) return "No sensor data";
  return `${reading.temperature}°C · ${reading.humidity}% · ${reading.co2} ppm CO₂`;
}

export function iaqLabel(status) {
  if (status === "good") return "Fresh air";
  if (status === "warn") return "Needs ventilation";
  if (status === "bad") return "Poor air quality";
  return "Unknown";
}
