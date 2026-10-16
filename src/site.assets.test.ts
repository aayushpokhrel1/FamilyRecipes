// EVERY SAME-ORIGIN FILE A MARKETING PAGE REFERENCES MUST BE SERVED BY THE BARE HOST.
//
// This exists because it had already gone wrong, unnoticed, in production. site.html loaded
// /signin-choice.js, which was not in the SITE_ASSET allowlist in worker/site.ts, so the bare
// host 302'd it to the app host. That makes it cross-origin, script-src 'self' refuses it,
// and a blocked script does not warn: the sign-in chooser dialog never opened from the day it
// shipped. The masthead link is a real href, so the page looked and behaved exactly as it had
// before the chooser existed, which is why nobody caught it and why no existing test could.
//
// It is the SAME failure the fonts had in 2026-09, which the comment on SITE_ASSET records in
// detail, repeated the first time a page referenced a new kind of file. A comment did not
// stop it happening twice, so this reads the real markup instead and will catch the third.
//
// It lives in src/ rather than beside the Worker because it needs Vite's ?raw to read the
// HTML, and tsconfig.worker.json deliberately carries no DOM or vite types. The same reason
// src/site.tokens.test.ts gives.
import { describe, expect, it } from "vitest";
import professionalHtml from "../public/professional.html?raw";
import siteHtml from "../public/site.html?raw";
import { SITE_PAGES, isSiteAsset, sitePageAsset } from "../worker/site";

const PAGES: Record<string, string> = {
  "/site.html": siteHtml,
  "/professional.html": professionalHtml,
};

describe("the marketing pages reference nothing the bare host redirects away", () => {
  // If a page is added to the Worker and not here, this file would silently stop covering
  // it, which is the exact shape of the bug above.
  it("reads every page the Worker serves", () => {
    expect(Object.keys(PAGES).sort()).toEqual(Object.values(SITE_PAGES).sort());
  });

  it.each(Object.keys(PAGES))("%s references only files the bare host serves", (name) => {
    const html = PAGES[name];
    // src= and href= beginning with a single slash: same-origin and absolute. A full URL is
    // another host and not this allowlist's business; the CSP covers those.
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((match) => match[1]);
    expect(
      refs.length,
      "no same-origin references found at all, so this test is checking nothing",
    ).toBeGreaterThan(0);

    const stranded = refs.filter((ref) => !isSiteAsset(ref) && sitePageAsset(ref) === null);
    expect(
      stranded,
      `${name} references ${stranded.join(", ")}, which the bare host 302s to the app host. ` +
        "Cross-origin, so the CSP refuses it and the failure is silent. " +
        "Add it to SITE_ASSET in worker/site.ts.",
    ).toEqual([]);
  });

  // The guard above is only worth anything if isSiteAsset actually refuses things. Without
  // this, a regex widened to /^\// would make every assertion above pass forever.
  it("still refuses a path the app host owns", () => {
    expect(isSiteAsset("/index.html")).toBe(false);
    expect(isSiteAsset("/assets/index-a1b2c3.js")).toBe(false);
    expect(isSiteAsset("/recipes/abc")).toBe(false);
  });

  it("serves the two files the pages actually need", () => {
    expect(isSiteAsset("/site.css")).toBe(true);
    expect(isSiteAsset("/signin-choice.js")).toBe(true);
  });
});
