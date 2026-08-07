/**
 * Load precomputed LSTM forecasts from public/forecasts CSVs.
 * Training happens offline via: public/forecasts/lstm_forecast.ipynb
 */
import { CONFIG } from "../config.js";

function parseForecastCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return { history: [], forecast: [] };
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iDate = headers.indexOf("date");
  const iSeries = headers.indexOf("series");
  const iValue = headers.indexOf("value") >= 0 ? headers.indexOf("value") : headers.indexOf("kwh");
  if (iDate < 0 || iSeries < 0 || iValue < 0) {
    throw new Error("Forecast CSV must have columns: date,series,value");
  }

  const history = [];
  const forecast = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const date = (cells[iDate] ?? "").trim();
    const series = (cells[iSeries] ?? "").trim().toLowerCase();
    const value = parseFloat((cells[iValue] ?? "").trim());
    if (!date || !Number.isFinite(value)) continue;
    const point = { date, value };
    if (series === "forecast") forecast.push(point);
    else history.push(point);
  }
  return { history, forecast };
}

/**
 * @param {"power"|"gas"|"water"|"battery"} target
 * @returns {Promise<{ok:boolean,error?:string,history?:any[],forecast?:any[],forecastTotal?:number,forecastDays?:number,lookback?:number,split?:object,metrics?:object,generatedAt?:string,unit?:string,label?:string,source?:string}>}
 */
export async function loadSavedForecast(target) {
  const paths = CONFIG.FORECAST_FILE_PATHS[target];
  if (!paths) return { ok: false, error: `Unknown forecast target: ${target}` };

  try {
    const [csvRes, metaRes] = await Promise.all([
      fetch(encodeURI(paths.csv)),
      fetch(encodeURI(paths.meta)),
    ]);
    if (!csvRes.ok) {
      return {
        ok: false,
        error: `Forecast CSV missing (${paths.csv}). Run public/forecasts/lstm_forecast.ipynb.`,
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
      target,
      unit: meta.unit ?? "",
      label: meta.label ?? target,
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
