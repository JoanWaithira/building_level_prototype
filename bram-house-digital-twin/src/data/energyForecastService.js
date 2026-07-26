/**
 * Load precomputed LSTM import forecast from public/energy CSVs.
 * Training happens offline via: npm run forecast:gen
 */
import { CONFIG } from "../config.js";

function parseForecastCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return { history: [], forecast: [] };
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iDate = headers.indexOf("date");
  const iSeries = headers.indexOf("series");
  const iKwh = headers.indexOf("kwh");
  if (iDate < 0 || iSeries < 0 || iKwh < 0) {
    throw new Error("Forecast CSV must have columns: date,series,kwh");
  }

  const history = [];
  const forecast = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const date = (cells[iDate] ?? "").trim();
    const series = (cells[iSeries] ?? "").trim().toLowerCase();
    const kwh = parseFloat((cells[iKwh] ?? "").trim());
    if (!date || !Number.isFinite(kwh)) continue;
    const point = { date, value: kwh };
    if (series === "forecast") forecast.push(point);
    else history.push(point);
  }
  return { history, forecast };
}

/**
 * @returns {Promise<{ok:boolean,error?:string,history?:any[],forecast?:any[],forecastTotal?:number,forecastDays?:number,lookback?:number,split?:object,metrics?:object,generatedAt?:string,source?:string}>}
 */
export async function loadSavedImportForecast() {
  const csvPath = CONFIG.ENERGY_FILE_PATHS.lstm_forecast;
  const metaPath = CONFIG.ENERGY_FILE_PATHS.lstm_forecast_meta;

  try {
    const [csvRes, metaRes] = await Promise.all([
      fetch(encodeURI(csvPath)),
      fetch(encodeURI(metaPath)),
    ]);
    if (!csvRes.ok) {
      return {
        ok: false,
        error: `Forecast CSV missing (${csvPath}). Run: npm run forecast:gen`,
      };
    }

    const { history, forecast } = parseForecastCsv(await csvRes.text());
    let meta = {};
    if (metaRes.ok) {
      try {
        meta = await metaRes.json();
      } catch {
        meta = {};
      }
    }

    if (!forecast.length) {
      return { ok: false, error: "Forecast CSV has no forecast rows." };
    }

    return {
      ok: true,
      history,
      forecast,
      forecastTotal: forecast.reduce((s, d) => s + d.value, 0),
      forecastDays: meta.forecastDays ?? forecast.length,
      lookback: meta.lookback ?? 14,
      split: meta.split ?? {
        trainPct: 80,
        valPct: 10,
        testPct: 10,
        nTrain: "—",
        nVal: "—",
        nTest: "—",
      },
      metrics: meta.metrics ?? {},
      generatedAt: meta.generatedAt ?? null,
      source: "csv",
    };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}
