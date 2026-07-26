// IAQ alert rules — evaluate readings against configurable thresholds.
import {
  worstStatus,
  statusColor,
  iaqLabel,
  IAQ_THRESHOLDS,
} from "../data/sensorDataService.js";
import { roomEntities } from "../viewer/geojsonRooms.js";

const STORAGE_KEY = "twinlink_iaq_rules";

export const DEFAULT_RULES = [
  {
    id: "co2_elevated",
    enabled: true,
    metric: "co2",
    op: ">",
    value: IAQ_THRESHOLDS.co2.good,
    severity: "warn",
    label: "CO₂ elevated — consider ventilation",
  },
  {
    id: "co2_critical",
    enabled: true,
    metric: "co2",
    op: ">",
    value: IAQ_THRESHOLDS.co2.warn,
    severity: "bad",
    label: "CO₂ too high — ventilate now",
  },
  {
    id: "temp_low",
    enabled: true,
    metric: "temperature",
    op: "<",
    value: IAQ_THRESHOLDS.temperature.low,
    severity: "warn",
    label: "Room too cold",
  },
  {
    id: "temp_high",
    enabled: true,
    metric: "temperature",
    op: ">",
    value: IAQ_THRESHOLDS.temperature.high,
    severity: "warn",
    label: "Room too warm",
  },
  {
    id: "humidity_low",
    enabled: true,
    metric: "humidity",
    op: "<",
    value: IAQ_THRESHOLDS.humidity.low,
    severity: "warn",
    label: "Air too dry",
  },
  {
    id: "humidity_high",
    enabled: true,
    metric: "humidity",
    op: ">",
    value: IAQ_THRESHOLDS.humidity.high,
    severity: "warn",
    label: "Air too humid",
  },
];

let rules = loadRules();

function loadRules() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RULES.map((r) => ({ ...r }));
    const saved = JSON.parse(raw);
    return DEFAULT_RULES.map((def) => {
      const hit = saved.find((s) => s.id === def.id);
      return hit ? { ...def, enabled: !!hit.enabled } : { ...def };
    });
  } catch {
    return DEFAULT_RULES.map((r) => ({ ...r }));
  }
}

function saveRules() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules.map((r) => ({ id: r.id, enabled: r.enabled }))));
  } catch { /* private mode */ }
}

export function getRules() {
  return rules;
}

export function setRuleEnabled(id, enabled) {
  const r = rules.find((x) => x.id === id);
  if (r) {
    r.enabled = enabled;
    saveRules();
  }
}

function testRule(rule, reading) {
  if (!rule.enabled || !reading) return false;
  const v = reading[rule.metric];
  if (!Number.isFinite(v)) return false;
  if (rule.op === ">") return v > rule.value;
  if (rule.op === "<") return v < rule.value;
  if (rule.op === ">=") return v >= rule.value;
  if (rule.op === "<=") return v <= rule.value;
  return false;
}

export function evaluateReading(reading, roomName = "") {
  const alerts = [];
  for (const rule of rules) {
    if (!testRule(rule, reading)) continue;
    alerts.push({
      ruleId: rule.id,
      severity: rule.severity,
      label: rule.label,
      metric: rule.metric,
      value: reading[rule.metric],
      room_id: reading.room_id,
      room_name: roomName,
      timestamp: reading.timestamp,
    });
  }
  return alerts;
}

export function evaluateAllReadings(readings) {
  const nameById = new Map(roomEntities.map((r) => [r.props.room_id, r.props.room_name]));
  const all = [];
  for (const reading of readings) {
    const name = nameById.get(reading.room_id) ?? reading.room_id;
    all.push(...evaluateReading(reading, name));
  }
  const rank = { bad: 2, warn: 1 };
  all.sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0));
  return all;
}

export function formatAlert(a) {
  const col = statusColor(a.severity);
  const unit = a.metric === "co2" ? " ppm" : a.metric === "temperature" ? "°C" : "%";
  return {
    html: `<span class="iaq-alert" style="--alert-color:${col}"><b>${a.room_name}</b> · ${a.label} <span class="muted">(${a.value}${unit})</span></span>`,
    severity: a.severity,
  };
}

export function readingStatusSummary(reading) {
  const st = worstStatus(reading);
  return { status: st, label: iaqLabel(st), color: statusColor(st) };
}
