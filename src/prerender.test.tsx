import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PRERENDER_PAGES } from "./prerender";
// Across the src/worker line on purpose, and only in a test: this is the check that keeps
// the sitemap's promises and the prerendered pages from drifting apart, and it can only do
// that by reading the real list rather than a copy of it.
import { STATIC_SITEMAP_PATHS } from "../worker/meta";

const render = (path: string): string =>
  renderToString(<MemoryRouter initialEntries={[path]}>{PRERENDER_PAGES[path].element}</MemoryRouter>);

describe("PRERENDER_PAGES", () => {
  // The sitemap is the list of promises made to Google. Anything on it that is not here
  // ships an empty #root to the crawler it was promised to.
  it("covers every static path the sitemap offers Google", () => {
    for (const path of STATIC_SITEMAP_PATHS) {
      expect(PRERENDER_PAGES[path], `${path} is in the sitemap but not prerendered`).toBeDefined();
    }
  });

  it("prerenders nothing the sitemap does not offer", () => {
    for (const path of Object.keys(PRERENDER_PAGES)) {
      expect(STATIC_SITEMAP_PATHS, `${path} is prerendered but not in the sitemap`).toContain(path);
    }
  });

  // A silently empty fragment is worse than no fragment: the page ships an empty #root to a
  // crawler while the build, the tests and the deploy all report success.
  it("renders real prose for each page, not an empty shell", () => {
    for (const path of Object.keys(PRERENDER_PAGES)) {
      const html = render(path);
      expect(html.length, `${path} rendered almost nothing`).toBeGreaterThan(500);
      expect(html, `${path} is missing its own h1`).toContain(PRERENDER_PAGES[path].h1);
    }
  });

  it("renders the plate and prose classes both pages need", () => {
    for (const path of Object.keys(PRERENDER_PAGES)) {
      const html = render(path);
      expect(html, `${path} lost a class that recolours its headings`).toContain("prose plate");
    }
  });
});
