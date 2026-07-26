/**
 * Application bootstrap — ordered startup inspired by Gate Digital Twin:
 * 1. Viewer (Cesium scene)
 * 2. Static geometry (rooms GeoJSON)
 * 3. Data layer (energy CSV summary)
 * 4. Interaction (clicks, navigation, appliances)
 * 5. Panels (dashboard, charts)
 * 6. Simulation (time machine, what-if)
 * 7. Optional assets (IFC shell, context buildings, view controls)
 */
import { initViewer, loadBuildingShell, frameBuildingTileset, resetCamera } from "./viewer/cesiumViewer.js";
import { initViewControls, clearClipPlanes } from "./viewer/viewControls.js";
import { initVisualizationLab } from "./viewer/visualizationLab.js";
import { loadRooms, roomEntities } from "./viewer/geojsonRooms.js";
import { initRoomInteraction, setEnergySummary } from "./interaction/roomInteraction.js";
import { loadEnergySummary } from "./data/energyDataService.js";
import { loadSensorReadings } from "./data/sensorDataService.js";
import { buildIaqHistory } from "./data/iaqHistoryService.js";
import { renderDashboard, showIfcLoadStatus } from "./panels/dashboard.js";
import { initChartsDashboard } from "./panels/energyCharts.js";
import { initRoomNavigator, refreshRoomNavIAQ } from "./interaction/roomNavigator.js";
import { initViewerNavigation } from "./interaction/roomExplore.js";
import { initIaqAnalytics } from "./panels/iaqAnalytics.js";
import { renderEcoHud } from "./panels/gamification.js";
import { initWhatIf } from "./simulation/whatIf.js";
import { initAppliances } from "./interaction/appliances.js";
import { initChatbot } from "../chatbot/ui.js";
import {
  initAppShell,
  showLoading,
  hideLoading,
  showIntroAfterLoad,
  initLayoutShell,
} from "./panels/appShell.js";

export async function bootstrap() {
  initAppShell();
  initLayoutShell();
  showLoading("Initializing 3D viewer…");

  // Phase 1 — viewer
  await initViewer();
  showLoading("Loading rooms & energy data…");

  // Phase 2 & 3 — geometry + building energy data (parallel)
  const [roomsInfo, energySummary] = await Promise.all([
    loadRooms(),
    loadEnergySummary(),
  ]);

  setEnergySummary(energySummary);

  await loadSensorReadings(roomEntities);
  buildIaqHistory(roomEntities);

  // Phase 4 — interaction (navigator hooks before room clicks)
  initRoomNavigator();
  initRoomInteraction();
  initViewerNavigation();
  refreshRoomNavIAQ();

  // Phase 5 — panels
  renderDashboard(energySummary, roomsInfo);
  initChartsDashboard();

  // Phase 6 — simulation & gamification
  initIaqAnalytics();
  renderEcoHud(energySummary);
  initWhatIf(energySummary);

  // Phase 7 — optional 3D assets + appliances (IFC picking)
  const shellPromise = loadBuildingShell();
  initViewControls(shellPromise.then((r) => r?.tileset ?? null));
  initVisualizationLab(energySummary);
  const shellResult = await shellPromise;
  showIfcLoadStatus({ ok: !!shellResult?.tileset, error: shellResult?.error });
  if (shellResult?.tileset) {
    clearClipPlanes();
    frameBuildingTileset(shellResult.tileset);
  } else {
    resetCamera();
  }
  await initAppliances(Promise.resolve(shellResult?.tileset ?? null));
  initChatbot();

  hideLoading();
  showIntroAfterLoad();

  return { roomsInfo, energySummary };
}
