// Building-level energy data from CSV files in public/energy/.
// IMPORTANT: Total_power and Total_gas are CUMULATIVE meter readings, so
// period totals are computed as (last valid − first valid), never as a sum.
import { CONFIG } from "../config.js";

// Tiny CSV parser — the meter exports are plain comma-separated, no quoting.
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((h, i) => {
      const raw = (cells[i] ?? "").trim();
      if (h === "time") {
        const d = new Date(raw.replace(" ", "T"));
        row.time = isNaN(d) ? null : d;
      } else {
        const n = parseFloat(raw);
        row[h] = raw === "" || isNaN(n) ? null : n;
      }
    });
    return row;
  }).filter((r) => r.time);
}

async function loadCSV(path) {
  try {
    const res = await fetch(encodeURI(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCSV(await res.text());
  } catch (e) {
    console.warn(`Energy CSV missing/unreadable (${path}):`, e.message);
    return []; // missing files never crash the app
  }
}

const firstValid = (rows, col) => rows.find((r) => r[col] != null);
const lastValid = (rows, col) => [...rows].reverse().find((r) => r[col] != null);
const delta = (rows, col) => {
  const a = firstValid(rows, col), b = lastValid(rows, col);
  return a && b ? b[col] - a[col] : null;
};
const latest = (rows, col) => lastValid(rows, col)?.[col] ?? null;

// Daily consumption from a cumulative meter: last reading per day minus
// last reading of the previous day. days=null -> full period.
function dailyDeltas(rows, cols, days = null) {
  const perDay = new Map(); // "YYYY-MM-DD" -> last cumulative total of that day
  for (const r of rows) {
    const total = cols.reduce((acc, c) => (r[c] == null ? acc : (acc ?? 0) + r[c]), null);
    if (total == null) continue;
    perDay.set(r.time.toISOString().slice(0, 10), total);
  }
  const entries = [...perDay.entries()].sort();
  const out = [];
  for (let i = 1; i < entries.length; i++) {
    const v = entries[i][1] - entries[i - 1][1];
    out.push({ date: entries[i][0], value: v >= 0 ? v : 0 }); // guard meter resets
  }
  return days ? out.slice(-days) : out;
}

// Daily maximum of an instantaneous column (e.g. "L1 max W").
function dailyMax(rows, col) {
  const perDay = new Map();
  for (const r of rows) {
    if (r[col] == null) continue;
    const d = r.time.toISOString().slice(0, 10);
    perDay.set(d, Math.max(perDay.get(d) ?? -Infinity, r[col]));
  }
  return [...perDay.entries()].sort().map(([date, value]) => ({ date, value }));
}

// Downsample an instantaneous column to one point every `stepH` hours.
function sampled(rows, col, stepH = 4) {
  const out = [];
  let nextT = 0;
  for (const r of rows) {
    if (r[col] == null) continue;
    const t = r.time.getTime();
    if (t >= nextT) {
      out.push({ date: r.time.toISOString().slice(0, 16).replace("T", " "), value: r[col] });
      nextT = t + stepH * 3600 * 1000;
    }
  }
  return out;
}

// Aggregate a daily series into monthly totals.
export function monthlyTotals(daily) {
  const perMonth = new Map();
  for (const d of daily) {
    const m = d.date.slice(0, 7);
    perMonth.set(m, (perMonth.get(m) ?? 0) + d.value);
  }
  return [...perMonth.entries()].sort().map(([date, value]) => ({ date, value }));
}

// Keep the last N points; null/undefined days → full series.
export function filterByHorizon(series, days) {
  if (!series?.length || days == null) return series ?? [];
  return series.slice(-days);
}

export function sumSeries(series) {
  return series.reduce((acc, d) => acc + d.value, 0);
}

export function netDaily(importDaily, exportDaily) {
  const expMap = new Map((exportDaily ?? []).map((d) => [d.date, d.value]));
  return (importDaily ?? []).map((d) => ({
    date: d.date,
    value: Math.round((d.value - (expMap.get(d.date) ?? 0)) * 100) / 100,
  }));
}

export function rollingAverage(daily, window = 7) {
  if (!daily?.length) return [];
  return daily.map((d, i) => {
    const slice = daily.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((s, x) => s + x.value, 0) / slice.length;
    return { date: d.date, value: Math.round(avg * 100) / 100 };
  });
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dayOfWeekAverages(daily) {
  const buckets = Array(7).fill(null).map(() => ({ sum: 0, count: 0 }));
  for (const d of daily ?? []) {
    const dow = (new Date(`${d.date}T12:00:00`).getDay() + 6) % 7; // Mon=0 … Sun=6
    buckets[dow].sum += d.value;
    buckets[dow].count++;
  }
  return WEEKDAYS.map((label, i) => ({
    date: label,
    value: buckets[i].count ? Math.round((buckets[i].sum / buckets[i].count) * 100) / 100 : 0,
  }));
}

export function cumulativeSeries(daily) {
  let acc = 0;
  return (daily ?? []).map((d) => {
    acc += d.value;
    return { date: d.date, value: Math.round(acc * 100) / 100 };
  });
}

export function selfSufficiencyPct(importDaily, exportDaily) {
  return (importDaily ?? []).map((d) => {
    const exp = (exportDaily ?? []).find((x) => x.date === d.date)?.value ?? 0;
    const pct = d.value > 0 ? Math.min(100, (exp / d.value) * 100) : 0;
    return { date: d.date, value: Math.round(pct * 10) / 10 };
  });
}

export function netSellerDaySplit(netDailySeries) {
  let buyer = 0, seller = 0, balanced = 0;
  for (const d of netDailySeries ?? []) {
    if (d.value > 0.5) buyer++;
    else if (d.value < -0.5) seller++;
    else balanced++;
  }
  return { buyer, seller, balanced };
}

function dailyMinMax(rows, col) {
  const perDay = new Map();
  for (const r of rows) {
    if (r[col] == null) continue;
    const d = r.time.toISOString().slice(0, 10);
    const cur = perDay.get(d);
    if (!cur) perDay.set(d, { min: r[col], max: r[col] });
    else {
      cur.min = Math.min(cur.min, r[col]);
      cur.max = Math.max(cur.max, r[col]);
    }
  }
  return [...perDay.entries()].sort().map(([date, { min, max }]) => ({
    date,
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
    swing: Math.round((max - min) * 10) / 10,
  }));
}

export async function loadEnergySummary() {
  const P = CONFIG.ENERGY_FILE_PATHS;
  const [battery, power, gas, water] = await Promise.all([
    loadCSV(P.battery), loadCSV(P.total_power), loadCSV(P.total_gas), loadCSV(P.water),
  ]);

  const times = [...battery, ...power, ...gas]
    .map((r) => r.time).filter(Boolean).sort((a, b) => a - b);

  const importT1 = delta(power, "Import T1 kWh");
  const importT2 = delta(power, "Import T2 kWh");
  const exportT1 = delta(power, "Export T1 kWh");
  const exportT2 = delta(power, "Export T2 kWh");
  const sum = (a, b) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

  return {
    scope: "building_total", // room-level metering not connected yet
    latestTimestamp: times.at(-1) ?? null,
    periodStart: times[0] ?? null,
    totalImportedKWh: sum(importT1, importT2),
    totalExportedKWh: sum(exportT1, exportT2),
    latestL1MaxW: latest(power, "L1 max W"),
    latestL2MaxW: latest(power, "L2 max W"),
    latestL3MaxW: latest(power, "L3 max W"),
    latestBatterySoC: latest(battery, "State of charge %"),
    latestGasReading: latest(gas, "Total gas used"),
    gasUsedPeriod: delta(gas, "Total gas used"),
    latestWaterReadingDl: latest(water, "water usage dl"),
    dailyImportKWh: dailyDeltas(power, ["Import T1 kWh", "Import T2 kWh"], 30),
    dailyGasM3: dailyDeltas(gas, ["Total gas used"], 30),
    // Full-period series for the charts dashboard:
    series: {
      importDaily: dailyDeltas(power, ["Import T1 kWh", "Import T2 kWh"]),
      exportDaily: dailyDeltas(power, ["Export T1 kWh", "Export T2 kWh"]),
      importT1Daily: dailyDeltas(power, ["Import T1 kWh"]),
      importT2Daily: dailyDeltas(power, ["Import T2 kWh"]),
      exportT1Daily: dailyDeltas(power, ["Export T1 kWh"]),
      exportT2Daily: dailyDeltas(power, ["Export T2 kWh"]),
      gasDaily: dailyDeltas(gas, ["Total gas used"]),
      waterDailyL: dailyDeltas(water, ["water usage dl"]).map((d) => ({ date: d.date, value: d.value / 10 })),
      l1Daily: dailyMax(power, "L1 max W"),
      l2Daily: dailyMax(power, "L2 max W"),
      l3Daily: dailyMax(power, "L3 max W"),
      batterySoC: sampled(battery, "State of charge %", 4),
      batteryImportDaily: dailyDeltas(battery, ["Import kWh"]),
      batteryExportDaily: dailyDeltas(battery, ["Export kWh"]),
      batterySoCRange: dailyMinMax(battery, "State of charge %"),
    },
  };
}

export function formatValue(v, unit = "", digits = 1) {
  if (v == null) return "—";
  return `${Number(v).toLocaleString("en-US", { maximumFractionDigits: digits })}${unit ? " " + unit : ""}`;
}
