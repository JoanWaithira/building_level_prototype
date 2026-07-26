// Household manager gamification: eco-score, level and badges,
// all computed from the REAL energy data.
import { sumSeries, netDaily, selfSufficiencyPct, netSellerDaySplit } from "../data/energyDataService.js";

const LEVELS = [
  [0, "Energy Rookie", "🌱"],
  [25, "Conscious Resident", "🌿"],
  [45, "Energy Manager", "⚙️"],
  [65, "Solar Strategist", "☀️"],
  [80, "Grid Master", "⚡"],
  [92, "Net-Zero Hero", "🏆"],
];

export function computeGameState(summary) {
  const S = summary.series ?? {};
  const imp = S.importDaily ?? [], exp = S.exportDaily ?? [], gas = S.gasDaily ?? [];
  const days = imp.length || 1;

  const suff = selfSufficiencyPct(imp, exp);
  const avgSuff = suff.length ? suff.reduce((s, d) => s + d.value, 0) / suff.length : 0;
  const split = netSellerDaySplit(netDaily(imp, exp));
  const sellerPct = ((split.seller + split.balanced * 0.5) / days) * 100;
  const gasFree = gas.filter((d) => d.value < 0.2).length;
  const gasFreePct = (gasFree / (gas.length || 1)) * 100;
  const bestExport = Math.max(0, ...exp.map((d) => d.value));
  const bestStreak = longestStreak(netDaily(imp, exp), (v) => v < 0);

  const score = Math.round(Math.min(100, avgSuff * 0.45 + sellerPct * 0.35 + gasFreePct * 0.2));
  const level = [...LEVELS].reverse().find(([min]) => score >= min);

  const badges = [
    ["☀️", "Solar Baron", `${split.seller} net-export days`, split.seller >= 30],
    ["🔥", "Flame Tamer", `${gasFree} gas-free days`, gasFree >= 20],
    ["📈", "Peak Performer", `best export ${bestExport.toFixed(1)} kWh/day`, bestExport >= 15],
    ["🔗", "Streak Keeper", `${bestStreak} export days in a row`, bestStreak >= 5],
    ["🔋", "Battery Owner", "home battery connected", (S.batterySoC ?? []).length > 0],
    ["🌍", "Half-Independent", `${avgSuff.toFixed(0)}% avg self-sufficiency`, avgSuff >= 50],
  ];

  return { score, levelName: level[1], levelIcon: level[2], badges,
           stats: { avgSuff, sellerDays: split.seller, gasFree, bestExport, bestStreak, days } };
}

function longestStreak(series, pred) {
  let best = 0, cur = 0;
  for (const d of series) {
    cur = pred(d.value) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

export function renderEcoHud(summary) {
  const g = computeGameState(summary);
  const el = document.getElementById("ecoHud");
  const earned = g.badges.filter((b) => b[3]).length;
  el.innerHTML = `
    <div class="eco-chip" id="ecoChip" title="Click for badges">
      <div class="eco-ring" style="background:conic-gradient(#7ee29a ${g.score * 3.6}deg, rgba(255,255,255,0.12) 0deg)">
        <span>${g.score}</span>
      </div>
      <div class="eco-txt">
        <div class="eco-lvl">${g.levelIcon} ${g.levelName}</div>
        <div class="eco-sub">${earned}/${g.badges.length} badges · ${g.stats.days} days played</div>
      </div>
    </div>
    <div class="eco-pop" id="ecoPop" style="display:none">
      <h3>Household achievements</h3>
      ${g.badges.map(([icon, name, detail, got]) => `
        <div class="badge-row ${got ? "got" : "locked"}">
          <span class="badge-ico">${got ? icon : "🔒"}</span>
          <span><b>${name}</b><br><span class="muted">${detail}</span></span>
        </div>`).join("")}
      <p class="muted">Eco-score = self-sufficiency (45%) + net-seller days (35%) + gas-free days (20%), from your real meter data.</p>
    </div>`;
  document.getElementById("ecoChip").onclick = () => {
    const p = document.getElementById("ecoPop");
    p.style.display = p.style.display === "none" ? "block" : "none";
  };
}
