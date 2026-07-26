// What-if scenario engine — replays the real meter year under a changed setup.
import { sumSeries } from "../data/energyDataService.js";

export const SCENARIO_ASSUMPTIONS = {
  panelKWhPerYear: 340,
  panelCost: 400,
  batteryCostPerKWh: 450,
  heatPumpCost: 11000,
  heatPumpCOP: 3.6,
  gasKWhPerM3: 9.77,
  importPrice: 0.30,
  feedInPrice: 0.09,
  gasPrice: 1.35,
};

export function computeScenario(series, options = {}) {
  const A = SCENARIO_ASSUMPTIONS;
  const nPanels = Number(options.panels) || 0;
  const batKWh = Number(options.batteryKWh) || 0;
  const heatPump = Boolean(options.heatPump);

  const imp = series?.importDaily ?? [];
  const exp = series?.exportDaily ?? [];
  const gas = series?.gasDaily ?? [];
  const expByDate = new Map(exp.map((d) => [d.date, d.value]));
  const gasByDate = new Map(gas.map((d) => [d.date, d.value]));

  const yieldOn = (date) => {
    const m = +date.slice(5, 7);
    const season = 0.45 + 0.55 * Math.sin(((m - 3.5) / 12) * 2 * Math.PI) ** 2;
    return (nPanels * A.panelKWhPerYear / 365) * season * 2 * 0.85;
  };

  let newImp = 0;
  let newExp = 0;
  let newGasM3 = 0;

  for (const d of imp) {
    let dayImp = d.value;
    let dayExp = expByDate.get(d.date) ?? 0;
    const dayGas = gasByDate.get(d.date) ?? 0;

    if (heatPump) {
      dayImp += (dayGas * A.gasKWhPerM3) / A.heatPumpCOP;
    } else {
      newGasM3 += dayGas;
    }

    const gen = yieldOn(d.date);
    const offset = Math.min(dayImp, gen);
    dayImp -= offset;
    dayExp += gen - offset;

    const shift = Math.min(batKWh * 0.8, dayImp, dayExp);
    dayImp -= shift;
    dayExp -= shift;

    newImp += dayImp;
    newExp += dayExp;
  }

  const curImp = sumSeries(imp);
  const curExp = sumSeries(exp);
  const curGas = sumSeries(gas);
  const cost = (i, e, g) => i * A.importPrice - e * A.feedInPrice + g * A.gasPrice;
  const curCost = cost(curImp, curExp, curGas);
  const newCost = cost(newImp, newExp, newGasM3);
  const saving = curCost - newCost;
  const capex =
    nPanels * A.panelCost + batKWh * A.batteryCostPerKWh + (heatPump ? A.heatPumpCost : 0);
  const payback = saving > 0 ? capex / saving : null;
  const co2Kg = (curImp - newImp) * 0.27 + (curGas - newGasM3) * 1.78;

  return {
    current: { importKWh: curImp, exportKWh: curExp, gasM3: curGas, costEur: curCost },
    scenario: { importKWh: newImp, exportKWh: newExp, gasM3: newGasM3, costEur: newCost },
    savingEur: saving,
    capexEur: capex,
    paybackYears: payback,
    co2Tonnes: co2Kg / 1000,
    options: { panels: nPanels, batteryKWh: batKWh, heatPump },
  };
}

/** Daily € from meter series using SCENARIO_ASSUMPTIONS prices. */
export function dailyCostSeries(series) {
  const A = SCENARIO_ASSUMPTIONS;
  const imp = series?.importDaily ?? [];
  const expByDate = new Map((series?.exportDaily ?? []).map((d) => [d.date, d.value]));
  const gasByDate = new Map((series?.gasDaily ?? []).map((d) => [d.date, d.value]));
  return imp.map((d) => {
    const exp = expByDate.get(d.date) ?? 0;
    const gas = gasByDate.get(d.date) ?? 0;
    const value =
      d.value * A.importPrice - exp * A.feedInPrice + gas * A.gasPrice;
    return { date: d.date, value: Math.round(value * 100) / 100 };
  });
}

/** Fixed decision packages for the Decisions briefing (not live sliders). */
export const DECISION_PACKAGES = [
  { id: "baseline", label: "Baseline", panels: 0, batteryKWh: 0, heatPump: false, comfort: 3 },
  { id: "solar", label: "Solar", panels: 10, batteryKWh: 0, heatPump: false, comfort: 3 },
  { id: "solarBattery", label: "Solar + battery", panels: 10, batteryKWh: 8, heatPump: false, comfort: 3 },
  {
    id: "heatPump",
    label: "Heat-pump package",
    panels: 10,
    batteryKWh: 8,
    heatPump: true,
    comfort: 4,
  },
];

export function compareDecisionPackages(series) {
  const rows = DECISION_PACKAGES.map((pkg) => {
    const r = computeScenario(series, {
      panels: pkg.panels,
      batteryKWh: pkg.batteryKWh,
      heatPump: pkg.heatPump,
    });
    return {
      id: pkg.id,
      label: pkg.label,
      comfort: pkg.comfort,
      annualBill: r.scenario.costEur,
      capexEur: r.capexEur,
      paybackYears: r.paybackYears,
      co2Tonnes: r.co2Tonnes,
    };
  });
  const baselineBill = rows[0]?.annualBill ?? 0;
  return rows.map((row) => ({
    ...row,
    savingVsBaseline: baselineBill - row.annualBill,
  }));
}
