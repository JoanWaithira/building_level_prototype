// Historical IAQ time series — hourly samples per room (mock until live API).
import { IAQ_THRESHOLDS } from "./sensorDataService.js";

const HISTORY_HOURS = 168; // 7 days
let historyByRoom = new Map();
let roomNamesById = new Map();
let timeline = []; // ISO timestamps, aligned across rooms

function seeded(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  return () => (h = (h * 48271) % 2147483647) / 2147483647;
}

function inferRoomProfile(name = "") {
  const n = name.toLowerCase();
  if (/keuken|kitchen|kook/.test(n)) return "kitchen";
  if (/slaap|bed|sleep/.test(n)) return "bedroom";
  if (/bad|bath|douche|toilet|wc/.test(n)) return "wet";
  if (/woon|living|zit/.test(n)) return "living";
  if (/kantoor|office|werk|study/.test(n)) return "office";
  if (/berging|storage|garage|kelder/.test(n)) return "storage";
  return "default";
}

function profileBaselines(profile) {
  switch (profile) {
    case "kitchen": return { co2: 900, temp: 23, humidity: 52 };
    case "living": return { co2: 750, temp: 21.5, humidity: 45 };
    case "bedroom": return { co2: 950, temp: 20.5, humidity: 50 };
    case "wet": return { co2: 520, temp: 23, humidity: 58 };
    case "office": return { co2: 780, temp: 21, humidity: 42 };
    case "storage": return { co2: 450, temp: 19, humidity: 48 };
    default: return { co2: 580, temp: 21, humidity: 46 };
  }
}

function generateRoomHistory(roomId, roomName) {
  const rnd = seeded(`${roomId}:hist`);
  const profile = inferRoomProfile(roomName);
  const base = profileBaselines(profile);
  const now = Date.now();
  const series = [];

  for (let i = HISTORY_HOURS - 1; i >= 0; i--) {
    const t = new Date(now - i * 3_600_000);
    const hour = t.getHours();
    const dow = t.getDay();
    const weekend = dow === 0 || dow === 6;

    const occupied = hour >= 7 && hour <= 22 && !(weekend && hour < 10);
    const evening = hour >= 18 && hour <= 22;
    const morningCook = profile === "kitchen" && hour >= 7 && hour <= 9;

    let co2 = base.co2;
    if (occupied) co2 += 120 + rnd() * 80;
    if (evening) co2 += profile === "living" ? 180 : 90;
    if (morningCook) co2 += 220;
    if (profile === "bedroom" && hour >= 22) co2 += 140;
    co2 += (rnd() - 0.5) * 120;

    let temp = base.temp + Math.sin((hour - 14) / 24 * Math.PI * 2) * 0.8;
    let humidity = base.humidity + (rnd() - 0.5) * 8;
    if (profile === "wet") humidity += 6;

    series.push({
      room_id: roomId,
      timestamp: t.toISOString(),
      temperature: Math.round(temp * 10) / 10,
      humidity: Math.round(Math.max(28, Math.min(72, humidity))),
      co2: Math.round(Math.max(380, co2)),
    });
  }
  return series;
}

export function buildIaqHistory(roomList) {
  historyByRoom.clear();
  roomNamesById.clear();
  timeline = [];

  const rooms = roomList ?? [];
  if (!rooms.length) return { hours: 0, rooms: 0 };

  for (const room of rooms) {
    const id = room.props?.room_id ?? room.room_id;
    const name = room.props?.room_name ?? room.room_name ?? "";
    if (!id) continue;
    const series = generateRoomHistory(id, name);
    historyByRoom.set(id, series);
    roomNamesById.set(id, name || String(id));
    if (!timeline.length) timeline = series.map((p) => p.timestamp);
  }

  return { hours: timeline.length, rooms: historyByRoom.size };
}

export function getTimeline() {
  return timeline;
}

export function getHistory(roomId, hoursBack = null) {
  const series = historyByRoom.get(roomId) ?? [];
  if (!hoursBack || hoursBack >= series.length) return [...series];
  return series.slice(-hoursBack);
}

export function getReadingAtIndex(index) {
  const i = Math.max(0, Math.min(timeline.length - 1, index));
  const ts = timeline[i];
  const readings = [];
  for (const [roomId, series] of historyByRoom) {
    const pt = series[i] ?? series.find((p) => p.timestamp === ts);
    if (pt) readings.push({ ...pt });
  }
  return { index: i, timestamp: ts, readings };
}

export function getReadingAtTime(isoTimestamp) {
  const i = timeline.indexOf(isoTimestamp);
  if (i >= 0) return getReadingAtIndex(i);
  return getReadingAtIndex(timeline.length - 1);
}

export function getRoomHistoryStats(roomId) {
  const series = historyByRoom.get(roomId) ?? [];
  if (!series.length) return null;
  const co2 = series.map((p) => p.co2);
  const temp = series.map((p) => p.temperature);
  return {
    co2: { min: Math.min(...co2), max: Math.max(...co2), avg: Math.round(co2.reduce((a, b) => a + b, 0) / co2.length) },
    temperature: { min: Math.min(...temp), max: Math.max(...temp), avg: Math.round(temp.reduce((a, b) => a + b, 0) / temp.length * 10) / 10 },
    warnHours: series.filter((p) => p.co2 > IAQ_THRESHOLDS.co2.good).length,
    badHours: series.filter((p) => p.co2 > IAQ_THRESHOLDS.co2.warn).length,
  };
}

/** Building-wide IAQ exposure hours from the 7-day mock history. */
export function getBuildingExposureSummary() {
  const rooms = [];
  let elevatedHours = 0;
  let criticalHours = 0;

  for (const roomId of historyByRoom.keys()) {
    const stats = getRoomHistoryStats(roomId);
    if (!stats) continue;
    elevatedHours += stats.warnHours;
    criticalHours += stats.badHours;
    rooms.push({
      roomId,
      name: roomNamesById.get(roomId) ?? String(roomId),
      elevatedHours: stats.warnHours,
      criticalHours: stats.badHours,
      avgCo2: stats.co2.avg,
    });
  }

  rooms.sort(
    (a, b) =>
      b.criticalHours - a.criticalHours ||
      b.elevatedHours - a.elevatedHours ||
      b.avgCo2 - a.avgCo2,
  );

  return {
    hours: timeline.length,
    roomCount: rooms.length,
    elevatedHours,
    criticalHours,
    worstRooms: rooms.slice(0, 8),
    rooms,
  };
}

export function hasHistory() {
  return timeline.length > 0;
}
