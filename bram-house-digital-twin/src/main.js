// Entry point — delegates to bootstrap for ordered startup.
import { bootstrap } from "./bootstrap.js";
import { hideLoading } from "./panels/appShell.js";

bootstrap().catch((e) => {
  console.error("App failed to start:", e);
  hideLoading();
  document.getElementById("dashboard").innerHTML =
    `<p class="panel-kicker">twinlink.eu</p><h3>Startup error</h3><p class="muted">${e.message}</p>`;
});
