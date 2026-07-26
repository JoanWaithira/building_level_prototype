// IAQ Analytics — historical trends, alert rules, replay controls.
import { roomEntities } from "../viewer/geojsonRooms.js";
import {
  getHistory,
  getRoomHistoryStats,
  getTimeline,
  getReadingAtIndex,
} from "../data/iaqHistoryService.js";
import {
  getReading,
  IAQ_THRESHOLDS,
} from "../data/sensorDataService.js";
import {
  getRules,
  setRuleEnabled,
  evaluateAllReadings,
  formatAlert,
} from "../simulation/iaqRules.js";
import {
  isIaqReplayActive,
  openIaqReplayAt,
  onIaqReplayFrame,
} from "../simulation/iaqReplay.js";

const HORIZONS = [
  { id: "24", label: "24 hours", hours: 24 },
  { id: "72", label: "3 days", hours: 72 },
  { id: "168", label: "7 days", hours: 168 },
];

const TABS = ["trends", "alerts", "replay"];
const C = {
  co2: "#5eb8ff",
  temp: "#fbbf24",
  humidity: "#34d399",
  grid: "rgba(255,255,255,0.05)",
  tick: "#8b97ad",
};

let built = false;
let selectedRoom = null;
let selectedHorizon = 72;
let activeTab = "trends";
let trendChart = null;
let replayChart = null;

function roomOptions() {
  return roomEntities
    .map((r) => ({ id: r.props.room_id, name: r.props.room_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatShortTs(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
}

function applyChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color = C.tick;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
}

function buildHorizonSelector() {
  const el = document.getElementById("iaqHorizon");
  if (!el) return;
  el.innerHTML = HORIZONS.map(
    (h) => `<button type="button" class="horizon-btn ${h.hours === selectedHorizon ? "active" : ""}" data-hours="${h.hours}">${h.label}</button>`
  ).join("");
  el.querySelectorAll("[data-hours]").forEach((btn) => {
    btn.onclick = () => {
      selectedHorizon = +btn.dataset.hours;
      el.querySelectorAll("[data-hours]").forEach((b) => b.classList.toggle("active", b === btn));
      refreshTrends();
    };
  });
}

function buildRoomSelector() {
  const el = document.getElementById("iaqRoomSelect");
  if (!el) return;
  const rooms = roomOptions();
  if (!selectedRoom && rooms.length) selectedRoom = rooms[0].id;
  el.innerHTML = rooms
    .map((r) => `<option value="${r.id}" ${r.id === selectedRoom ? "selected" : ""}>${r.name}</option>`)
    .join("");
  el.onchange = () => {
    selectedRoom = el.value;
    refreshTrends();
    refreshAlertsPanel();
  };
}

function destroyChart(ref) {
  if (ref) ref.destroy();
  return null;
}

function refreshTrends() {
  if (!selectedRoom || !window.Chart) return;
  const series = getHistory(selectedRoom, selectedHorizon);
  const stats = getRoomHistoryStats(selectedRoom);
  const statsEl = document.getElementById("iaqTrendStats");
  if (statsEl && stats) {
    statsEl.innerHTML = `
      <div class="iaq-stat"><span class="iaq-stat-val">${stats.co2.avg}</span><span class="iaq-stat-lbl">Avg CO₂ ppm</span></div>
      <div class="iaq-stat"><span class="iaq-stat-val">${stats.co2.max}</span><span class="iaq-stat-lbl">Peak CO₂</span></div>
      <div class="iaq-stat"><span class="iaq-stat-val">${stats.warnHours}h</span><span class="iaq-stat-lbl">Elevated hours</span></div>
      <div class="iaq-stat"><span class="iaq-stat-val">${stats.badHours}h</span><span class="iaq-stat-lbl">Critical hours</span></div>`;
  }

  const labels = series.map((p) => formatShortTs(p.timestamp));
  const canvas = document.getElementById("iaqTrendChart");
  if (!canvas) return;

  trendChart = destroyChart(trendChart);
  trendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "CO₂ (ppm)",
          data: series.map((p) => p.co2),
          borderColor: C.co2,
          backgroundColor: "rgba(94,184,255,0.12)",
          yAxisID: "yCo2",
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "Temperature (°C)",
          data: series.map((p) => p.temperature),
          borderColor: C.temp,
          yAxisID: "yTemp",
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
        },
        {
          label: "Humidity (%)",
          data: series.map((p) => p.humidity),
          borderColor: C.humidity,
          yAxisID: "yHum",
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        annotation: {},
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        yCo2: {
          type: "linear",
          position: "left",
          title: { display: true, text: "CO₂ ppm" },
          suggestedMin: 350,
        },
        yTemp: {
          type: "linear",
          position: "right",
          title: { display: true, text: "°C" },
          grid: { drawOnChartArea: false },
          suggestedMin: 16,
          suggestedMax: 28,
        },
        yHum: {
          type: "linear",
          position: "right",
          display: false,
          suggestedMin: 25,
          suggestedMax: 75,
        },
      },
      onClick: (_e, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const timeline = getTimeline();
        const globalIdx = timeline.length - series.length + idx;
        openIaqReplayAt(globalIdx);
        highlightReplayChart(globalIdx);
      },
    },
  });
}

function highlightReplayChart(index) {
  if (!replayChart) return;
  replayChart.setActiveElements([]);
  replayChart.update("none");
}

function refreshRulesList() {
  const el = document.getElementById("iaqRulesList");
  if (!el) return;
  el.innerHTML = getRules()
    .map(
      (r) => `
    <label class="iaq-rule-row">
      <input type="checkbox" data-rule="${r.id}" ${r.enabled ? "checked" : ""} />
      <span class="iaq-rule-sev iaq-rule-sev-${r.severity}">${r.severity}</span>
      <span>${r.label}</span>
      <span class="muted iaq-rule-thresh">${r.metric} ${r.op} ${r.value}</span>
    </label>`
    )
    .join("");
  el.querySelectorAll("[data-rule]").forEach((cb) => {
    cb.onchange = () => setRuleEnabled(cb.dataset.rule, cb.checked);
  });
}

function refreshAlertsPanel() {
  refreshRulesList();
  const live = evaluateAllReadings(
    roomEntities.map((r) => getReading(r.props.room_id)).filter(Boolean)
  );
  const liveEl = document.getElementById("iaqLiveAlerts");
  if (liveEl) {
    liveEl.innerHTML = live.length
      ? live.map((a) => `<div class="iaq-alert-row">${formatAlert(a).html}</div>`).join("")
      : `<p class="muted">No active alerts right now — all rooms within configured rules.</p>`;
  }

  const threshEl = document.getElementById("iaqThresholdsRef");
  if (threshEl) {
    threshEl.innerHTML = `
      <p class="muted">Default thresholds (used by rules):</p>
      <ul class="iaq-thresh-list">
        <li>CO₂ good ≤ ${IAQ_THRESHOLDS.co2.good} ppm · warn ≤ ${IAQ_THRESHOLDS.co2.warn} ppm · above = critical</li>
        <li>Temperature ${IAQ_THRESHOLDS.temperature.low}–${IAQ_THRESHOLDS.temperature.high} °C</li>
        <li>Humidity ${IAQ_THRESHOLDS.humidity.low}–${IAQ_THRESHOLDS.humidity.high} %</li>
      </ul>`;
  }
}

function buildReplayOverviewChart() {
  const canvas = document.getElementById("iaqReplayChart");
  if (!canvas || !window.Chart) return;
  const timeline = getTimeline();
  const avgCo2 = timeline.map((_, i) => {
    const frame = getReadingAtIndex(i);
    const vals = frame.readings.map((r) => r.co2);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  });

  replayChart = destroyChart(replayChart);
  replayChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: timeline.map(formatShortTs),
      datasets: [{
        label: "Building avg CO₂",
        data: avgCo2,
        borderColor: C.co2,
        backgroundColor: "rgba(94,184,255,0.1)",
        fill: true,
        tension: 0.2,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { maxTicksLimit: 10 } } },
      onClick: (_e, elements) => {
        if (!elements.length) return;
        openIaqReplayAt(elements[0].index);
      },
    },
  });
}

function refreshReplayPanel() {
  buildReplayOverviewChart();
  const statusEl = document.getElementById("iaqReplayStatus");
  if (statusEl) {
    statusEl.textContent = isIaqReplayActive()
      ? "Replay is running on the 3D twin."
      : "Start replay below, or click a point on the chart.";
  }
}

function switchTab(tab) {
  activeTab = TABS.includes(tab) ? tab : "trends";
  document.querySelectorAll("#iaqTabs [data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === activeTab));
  document.querySelectorAll("#iaqOverlay .iaq-section").forEach((s) =>
    s.classList.toggle("active", s.dataset.section === activeTab));
  if (activeTab === "trends") refreshTrends();
  if (activeTab === "alerts") refreshAlertsPanel();
  if (activeTab === "replay") refreshReplayPanel();
}

function refreshAll() {
  buildRoomSelector();
  buildHorizonSelector();
  switchTab(activeTab);
}

export function openIaqAnalytics(roomId = null, tab = "trends") {
  if (roomId) selectedRoom = roomId;
  document.getElementById("iaqOverlay").style.display = "block";
  document.body.classList.add("iaq-open");
  if (!built) {
    applyChartDefaults();
    built = true;
    onIaqReplayFrame(() => {
      if (document.body.classList.contains("iaq-open") && activeTab === "replay") {
        refreshReplayPanel();
      }
    });
  }
  refreshAll();
  if (TABS.includes(tab)) switchTab(tab);
}

export function closeIaqAnalytics() {
  document.getElementById("iaqOverlay").style.display = "none";
  document.body.classList.remove("iaq-open");
}

export function initIaqAnalytics() {
  document.getElementById("iaqClose")?.addEventListener("click", closeIaqAnalytics);
  document.getElementById("iaqStartReplay")?.addEventListener("click", () => {
    openIaqReplayAt(getTimeline().length - 1);
    refreshReplayPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("iaq-open")) {
      closeIaqAnalytics();
    }
  });
  document.querySelectorAll("#iaqTabs [data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}
