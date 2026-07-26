/**
 * Offline LSTM training → writes forecast CSV + metrics JSON.
 * Usage: npm run forecast:gen
 *
 * Does NOT run in the browser. The analytics Forecast tab only loads the CSV.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { forecastImportLstm } from "../src/simulation/energyForecastLstm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const POWER_CSV = join(ROOT, "public/energy/Total_power.csv");
const OUT_CSV = join(ROOT, "public/energy/lstm_import_forecast.csv");
const OUT_META = join(ROOT, "public/energy/lstm_import_forecast_meta.json");

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines
    .slice(1)
    .map((line) => {
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
    })
    .filter((r) => r.time);
}

function dailyImport(rows) {
  const cols = ["Import T1 kWh", "Import T2 kWh"];
  const perDay = new Map();
  for (const r of rows) {
    const total = cols.reduce((acc, c) => (r[c] == null ? acc : (acc ?? 0) + r[c]), null);
    if (total == null) continue;
    perDay.set(r.time.toISOString().slice(0, 10), total);
  }
  const entries = [...perDay.entries()].sort();
  const out = [];
  for (let i = 1; i < entries.length; i++) {
    const v = entries[i][1] - entries[i - 1][1];
    out.push({ date: entries[i][0], value: v >= 0 ? v : 0 });
  }
  return out;
}

const powerText = readFileSync(POWER_CSV, "utf8");
const series = dailyImport(parseCSV(powerText));
console.log(`Daily import points: ${series.length}`);

const result = await forecastImportLstm(series, {
  onProgress: ({ epoch, epochs, loss }) => {
    if (epoch === 1 || epoch === epochs || epoch % 7 === 0) {
      const lossTxt = loss != null ? ` loss=${Number(loss).toFixed(5)}` : "";
      console.log(`  epoch ${epoch}/${epochs}${lossTxt}`);
    }
  },
});

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

const csvLines = ["date,series,kwh"];
for (const d of result.history) {
  csvLines.push(`${d.date},history,${Number(d.value.toFixed(3))}`);
}
for (const d of result.forecast) {
  csvLines.push(`${d.date},forecast,${Number(d.value.toFixed(3))}`);
}
writeFileSync(OUT_CSV, csvLines.join("\n") + "\n", "utf8");

const meta = {
  generatedAt: new Date().toISOString(),
  target: "daily_grid_import_kwh",
  model: "lstm",
  lookback: result.lookback,
  forecastDays: result.forecastDays,
  split: result.split,
  metrics: result.metrics,
  forecastTotal: result.forecastTotal,
  note: "Chronological 80/10/10 split. Regenerated with npm run forecast:gen",
};
writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + "\n", "utf8");

console.log(`Wrote ${OUT_CSV}`);
console.log(`Wrote ${OUT_META}`);
console.log(
  `Forecast ${result.forecastDays}d total: ${result.forecastTotal.toFixed(1)} kWh · test MAE ${result.metrics.testMae?.toFixed(3)}`,
);
