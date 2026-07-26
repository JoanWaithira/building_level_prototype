// Full-screen energy analytics workspace — Chart.js charts + retrofit scenarios.
import {
  monthlyTotals,
  filterByHorizon,
  sumSeries,
  netDaily,
  rollingAverage,
  dayOfWeekAverages,
  selfSufficiencyPct,
  netSellerDaySplit,
  formatValue,
} from "../data/energyDataService.js";
import {
  computeScenario,
  SCENARIO_ASSUMPTIONS,
  dailyCostSeries,
  compareDecisionPackages,
} from "../simulation/energyScenarios.js";
import { getBuildingExposureSummary } from "../data/iaqHistoryService.js";

const HORIZONS = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "180", label: "6 months", days: 180 },
  { id: "365", label: "1 year", days: 365 },
  { id: "all", label: "All data", days: null },
];

const TABS = ["overview", "electricity", "solar", "utilities", "scenarios", "decisions", "forecast"];

/** Twinlink chart palette */
const C = {
  import: "#5eb8ff",
  importFill: "rgba(94,184,255,0.18)",
  export: "#34d399",
  exportFill: "rgba(52,211,153,0.16)",
  peak: "#fbbf24",
  peakFill: "rgba(251,191,36,0.14)",
  gas: "#fb923c",
  water: "#38bdf8",
  battery: "#a78bfa",
  forecast: "#f472b6",
  forecastFill: "rgba(244,114,182,0.18)",
  neutral: "#64748b",
  grid: "rgba(255,255,255,0.05)",
  tick: "#8b97ad",
  text: "#cbd5e1",
};

let built = false;
let scenariosWired = false;
let decisionsWired = false;
let forecastWired = false;
let currentSummary = null;
let selectedHorizon = 30;
let activeTab = "overview";
const charts = new Map();
let lastSlice = {};
let lastForecast = null;
let forecastRunning = false;

export function openChartsDashboard(summary, tab = "overview") {
  currentSummary = summary;
  document.getElementById("chartsOverlay").style.display = "block";
  document.body.classList.add("charts-open");
  updatePeriodLabel(summary);
  if (!built) {
    applyChartDefaults();
    buildHorizonSelector();
    buildChartInstances();
    built = true;
  }
  if (!scenariosWired) {
    wireScenarios();
    scenariosWired = true;
  }
  if (!decisionsWired) {
    wireDecisions();
    decisionsWired = true;
  }
  if (!forecastWired) {
    wireForecast();
    forecastWired = true;
  }
  refreshCharts();
  if (TABS.includes(tab)) switchTab(tab);
}

export function initChartsDashboard() {
  document.getElementById("chartsClose").onclick = closeChartsDashboard;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("charts-open")) {
      closeChartsDashboard();
    }
  });
  document.querySelectorAll("#chartsTabs [data-tab]").forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

function closeChartsDashboard() {
  document.getElementById("chartsOverlay").style.display = "none";
  document.body.classList.remove("charts-open");
}

function updatePeriodLabel(summary) {
  const el = document.getElementById("chartsPeriod");
  if (!el || !summary) return;
  const from = summary.periodStart?.toLocaleDateString?.() ?? "—";
  const to = summary.latestTimestamp?.toLocaleDateString?.() ?? "—";
  el.textContent = `Meter data · ${from} → ${to}`;
}

function applyChartDefaults() {
  if (typeof Chart === "undefined") return;
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = C.tick;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = "circle";
}

function switchTab(tab) {
  if (!TABS.includes(tab)) return;
  activeTab = tab;
  document.querySelectorAll("#chartsTabs [data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.querySelectorAll("#chartsOverlay .chartSection").forEach((s) => {
    s.classList.toggle("active", s.dataset.section === tab);
  });
  if (currentSummary) {
    updateStatsForTab();
    if (tab === "scenarios") refreshScenario();
    if (tab === "decisions") refreshDecisions();
    if (tab === "forecast") showForecastState();
  }
  requestAnimationFrame(() => charts.forEach((c) => c.resize()));
}

function tooltipBase() {
  return {
    backgroundColor: "rgba(12,16,28,0.96)",
    titleColor: "#e2e8f0",
    bodyColor: C.text,
    borderColor: "rgba(94,184,255,0.2)",
    borderWidth: 1,
    titleFont: { size: 12, weight: "600" },
    bodyFont: { size: 12 },
    padding: 12,
    cornerRadius: 8,
  };
}

function simpleOptions(yTitle, extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 280 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        labels: {
          color: C.text,
          boxWidth: 8,
          boxHeight: 8,
          font: { size: 12 },
          padding: 16,
        },
      },
      tooltip: tooltipBase(),
    },
    scales: {
      x: {
        stacked: extra.stacked,
        ticks: { color: C.tick, maxTicksLimit: 10, font: { size: 11 } },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        stacked: extra.stacked,
        ticks: { color: C.tick, font: { size: 11 }, maxTicksLimit: 6 },
        grid: { color: C.grid },
        border: { display: false },
        title: {
          display: !!yTitle,
          text: yTitle,
          color: C.tick,
          font: { size: 11, weight: "500" },
        },
      },
    },
    ...extra,
  };
}

function doughnutOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 280 },
    cutout: "62%",
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: C.text, boxWidth: 8, font: { size: 12 }, padding: 14 },
      },
      tooltip: tooltipBase(),
    },
  };
}

function netChartOptions() {
  return simpleOptions("kWh per day", {
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipBase(),
        callbacks: {
          title: (items) => items[0]?.label ?? "",
          label: (ctx) => {
            const v = ctx.raw;
            if (v >= 0) return `Net import: ${v.toFixed(1)} kWh`;
            return `Net export: ${Math.abs(v).toFixed(1)} kWh`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: C.tick, maxTicksLimit: 10, font: { size: 11 } },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        ticks: { color: C.tick, font: { size: 11 }, maxTicksLimit: 6 },
        grid: {
          color: (ctx) => (ctx.tick.value === 0 ? "rgba(255,255,255,0.2)" : C.grid),
          lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
        },
        border: { display: false },
        title: { display: true, text: "kWh per day", color: C.tick, font: { size: 11 } },
      },
    },
  });
}

function barDataset(label, data, color) {
  return {
    label,
    data,
    backgroundColor: color,
    borderRadius: 4,
    borderSkipped: false,
    maxBarThickness: 28,
  };
}

function lineDataset(label, data, color, fill = true) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: fill ? color.replace(")", ",0.15)").replace("rgb", "rgba").replace("#", "") : "transparent",
    fill,
    pointRadius: 0,
    pointHoverRadius: 4,
    borderWidth: 2,
    tension: 0.28,
  };
}

// Fix line fill for hex colors
function lineDs(label, data, hex, fillHex) {
  return {
    label,
    data,
    borderColor: hex,
    backgroundColor: fillHex,
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 4,
    borderWidth: 2,
    tension: 0.28,
  };
}

function makeChart(id, config) {
  const el = document.getElementById(id);
  if (!el) return null;
  charts.get(id)?.destroy();
  const chart = new Chart(el.getContext("2d"), config);
  charts.set(id, chart);
  return chart;
}

const labels = (s) => s.map((d) => d.date);
const values = (s) => s.map((d) => Math.round(d.value * 100) / 100);

function buildHorizonSelector() {
  const bar = document.getElementById("chartsHorizon");
  bar.innerHTML =
    `<span class="horizon-label">Time range</span>` +
    HORIZONS.map(
      (h) =>
        `<button class="horizon-btn ${h.days === selectedHorizon ? "active" : ""}" data-horizon="${h.id}">${h.label}</button>`,
    ).join("");
  bar.querySelectorAll("[data-horizon]").forEach((btn) => {
    btn.onclick = () => {
      selectedHorizon = HORIZONS.find((x) => x.id === btn.dataset.horizon).days;
      bar.querySelectorAll("[data-horizon]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      refreshCharts();
    };
  });
}

function slice(S, key) {
  return filterByHorizon(S[key] ?? [], selectedHorizon);
}

function dailyPeak(l1, l2, l3) {
  return l1.map((d, i) => ({
    date: d.date,
    value: Math.max(d.value, l2[i]?.value ?? 0, l3[i]?.value ?? 0),
  }));
}

function useMonthlyGranularity() {
  return (selectedHorizon ?? 999) > 90;
}

function updateStatsForTab() {
  const el = document.getElementById("chartsStats");
  if (!el) return;
  const { imp, exp, gas, water, battery, net, daySplit, batIn } = lastSlice;
  const netTotal = sumSeries(imp) - sumSeries(exp);
  const days = imp.length || 1;
  const avgSuff = imp.length
    ? Math.round(selfSufficiencyPct(imp, exp).reduce((s, d) => s + d.value, 0) / imp.length)
    : null;
  const latestSoc = battery.at(-1)?.value ?? null;
  const totalDays = (daySplit?.buyer ?? 0) + (daySplit?.seller ?? 0) + (daySplit?.balanced ?? 0);

  const scenario = computeScenario(currentSummary?.series, readScenarioInputs());

  const byTab = {
    overview: [
      ["Grid import", formatValue(sumSeries(imp), "kWh", 0)],
      ["Grid export", formatValue(sumSeries(exp), "kWh", 0)],
      ["Net balance", formatValue(netTotal, "kWh", 0), netTotal <= 0 ? "ok" : ""],
      ["Daily avg import", formatValue(sumSeries(imp) / days, "kWh", 1)],
    ],
    electricity: [
      ["Total import", formatValue(sumSeries(imp), "kWh", 0)],
      ["Total export", formatValue(sumSeries(exp), "kWh", 0)],
      ["Net-seller days", totalDays ? `${Math.round((daySplit.seller / totalDays) * 100)}%` : "—", "ok"],
      ["Peak tariff share", formatValue((sumSeries(lastSlice.impT1) / (sumSeries(imp) || 1)) * 100, "%", 0)],
    ],
    solar: [
      ["Exported", formatValue(sumSeries(exp), "kWh", 0)],
      ["Self-sufficiency", avgSuff != null ? `${avgSuff}% avg` : "—", "ok"],
      ["Battery level", formatValue(latestSoc, "%", 0)],
      ["Energy stored", formatValue(sumSeries(batIn), "kWh", 1)],
    ],
    utilities: [
      ["Gas total", formatValue(sumSeries(gas), "m³", 1)],
      ["Gas / day", formatValue(sumSeries(gas) / (gas.length || 1), "m³", 2)],
      ["Water total", formatValue(sumSeries(water), "L", 0)],
      ["Water / day", formatValue(sumSeries(water) / (water.length || 1), "L", 0)],
    ],
    scenarios: [
      ["Current bill (yr)", `€ ${scenario.current.costEur.toFixed(0)}`],
      ["After scenario", `€ ${scenario.scenario.costEur.toFixed(0)}`, scenario.savingEur > 0 ? "ok" : ""],
      ["Annual saving", `€ ${scenario.savingEur.toFixed(0)}`, scenario.savingEur > 0 ? "ok" : ""],
      ["Payback", scenario.paybackYears ? `${scenario.paybackYears.toFixed(1)} yr` : "—"],
    ],
    decisions: (() => {
      const cost = dailyCostSeries({
        importDaily: imp,
        exportDaily: exp,
        gasDaily: gas,
      });
      const bill = sumSeries(cost);
      const days = cost.length || 1;
      const impCost = sumSeries(imp) * SCENARIO_ASSUMPTIONS.importPrice;
      const gasCost = sumSeries(gas) * SCENARIO_ASSUMPTIONS.gasPrice;
      const energyCost = impCost + gasCost;
      const exposure = getBuildingExposureSummary();
      return [
        ["Period bill", `€ ${bill.toFixed(0)}`],
        ["Avg € / day", `€ ${(bill / days).toFixed(2)}`],
        [
          "Import share",
          energyCost > 0 ? `${Math.round((impCost / energyCost) * 100)}%` : "—",
        ],
        [
          "Critical IAQ h",
          `${exposure.criticalHours} h`,
          exposure.criticalHours > 0 ? "" : "ok",
        ],
      ];
    })(),
    forecast: lastForecast?.ok
      ? [
          ["Split", "80 / 10 / 10"],
          ["Test MAE", `${lastForecast.metrics.testMae?.toFixed(2) ?? "—"} kWh`],
          ["14-day forecast", formatValue(lastForecast.forecastTotal, "kWh", 0)],
          ["Lookback", `${lastForecast.lookback} days`],
        ]
      : [
          ["Model", "LSTM"],
          ["Split", "80 / 10 / 10"],
          ["Target", "Grid import"],
          ["Horizon", "14 days"],
        ],
  };

  el.innerHTML = (byTab[activeTab] ?? byTab.overview)
    .map(
      ([label, val, cls]) =>
        `<div class="statCard"><span class="statLabel">${label}</span><span class="statVal ${cls ?? ""}">${val}</span></div>`,
    )
    .join("");
}

function buildChartInstances() {
  if (typeof Chart === "undefined") {
    document.querySelector(".chartSection.active .chartsGrid").innerHTML =
      "<p class='muted'>Chart.js failed to load — check your connection and reload.</p>";
    return;
  }

  const pctScale = {
    ...simpleOptions("%").scales,
    y: { ...simpleOptions("%").scales.y, min: 0, max: 100 },
  };
  const line = (y) => ({ type: "line", data: { labels: [], datasets: [] }, options: simpleOptions(y) });
  const bar = (y, stacked = false) => ({
    type: "bar",
    data: { labels: [], datasets: [] },
    options: simpleOptions(y, { stacked }),
  });
  const doughnut = () => ({
    type: "doughnut",
    data: { labels: [], datasets: [] },
    options: doughnutOptions(),
  });

  makeChart("chElec", line("kWh"));
  makeChart("chBalance", doughnut());
  makeChart("chTrend", line("kWh"));
  makeChart("chWeekday", bar("kWh"));
  makeChart("chNet", { type: "bar", data: { labels: [], datasets: [] }, options: netChartOptions() });
  makeChart("chTariff", bar("kWh", true));
  makeChart("chBuyerSeller", doughnut());
  makeChart("chElecMonthly", bar("kWh"));
  makeChart("chPeak", line("W"));
  makeChart("chSolarExport", line("kWh"));
  makeChart("chSelfSuff", {
    type: "line",
    data: { labels: [], datasets: [] },
    options: { ...simpleOptions("%"), scales: pctScale },
  });
  makeChart("chSolarWeekday", bar("kWh"));
  makeChart("chBattery", {
    type: "line",
    data: { labels: [], datasets: [] },
    options: { ...simpleOptions("%"), scales: pctScale },
  });
  makeChart("chBatteryFlow", bar("kWh", true));
  makeChart("chBatterySwing", bar("%"));
  makeChart("chGas", bar("m³"));
  makeChart("chGasWeekday", bar("m³"));
  makeChart("chWater", bar("L"));
  makeChart("chWaterWeekday", bar("L"));
  makeChart("chScenario", bar("€/year"));
  makeChart("chDecCost", bar("€"));
  makeChart("chDecPackages", {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 280 },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: C.text, boxWidth: 8, font: { size: 12 }, padding: 14 },
        },
        tooltip: tooltipBase(),
      },
      scales: {
        x: {
          ticks: { color: C.tick, font: { size: 11 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          position: "left",
          ticks: { color: C.tick, font: { size: 11 }, maxTicksLimit: 6 },
          grid: { color: C.grid },
          border: { display: false },
          title: { display: true, text: "€ / year", color: C.tick, font: { size: 11 } },
        },
        y1: {
          position: "right",
          ticks: { color: C.tick, font: { size: 11 }, maxTicksLimit: 6 },
          grid: { drawOnChartArea: false },
          border: { display: false },
          title: { display: true, text: "CO₂ (t)", color: C.tick, font: { size: 11 } },
        },
      },
    },
  });
  makeChart("chForecast", line("kWh"));
}

function setChart(id, labelsArr, datasets) {
  const chart = charts.get(id);
  if (!chart) return;
  chart.data.labels = labelsArr;
  chart.data.datasets = datasets;
  chart.update();
}

function refreshCharts() {
  if (!currentSummary || typeof Chart === "undefined") return;
  const S = currentSummary.series ?? {};

  const imp = slice(S, "importDaily");
  const exp = slice(S, "exportDaily");
  const impT1 = slice(S, "importT1Daily");
  const impT2 = slice(S, "importT2Daily");
  const gas = slice(S, "gasDaily");
  const water = slice(S, "waterDailyL");
  const l1 = slice(S, "l1Daily");
  const l2 = slice(S, "l2Daily");
  const l3 = slice(S, "l3Daily");
  const batIn = slice(S, "batteryImportDaily");
  const batOut = slice(S, "batteryExportDaily");
  const batRange = filterByHorizon(S.batterySoCRange ?? [], selectedHorizon);
  const battery = filterByHorizon(S.batterySoC ?? [], selectedHorizon ? selectedHorizon * 6 : null);
  const net = netDaily(imp, exp);
  const daySplit = netSellerDaySplit(net);

  lastSlice = { imp, exp, impT1, impT2, gas, water, battery, batIn, batOut, net, daySplit };
  updateStatsForTab();

  setChart("chElec", labels(imp), [
    lineDs("Bought from grid", values(imp), C.import, C.importFill),
    lineDs("Sold to grid", values(exp), C.export, C.exportFill),
  ]);

  setChart("chBalance", ["Grid import", "Grid export"], [
    {
      data: [Math.round(sumSeries(imp)), Math.round(sumSeries(exp))],
      backgroundColor: [C.import, C.export],
      borderWidth: 0,
    },
  ]);

  const trend = rollingAverage(imp, 7);
  setChart("chTrend", labels(trend), [
    lineDs("7-day rolling average", values(trend), C.import, C.importFill),
  ]);

  setChart("chWeekday", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [
    barDataset("Avg kWh", values(dayOfWeekAverages(imp)), C.import),
  ]);

  setChart("chNet", labels(net), [
    {
      label: "Net balance",
      data: values(net),
      backgroundColor: net.map((d) => (d.value >= 0 ? "rgba(94,184,255,0.8)" : "rgba(52,211,153,0.8)")),
      borderRadius: 3,
      borderSkipped: false,
    },
  ]);

  const tariffMonthly = useMonthlyGranularity();
  const t1Series = tariffMonthly ? monthlyTotals(impT1) : impT1;
  const t2Series = tariffMonthly ? monthlyTotals(impT2) : impT2;
  setChart("chTariff", labels(t1Series), [
    barDataset("Day rate", values(t1Series), C.import),
    barDataset("Night rate", values(t2Series), "#2563eb"),
  ]);

  setChart("chBuyerSeller", ["Import days", "Export days", "Balanced"], [
    {
      data: [daySplit.buyer, daySplit.seller, daySplit.balanced],
      backgroundColor: [C.import, C.export, C.neutral],
      borderWidth: 0,
    },
  ]);

  setChart("chElecMonthly", labels(monthlyTotals(imp)), [
    barDataset("Import", values(monthlyTotals(imp)), C.import),
    barDataset("Export", values(monthlyTotals(exp)), C.export),
  ]);

  setChart("chPeak", labels(dailyPeak(l1, l2, l3)), [
    lineDs("Peak demand", values(dailyPeak(l1, l2, l3)), C.peak, C.peakFill),
  ]);

  setChart("chSolarExport", labels(exp), [
    lineDs("Grid export", values(exp), C.export, C.exportFill),
  ]);

  setChart("chSelfSuff", labels(selfSufficiencyPct(imp, exp)), [
    lineDs("On-site contribution %", values(selfSufficiencyPct(imp, exp)), C.peak, C.peakFill),
  ]);

  setChart("chSolarWeekday", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [
    barDataset("Avg export kWh", values(dayOfWeekAverages(exp)), C.export),
  ]);

  setChart("chBattery", labels(battery), [
    lineDs("State of charge", values(battery), C.battery, "rgba(167,139,250,0.15)"),
  ]);

  setChart("chBatteryFlow", labels(batIn.length ? batIn : batOut), [
    barDataset("Stored", values(batIn), C.export),
    barDataset("Released", values(batOut), C.peak),
  ]);

  setChart("chBatterySwing", labels(batRange), [
    barDataset("Daily swing %", batRange.map((d) => d.swing), C.battery),
  ]);

  const useMonthly = useMonthlyGranularity();
  const gasSeries = useMonthly ? monthlyTotals(gas) : gas;
  const waterSeries = useMonthly ? monthlyTotals(water) : water;

  document.getElementById("chGasDesc").textContent = useMonthly
    ? "Total gas consumption per month."
    : "Daily gas consumption from the building meter.";
  document.getElementById("chWaterDesc").textContent = useMonthly
    ? "Total water consumption per month."
    : "Daily water consumption from the building meter.";

  setChart("chGas", labels(gasSeries), [
    barDataset(useMonthly ? "m³ / month" : "m³ / day", values(gasSeries), C.gas),
  ]);
  setChart("chGasWeekday", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [
    barDataset("Avg m³", values(dayOfWeekAverages(gas)), C.gas),
  ]);
  setChart("chWater", labels(waterSeries), [
    barDataset(useMonthly ? "L / month" : "L / day", values(waterSeries), C.water),
  ]);
  setChart("chWaterWeekday", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [
    barDataset("Avg litres", values(dayOfWeekAverages(water)), C.water),
  ]);

  if (activeTab === "scenarios") refreshScenario();
  if (activeTab === "decisions") refreshDecisions();
}

function wireDecisions() {
  document.getElementById("decisionsPrintBtn")?.addEventListener("click", () => {
    document.body.classList.add("printing-decisions");
    const cleanup = () => document.body.classList.remove("printing-decisions");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    // Fallback if afterprint never fires
    setTimeout(cleanup, 1500);
  });
}

function wireForecast() {
  document.getElementById("forecastRunBtn")?.addEventListener("click", () => loadForecastCsv());
}

function showForecastState() {
  if (lastForecast?.ok) {
    renderForecastResult(lastForecast);
    return;
  }
  const status = document.getElementById("forecastStatus");
  if (status && !forecastRunning) {
    status.textContent = "Click to load the saved LSTM forecast CSV (no training).";
  }
  // Auto-load once when opening the tab
  if (!lastForecast && !forecastRunning) loadForecastCsv();
  else updateStatsForTab();
}

async function loadForecastCsv() {
  if (forecastRunning) return;
  forecastRunning = true;
  const btn = document.getElementById("forecastRunBtn");
  const status = document.getElementById("forecastStatus");
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Loading forecast CSV…";

  try {
    const { loadSavedImportForecast } = await import("../data/energyForecastService.js");
    const result = await loadSavedImportForecast();
    lastForecast = result;
    if (!result.ok) {
      if (status) status.textContent = result.error;
      setChart("chForecast", [], []);
      const kpis = document.getElementById("forecastKpis");
      const table = document.getElementById("forecastMetricsTable");
      const note = document.getElementById("forecastNote");
      if (kpis) kpis.innerHTML = "";
      if (table) table.innerHTML = "";
      if (note) note.textContent = "";
    } else {
      renderForecastResult(result);
      if (status) {
        const when = result.generatedAt
          ? ` · generated ${new Date(result.generatedAt).toLocaleString()}`
          : "";
        status.textContent = `Loaded from CSV${when}`;
      }
    }
  } catch (err) {
    console.error(err);
    if (status) status.textContent = `Load failed: ${err.message ?? err}`;
  } finally {
    forecastRunning = false;
    if (btn) btn.disabled = false;
    if (activeTab === "forecast") updateStatsForTab();
  }
}

function renderForecastResult(result) {
  const hist = result.history ?? [];
  const fc = result.forecast ?? [];
  const allLabels = [...hist.map((d) => d.date), ...fc.map((d) => d.date)];
  const histVals = [...hist.map((d) => d.value), ...fc.map(() => null)];
  const fcVals = [...hist.map(() => null), ...fc.map((d) => d.value)];
  // Connect forecast to last history point
  if (hist.length && fcVals.length > hist.length) {
    fcVals[hist.length - 1] = hist[hist.length - 1].value;
  }

  setChart("chForecast", allLabels, [
    lineDs("History (import)", histVals, C.import, C.importFill),
    {
      label: "LSTM forecast",
      data: fcVals,
      borderColor: C.forecast,
      backgroundColor: C.forecastFill,
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2,
      borderDash: [6, 4],
      tension: 0.28,
      spanGaps: false,
    },
  ]);

  const kpis = document.getElementById("forecastKpis");
  if (kpis) {
    kpis.innerHTML = `
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${formatValue(result.forecastTotal, "kWh", 0)}</span>
        <span class="scenario-kpi-lbl">Next ${result.forecastDays}d import</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${result.metrics.testMae?.toFixed(2) ?? "—"}</span>
        <span class="scenario-kpi-lbl">Test MAE (kWh)</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${result.metrics.valMae?.toFixed(2) ?? "—"}</span>
        <span class="scenario-kpi-lbl">Val MAE (kWh)</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">80/10/10</span>
        <span class="scenario-kpi-lbl">Train / val / test</span>
      </div>`;
  }

  const table = document.getElementById("forecastMetricsTable");
  if (table) {
    const s = result.split;
    table.innerHTML = `
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Windows (train / val / test)</td><td>${s.nTrain} / ${s.nVal} / ${s.nTest}</td></tr>
      <tr><td>Train MAE</td><td>${result.metrics.trainMae?.toFixed(3) ?? "—"} kWh</td></tr>
      <tr><td>Validation MAE</td><td>${result.metrics.valMae?.toFixed(3) ?? "—"} kWh</td></tr>
      <tr><td>Test MAE</td><td>${result.metrics.testMae?.toFixed(3) ?? "—"} kWh</td></tr>
      <tr><td>Test RMSE</td><td>${result.metrics.testRmse?.toFixed(3) ?? "—"} kWh</td></tr>
      <tr><td>Lookback</td><td>${result.lookback} days</td></tr>`;
  }

  const note = document.getElementById("forecastNote");
  if (note) {
    const gen = result.generatedAt
      ? ` Saved ${new Date(result.generatedAt).toLocaleString()}.`
      : "";
    note.textContent =
      `Loaded from energy CSV (no browser training). Target = daily grid import (kWh), split 80/10/10.` +
      ` Regenerate offline with npm run forecast:gen.${gen}`;
  }
}

function refreshDecisions() {
  if (!currentSummary) return;
  const S = currentSummary.series ?? {};
  const imp = slice(S, "importDaily");
  const exp = slice(S, "exportDaily");
  const gas = slice(S, "gasDaily");
  const costDaily = dailyCostSeries({ importDaily: imp, exportDaily: exp, gasDaily: gas });
  const useMonthly = useMonthlyGranularity();
  const costSeries = useMonthly ? monthlyTotals(costDaily) : costDaily;

  const bill = sumSeries(costDaily);
  const days = costDaily.length || 1;
  const impCost = sumSeries(imp) * SCENARIO_ASSUMPTIONS.importPrice;
  const gasCost = sumSeries(gas) * SCENARIO_ASSUMPTIONS.gasPrice;
  const feedCredit = sumSeries(exp) * SCENARIO_ASSUMPTIONS.feedInPrice;
  const energySpend = impCost + gasCost;

  const desc = document.getElementById("decCostDesc");
  if (desc) {
    desc.textContent = useMonthly
      ? "Monthly energy cost (€) from import, feed-in credit, and gas — same prices as Scenarios."
      : "Daily energy cost (€) from import, feed-in credit, and gas — same prices as Scenarios.";
  }

  const costKpis = document.getElementById("decCostKpis");
  if (costKpis) {
    costKpis.innerHTML = `
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">€ ${bill.toFixed(0)}</span>
        <span class="scenario-kpi-lbl">Period bill</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">€ ${(bill / days).toFixed(2)}</span>
        <span class="scenario-kpi-lbl">Avg € / day</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${energySpend > 0 ? Math.round((impCost / energySpend) * 100) : 0}%</span>
        <span class="scenario-kpi-lbl">Import share</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${energySpend > 0 ? Math.round((gasCost / energySpend) * 100) : 0}%</span>
        <span class="scenario-kpi-lbl">Gas share</span>
      </div>`;
  }

  setChart("chDecCost", labels(costSeries), [
    barDataset(useMonthly ? "€ / month" : "€ / day", values(costSeries), C.import),
  ]);

  const exposure = getBuildingExposureSummary();
  const expKpis = document.getElementById("decExposureKpis");
  if (expKpis) {
    expKpis.innerHTML = `
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${exposure.elevatedHours}</span>
        <span class="scenario-kpi-lbl">Elevated hours</span>
      </div>
      <div class="scenario-kpi ${exposure.criticalHours ? "" : "ok"}">
        <span class="scenario-kpi-val">${exposure.criticalHours}</span>
        <span class="scenario-kpi-lbl">Critical hours</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${exposure.roomCount}</span>
        <span class="scenario-kpi-lbl">Rooms tracked</span>
      </div>
      <div class="scenario-kpi">
        <span class="scenario-kpi-val">${exposure.hours}</span>
        <span class="scenario-kpi-lbl">History hours</span>
      </div>`;
  }

  const expTable = document.getElementById("decExposureTable");
  if (expTable) {
    const rows = exposure.worstRooms.length
      ? exposure.worstRooms
          .map(
            (r) =>
              `<tr><td>${r.name}</td><td>${r.elevatedHours}</td><td>${r.criticalHours}</td><td>${r.avgCo2}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="muted">No IAQ history loaded yet.</td></tr>`;
    expTable.innerHTML = `
      <tr><th>Room</th><th>Elevated h</th><th>Critical h</th><th>Avg CO₂</th></tr>
      ${rows}`;
  }

  const packages = compareDecisionPackages(currentSummary.series);
  setChart(
    "chDecPackages",
    packages.map((p) => p.label),
    [
      {
        label: "Annual bill (€)",
        data: packages.map((p) => Math.round(p.annualBill)),
        backgroundColor: C.import,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 36,
        yAxisID: "y",
      },
      {
        label: "CO₂ reduction (t)",
        data: packages.map((p) => Math.round(p.co2Tonnes * 100) / 100),
        backgroundColor: C.export,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 36,
        yAxisID: "y1",
      },
    ],
  );

  const cmpTable = document.getElementById("decCompareTable");
  if (cmpTable) {
    cmpTable.innerHTML = `
      <tr>
        <th>Package</th>
        <th>Annual bill</th>
        <th>Saving vs baseline</th>
        <th>Capex</th>
        <th>Payback</th>
        <th>CO₂ reduction</th>
        <th>Comfort</th>
      </tr>
      ${packages
        .map(
          (p) => `<tr>
            <td>${p.label}</td>
            <td>€ ${p.annualBill.toFixed(0)}</td>
            <td>${p.savingVsBaseline >= 0 ? "€ " + p.savingVsBaseline.toFixed(0) : "—"}</td>
            <td>${p.capexEur > 0 ? "€ " + p.capexEur.toFixed(0) : "—"}</td>
            <td>${p.paybackYears != null ? p.paybackYears.toFixed(1) + " yr" : "—"}</td>
            <td>${p.co2Tonnes.toFixed(2)} t</td>
            <td>${p.comfort}/5</td>
          </tr>`,
        )
        .join("")}`;
  }

  const A = SCENARIO_ASSUMPTIONS;
  const footnote = document.getElementById("decAssumptions");
  if (footnote) {
    footnote.textContent =
      `Assumptions: €${A.importPrice}/kWh import · €${A.feedInPrice} feed-in · €${A.gasPrice}/m³ gas · ` +
      `€${A.panelCost}/panel · €${A.batteryCostPerKWh}/kWh battery · €${A.heatPumpCost} heat pump · COP ${A.heatPumpCOP}. ` +
      `Comfort = heating comfort proxy (baseline/solar/battery = 3; heat-pump package = 4) — not measured IAQ. ` +
      `Feed-in credit in period: € ${feedCredit.toFixed(0)}.`;
  }

  if (activeTab === "decisions") updateStatsForTab();
}

function readScenarioInputs() {
  return {
    panels: Number(document.getElementById("scPanels")?.value ?? 0),
    batteryKWh: Number(document.getElementById("scBattery")?.value ?? 0),
    heatPump: Boolean(document.getElementById("scHeatPump")?.checked),
  };
}

function wireScenarios() {
  const A = SCENARIO_ASSUMPTIONS;
  document.getElementById("scAssumptions").textContent =
    `Assumptions: €${A.importPrice}/kWh import · €${A.feedInPrice} feed-in · €${A.gasPrice}/m³ gas · COP ${A.heatPumpCOP} heat pump.`;

  ["scPanels", "scBattery", "scHeatPump"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", refreshScenario);
    document.getElementById(id)?.addEventListener("change", refreshScenario);
  });
}

function refreshScenario() {
  if (!currentSummary) return;
  const inputs = readScenarioInputs();
  document.getElementById("scPanelsVal").textContent = `${inputs.panels} panel${inputs.panels === 1 ? "" : "s"}`;
  document.getElementById("scBatteryVal").textContent = `${inputs.batteryKWh} kWh`;

  const r = computeScenario(currentSummary.series, inputs);

  document.getElementById("scKpis").innerHTML = `
    <div class="scenario-kpi ${r.savingEur > 0 ? "ok" : ""}">
      <span class="scenario-kpi-val">€ ${r.savingEur.toFixed(0)}</span>
      <span class="scenario-kpi-lbl">Est. annual saving</span>
    </div>
    <div class="scenario-kpi">
      <span class="scenario-kpi-val">${r.co2Tonnes.toFixed(2)} t</span>
      <span class="scenario-kpi-lbl">CO₂ avoided / yr</span>
    </div>
    <div class="scenario-kpi">
      <span class="scenario-kpi-val">${r.paybackYears ? `${r.paybackYears.toFixed(1)} yr` : "—"}</span>
      <span class="scenario-kpi-lbl">Simple payback</span>
    </div>
    <div class="scenario-kpi">
      <span class="scenario-kpi-val">€ ${r.capexEur.toFixed(0)}</span>
      <span class="scenario-kpi-lbl">Upfront investment</span>
    </div>`;

  setChart("chScenario", ["Current setup", "With scenario"], [
    {
      label: "Annual energy bill (€)",
      data: [r.current.costEur, r.scenario.costEur],
      backgroundColor: [C.neutral, C.export],
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 56,
    },
  ]);

  document.getElementById("scTable").innerHTML = `
    <tr><th></th><th>Current</th><th>Scenario</th></tr>
    <tr><td>Grid import</td><td>${formatValue(r.current.importKWh, "kWh", 0)}</td><td>${formatValue(r.scenario.importKWh, "kWh", 0)}</td></tr>
    <tr><td>Grid export</td><td>${formatValue(r.current.exportKWh, "kWh", 0)}</td><td>${formatValue(r.scenario.exportKWh, "kWh", 0)}</td></tr>
    <tr><td>Gas use</td><td>${formatValue(r.current.gasM3, "m³", 0)}</td><td>${formatValue(r.scenario.gasM3, "m³", 0)}</td></tr>
    <tr><td>Annual bill</td><td>€ ${r.current.costEur.toFixed(0)}</td><td>€ ${r.scenario.costEur.toFixed(0)}</td></tr>`;

  if (activeTab === "scenarios") updateStatsForTab();
}
