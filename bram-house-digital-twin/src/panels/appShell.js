// App chrome — Twinlink.eu branding, loading screen, intro & explore guide.
import { APP } from "../config.js";
import { brandLogoHtml } from "./brandWordmark.js";
import { exitRoom } from "../interaction/roomNavigator.js";

const GUIDE_STEPS = [
  {
    icon: "🌐",
    title: "Navigate the 3D model",
    body: "Drag to rotate, scroll to zoom, and right-click to pan. Click the 3D view, then use ↑↓←→ to nudge the camera. Select a room to fly inside — then ↑↓←→ move, drag the mouse to look around, and PgUp/PgDn for height.",
  },
  {
    icon: "⚡",
    title: "Appliances",
    body: "Open Appliances in the bottom toolbar, or use the list at the top of the left column. Select an item to fly to its room and see simulated meter data (fridge, hob, washer, EV charger, etc.).",
  },
  {
    icon: "🏠",
    title: "Explore rooms",
    body: "Use the room list below appliances in the left column, or click directly on the building. Details appear in the floating panel on the viewer.",
  },
  {
    icon: "🌬",
    title: "Indoor air quality (IAQ)",
    body: "Toggle IAQ map for a CO₂ heatmap on room footprints, or start Air patrol for a guided tour of rooms with elevated CO₂.",
  },
  {
    icon: "📊",
    title: "Review building energy",
    body: "The right column shows live meters, mini charts, and a button to open full energy analytics with retrofit scenarios.",
  },
  {
    icon: "⚗",
    title: "Run what-if scenarios",
    body: "Open energy analytics from the right panel. Use the Scenarios tab — or What-if in the toolbar — to model solar, battery, and heat-pump options.",
  },
  {
    icon: "🎬",
    title: "Tour & walk inside",
    body: "Select a room to fly inside. Press <b>F</b> (or Walk in the toolbar) to move like a game — WASD / ↑↓ forward & back, ←→ strafe, drag mouse to look around.",
  },
];

export function initLayoutShell() {
  document.getElementById("toggleLeft")?.addEventListener("click", () => {
    document.getElementById("appLayout")?.classList.toggle("left-collapsed");
  });
  document.getElementById("toggleRight")?.addEventListener("click", () => {
    document.getElementById("appLayout")?.classList.toggle("right-expanded");
  });
  document.getElementById("rnExitBtn")?.addEventListener("click", exitRoom);
}

export function initAppShell() {
  renderHeader();
  renderFooter();
  renderIntroModal();
  renderGuideModal();
  wireGuideControls();
}

export function showLoading(message = "Loading digital twin…") {
  const el = document.getElementById("appLoading");
  if (!el) return;
  const msg = el.querySelector(".load-msg");
  if (msg) msg.textContent = message;
  el.classList.remove("hidden");
}

export function hideLoading() {
  document.getElementById("appLoading")?.classList.add("hidden");
}

export function openGuide() {
  document.getElementById("guideModal")?.classList.add("open");
}

export function closeGuide() {
  document.getElementById("guideModal")?.classList.remove("open");
}

export function openIntro() {
  document.getElementById("introModal")?.classList.add("open");
}

export function closeIntro() {
  document.getElementById("introModal")?.classList.remove("open");
}

/** Brief contextual explanation after the twin finishes loading. */
export function showIntroAfterLoad() {
  if (localStorage.getItem(APP.introStorageKey) === "1") return;
  openIntro();
}

export function maybeShowGuideOnFirstVisit() {
  if (localStorage.getItem(APP.guideStorageKey) === "1") return;
  openGuide();
}

function renderHeader() {
  const el = document.getElementById("appHeader");
  if (!el) return;
  el.innerHTML = `
    ${brandLogoHtml({ size: "sm", link: true })}
    <div class="header-center">
      <div class="header-building">${APP.buildingName}</div>
      <div class="header-meta">
        <span class="site-location">${APP.buildingLocation}</span>
        <span class="site-sep">·</span>
        <span class="site-project">${APP.projectName} building-level twin</span>
      </div>
    </div>
    <div class="header-actions">
      <button type="button" class="hdr-btn" id="btnOpenGuide" title="How to explore this twin">
        <span class="hdr-btn-ico">?</span> How to explore
      </button>
    </div>
  `;
}

function renderFooter() {
  const el = document.getElementById("appFooter");
  if (!el) return;
  el.innerHTML = `
    ${brandLogoHtml({ size: "xs" })}
    <div class="footer-copy">
      <div class="footer-line">${APP.buildingName} · building-level digital twin · ${APP.buildingLocation}</div>
      <div class="footer-sub">
        ${APP.projectName} WP7 · University of Twente · ITC
        <span class="footer-sep">|</span>
        <a href="https://${APP.domain}" target="_blank" rel="noopener noreferrer">${APP.domain}</a>
      </div>
    </div>
  `;
}

function renderIntroModal() {
  const el = document.getElementById("introModal");
  if (!el) return;
  el.innerHTML = `
    <div class="intro-backdrop" data-close-intro></div>
    <div class="intro-dialog" role="dialog" aria-labelledby="introTitle" aria-modal="true">
      <header class="intro-head">
        ${brandLogoHtml({ size: "lg" })}
        <button type="button" class="guide-close" data-close-intro aria-label="Close">✕</button>
      </header>
      <h2 id="introTitle">Building-level digital twin</h2>
      <p class="intro-lead">
        This application is an example of a <strong>building-level digital twin</strong> for exploring
        <strong>energy performance</strong> and <strong>indoor air quality (IAQ)</strong> room by room.
      </p>
      <div class="intro-context">
        <p>
          It is developed within the EU-funded <strong>${APP.projectName}</strong> project
          (<em>${APP.projectFullName}</em>, ${APP.deliverableRef}) as part of the
          <strong>Aadorp–Almelo Local Digital Twin</strong> — a shared decision-support environment
          for sustainable living communities in the Netherlands.
        </p>
        <ul class="intro-list">
          <li><strong>Bram House</strong> — IFC building model (OGC 3D Tiles) geolocated in Aadorp, with clickable rooms linked to GeoJSON geometry.</li>
          <li><strong>Energy</strong> — real building-level meter data (electricity, solar export, battery, gas, water) with analytics and retrofit what-if scenarios aligned with ESDL/ESSIM planning approaches.</li>
          <li><strong>IAQ</strong> — room-level indoor air quality exploration (temperature, humidity, CO₂), supporting the Household Sensor Pilot concept from the 3DxVERSE testbed.</li>
        </ul>
        <p class="intro-note muted">
          The platform supports evidence-based exploration and stakeholder dialogue — not automated
          operational control. Standards baseline includes OGC 3D Tiles, open geospatial data, and modular interoperability for European Local Digital Twin replication.
        </p>
      </div>
      <footer class="intro-foot">
        <label class="guide-dismiss">
          <input type="checkbox" id="introDontShow" />
          Don't show this again on startup
        </label>
        <div class="intro-actions">
          <button type="button" class="hdr-btn" id="introGuideBtn">How to explore</button>
          <button type="button" class="guide-start" id="introStartBtn">Start exploring</button>
        </div>
      </footer>
    </div>
  `;

  el.querySelectorAll("[data-close-intro]").forEach((node) => {
    node.addEventListener("click", () => dismissIntro(false));
  });
  document.getElementById("introStartBtn")?.addEventListener("click", () => dismissIntro(true));
  document.getElementById("introGuideBtn")?.addEventListener("click", () => {
    dismissIntro(true);
    openGuide();
  });
}

function dismissIntro(fromStartBtn) {
  const dontShow = document.getElementById("introDontShow")?.checked;
  if (fromStartBtn || dontShow) {
    localStorage.setItem(APP.introStorageKey, "1");
  }
  closeIntro();
}

function renderGuideModal() {
  const el = document.getElementById("guideModal");
  if (!el) return;
  el.innerHTML = `
    <div class="guide-backdrop" data-close-guide></div>
    <div class="guide-dialog" role="dialog" aria-labelledby="guideTitle" aria-modal="true">
      <header class="guide-head">
        <div>
          ${brandLogoHtml({ size: "md" })}
          <h2 id="guideTitle">How to explore this building twin</h2>
          <p class="guide-intro">
            Navigate the ${APP.buildingName} model, review real energy data, explore room-level IAQ,
            and run retrofit scenarios — all within the ${APP.projectName} interoperable digital twin testbed.
          </p>
        </div>
        <button type="button" class="guide-close" data-close-guide aria-label="Close">✕</button>
      </header>
      <ol class="guide-steps">
        ${GUIDE_STEPS.map(
          (s, i) => `
          <li class="guide-step">
            <span class="guide-step-num">${i + 1}</span>
            <div class="guide-step-body">
              <h3><span class="guide-step-ico">${s.icon}</span> ${s.title}</h3>
              <p>${s.body}</p>
            </div>
          </li>`,
        ).join("")}
      </ol>
      <footer class="guide-foot">
        <label class="guide-dismiss">
          <input type="checkbox" id="guideDontShow" />
          Don't show again on startup
        </label>
        <button type="button" class="guide-start" id="guideStartBtn">Start exploring</button>
      </footer>
    </div>
  `;
}

function wireGuideControls() {
  document.getElementById("btnOpenGuide")?.addEventListener("click", openGuide);

  document.getElementById("guideModal")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-guide]")) dismissGuide(false);
  });

  document.getElementById("guideStartBtn")?.addEventListener("click", () =>
    dismissGuide(true),
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.getElementById("introModal")?.classList.contains("open")) dismissIntro(false);
      if (document.getElementById("guideModal")?.classList.contains("open")) dismissGuide(false);
    }
  });
}

function dismissGuide(fromStartBtn) {
  const dontShow = document.getElementById("guideDontShow")?.checked;
  if (fromStartBtn || dontShow) {
    localStorage.setItem(APP.guideStorageKey, "1");
  }
  closeGuide();
}
