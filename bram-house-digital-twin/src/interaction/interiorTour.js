// Guided building tour — visits every room with the shared interior camera.
import { setRoomsVisible, getWaypoints } from "../viewer/geojsonRooms.js";
import { playRoomTour, stopRoomTour } from "./roomFly.js";
import { stopRoomExplore } from "./roomExplore.js";

let touring = false;

function caption(html) {
  const el = document.getElementById("tourCaption");
  if (!el) return;
  el.style.display = html ? "block" : "none";
  el.innerHTML = html ?? "";
}

export async function toggleTour() {
  if (touring) {
    touring = false;
    stopRoomTour();
    return;
  }
  stopRoomExplore();
  const wps = getWaypoints();
  if (!wps.length) {
    caption("No rooms loaded — cannot tour.");
    setTimeout(() => caption(null), 2500);
    return;
  }

  touring = true;
  document.getElementById("btnTour")?.classList.add("active");

  for (let i = 0; i < wps.length && touring; i++) {
    const w = wps[i];
    if (!w.room_id) continue;
    caption(`<b>${w.name}</b> — ${w.floor} <span class="muted">(${i + 1}/${wps.length}, Esc to stop)</span>`);
    await playRoomTour(w.room_id, { skipOrbit: false, panMs: 2000, keepCaption: true });
    if (!touring) break;
  }

  endTour();
}

function endTour() {
  touring = false;
  stopRoomTour();
  document.getElementById("btnTour")?.classList.remove("active");
  caption(null);
  setRoomsVisible(true);
}

export { toggleRoomExplore as toggleWalk } from "./roomExplore.js";

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && touring) endTour();
});
