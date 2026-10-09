// The landing page on the bare domain. Pure helpers only: worker/index.ts does the I/O.
//
// NO HTMLRewriter HERE, deliberately, even though worker/index.ts uses it for the per-recipe
// OpenGraph tags. HTMLRewriter is a Worker runtime global with no implementation under
// Vitest, which is exactly why worker/index.ts has no unit test and every testable helper
// lives in a file like this one. A comment placeholder plus a string replace keeps all of
// the logic that could be wrong inside a test.
import { escapeAttr } from "./meta";

export const SITE_HOST = "enamelvault.com";
export const APP_ORIGIN = "https://recipes.enamelvault.com";
export const SITE_ORIGIN = `https://${SITE_HOST}`;

// A comment, so the template is valid HTML that opens correctly in a browser on its own.
export const RACK_PLACEHOLDER = "<!--RACK-->";

export type SiteCard = { id: string; title: string; hasPhoto: boolean };

// Exact match on the apex or its www form. NOT endsWith: enamelvault.com.evil.example would
// pass that, and anything that later trusts this host would be trusting an attacker's.
export function isSiteHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === SITE_HOST || host === `www.${SITE_HOST}`;
}

// Cards link to the APP host. The recipe pages already live there, already carry their own
// OpenGraph tags and are already in that host's sitemap; serving or claiming them here would
// create a second canonical for a page that already has one.
export function buildRack(cards: SiteCard[]): string {
  if (cards.length === 0) return "";
  const items = cards
    .map((card) => {
      const title = escapeAttr(card.title);
      // The og proxy, not a signed storage URL: it stays revocable, which is the whole
      // reason /og/recipe/:id.jpg exists rather than a redirect.
      const image = card.hasPhoto
        ? `<img src="${APP_ORIGIN}/og/recipe/${card.id}.jpg" alt="${title}" width="320" height="168" loading="lazy">`
        : "";
      return [
        `<li class="rack-item">`,
        `<a class="plate rack-card" href="${APP_ORIGIN}/recipes/${card.id}">`,
        image,
        `<span class="rack-title">${title}</span>`,
        `</a>`,
        `</li>`,
      ].join("");
    })
    .join("");
  return `<ul class="rack">${items}</ul>`;
}

// Returns the template untouched if the placeholder is gone, rather than throwing: a page
// that serves without its rack is a far better failure than a page that does not serve.
export function renderSite(template: string, cards: SiteCard[]): string {
  return template.replace(RACK_PLACEHOLDER, buildRack(cards));
}

export function siteRobots(): string {
  return [
    "# The marketing page. The app, and everything that needs a session, is on",
    "# recipes.enamelvault.com and carries its own robots.txt.",
    "User-agent: *",
    "Allow: /",
    "",
    "# The raw template, placeholders and all. Fetchable because it is an asset; never a page.",
    "Disallow: /site.html",
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

export function siteSitemap(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${SITE_ORIGIN}/</loc>`,
    "  </url>",
    "</urlset>",
    "",
  ].join("\n");
}
