import { describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  RACK_PLACEHOLDER,
  buildRack,
  isSiteHost,
  renderSite,
  siteRobots,
  siteSitemap,
  type SiteCard,
} from "./site";

const CARD: SiteCard = {
  id: "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  title: "Dal Bhat",
  hasPhoto: true,
};

describe("isSiteHost", () => {
  it("accepts the bare domain and its www form", () => {
    expect(isSiteHost("enamelvault.com")).toBe(true);
    expect(isSiteHost("www.enamelvault.com")).toBe(true);
  });

  // The whole app lives on the app host. Getting this wrong serves the landing page
  // where the SPA should be, or the SPA on the marketing host as duplicate content.
  it("rejects the app host", () => {
    expect(isSiteHost("recipes.enamelvault.com")).toBe(false);
  });

  it("is case insensitive, because a Host header need not be lowercase", () => {
    expect(isSiteHost("EnamelVault.com")).toBe(true);
  });

  // A lookalike must not match: enamelvault.com.evil.example would otherwise be served
  // our page, and anything built on isSiteHost later would trust the wrong origin.
  it("rejects a host that merely ends with or contains the domain", () => {
    expect(isSiteHost("enamelvault.com.evil.example")).toBe(false);
    expect(isSiteHost("notenamelvault.com")).toBe(false);
  });
});

describe("buildRack", () => {
  it("links each card to its public page on the APP host, not the bare one", () => {
    const html = buildRack([CARD]);
    expect(html).toContain(`${APP_ORIGIN}/recipes/${CARD.id}`);
  });

  it("uses the og proxy for a card that has a photo, and gives it real alt text", () => {
    const html = buildRack([CARD]);
    expect(html).toContain(`${APP_ORIGIN}/og/recipe/${CARD.id}.jpg`);
    expect(html).toContain('alt="Dal Bhat"');
  });

  // A decorative image with no photo must not claim to be one, and an empty alt on a
  // missing image is better than inventing a description.
  it("omits the image entirely when there is no photo", () => {
    const html = buildRack([{ ...CARD, hasPhoto: false }]);
    expect(html).not.toContain("/og/recipe/");
  });

  // The title comes from user input and lands in both text and an attribute.
  it("escapes a title that contains markup", () => {
    const html = buildRack([{ ...CARD, title: 'Nan & <script>"x"' }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  // Zero public recipes is reachable: unpublishing is one click per recipe.
  it("returns an empty string for no cards, so the section can be dropped", () => {
    expect(buildRack([])).toBe("");
  });

  // The heading travels WITH the cards. If it lived in site.html instead, the degraded
  // path would serve a heading above an empty space, which is worse than no section.
  it("carries its own heading, so nothing is left dangling when there are no cards", () => {
    expect(buildRack([CARD])).toContain("<h2>");
    expect(buildRack([])).not.toContain("<h2>");
  });
});

describe("renderSite", () => {
  it("replaces the placeholder with the rack", () => {
    const out = renderSite(`<main>${RACK_PLACEHOLDER}</main>`, [CARD]);
    expect(out).not.toContain(RACK_PLACEHOLDER);
    expect(out).toContain(`${APP_ORIGIN}/recipes/${CARD.id}`);
  });

  // The degraded path. The page must still serve, and must not serve a visible comment
  // or an empty heading where the rack was.
  it("removes the placeholder when there are no cards", () => {
    const out = renderSite(`<main>${RACK_PLACEHOLDER}</main>`, []);
    expect(out).toBe("<main></main>");
  });

  // A template that lost its placeholder is a template whose rack silently vanishes.
  it("returns the template unchanged when the placeholder is absent", () => {
    expect(renderSite("<main></main>", [CARD])).toBe("<main></main>");
  });
});

describe("siteRobots", () => {
  it("allows everything and points at the bare host's own sitemap", () => {
    const body = siteRobots();
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://enamelvault.com/sitemap.xml");
  });

  // The template is an asset, so it is fetchable by path. It is not a page and must
  // never be indexed as one.
  it("disallows the raw template", () => {
    expect(siteRobots()).toContain("Disallow: /site.html");
  });
});

describe("siteSitemap", () => {
  it("lists exactly the one page this host serves", () => {
    const xml = siteSitemap();
    expect(xml).toContain("<loc>https://enamelvault.com/</loc>");
    expect(xml.match(/<loc>/g)).toHaveLength(1);
  });
});
