// Opens the Scenarios tab in the full energy analytics workspace.
import { openChartsDashboard } from "../panels/energyCharts.js";

let summaryRef = null;

export function initWhatIf(summary) {
  summaryRef = summary;
  document.getElementById("btnWhatIf")?.addEventListener("click", () => {
    if (summaryRef) openChartsDashboard(summaryRef, "scenarios");
  });
}
