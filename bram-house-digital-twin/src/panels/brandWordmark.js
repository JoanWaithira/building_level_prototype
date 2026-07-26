// Twinlink.eu logo — full mark (icon + twinlink.eu wordmark in one asset).
import { APP } from "../config.js";

const HEIGHTS = { xs: 28, sm: 36, md: 48, lg: 64, load: 88 };

export function brandLogoHtml(opts = {}) {
  const { size = "md", link = false, href = `https://${APP.domain}` } = opts;
  const h = HEIGHTS[size] ?? HEIGHTS.md;
  const alt = `${APP.domain} — ${APP.tagline}`;
  const img = `<img class="brand-logo brand-logo-${size}" src="${APP.logoPath}" alt="${alt}" height="${h}" />`;

  if (link) {
    return `<a class="brand-logo-link brand-logo-wrap-${size}" href="${href}" target="_blank" rel="noopener noreferrer" title="${APP.tagline}">${img}</a>`;
  }
  return `<div class="brand-logo-wrap brand-logo-wrap-${size}">${img}</div>`;
}
