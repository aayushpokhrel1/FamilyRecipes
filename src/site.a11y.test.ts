import { describe, expect, it } from "vitest";
import css from "../public/site.css?raw";
import professionalHtml from "../public/professional.html?raw";
import siteHtml from "../public/site.html?raw";

// The React-tree accessibility test in src/lib/accessibility.test.ts cannot see these files,
// so the same classes of mistake get their own check here. jsdom parses the real markup.
//
// THERE ARE TWO MARKETING PAGES NOW, and every structural rule below runs against BOTH.
// The repo has already paid for the other arrangement: src/routes.terms.test.ts checked one
// of two routers, and the kitchen app shipped its entire surface ungated with the suite
// green, because a guard covering one of two things reports success for the thing it cannot
// see. ADDING A PAGE? Add it to PAGES. An unlisted page is an unchecked page.
const PAGES = [
  { name: "site.html", html: siteHtml, canonical: "https://enamelvault.com/" },
  {
    name: "professional.html",
    html: professionalHtml,
    canonical: "https://enamelvault.com/professional",
  },
] as const;

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe.each(PAGES)("$name structure", ({ html, canonical }) => {
  it("has exactly one h1", () => {
    expect(doc(html).querySelectorAll("h1")).toHaveLength(1);
  });

  it("has a lang attribute and a title", () => {
    const d = doc(html);
    expect(d.documentElement.getAttribute("lang")).toBeTruthy();
    expect(d.title.length).toBeGreaterThan(0);
  });

  // Two pages sharing a <title> is two pages competing for the same search, which is the
  // thing the second page was added to avoid. Checked across the set, below.
  it("has a title that says what the page is", () => {
    expect(doc(html).title.length).toBeGreaterThan(20);
  });

  it("has a meta description", () => {
    const description = doc(html).querySelector('meta[name="description"]');
    expect(description?.getAttribute("content")?.length ?? 0).toBeGreaterThan(50);
  });

  it("has a main landmark", () => {
    expect(doc(html).querySelector("main")).not.toBeNull();
  });

  it("gives every image an alt attribute", () => {
    for (const img of doc(html).querySelectorAll("img")) {
      expect(img.getAttribute("alt"), `img ${img.getAttribute("src")} has no alt`).not.toBeNull();
    }
  });

  it("gives every link real text, never 'click here'", () => {
    for (const a of doc(html).querySelectorAll("a")) {
      const text = (a.textContent ?? "").trim();
      expect(text.length, `a link to ${a.getAttribute("href")} has no text`).toBeGreaterThan(0);
      expect(text.toLowerCase()).not.toBe("click here");
    }
  });

  // The CSP is script-src 'self' and a blocked INLINE script fails SILENTLY: no error, no
  // console warning, it simply never runs. That is the whole hazard, and it is why the
  // family app's theme bootstrap lives in public/theme-init.js.
  //
  // This used to assert that the page carried NO script of any kind, which was stricter than
  // its own reason: a same-origin src is exactly what script-src 'self' permits. The page
  // genuinely ran nothing until the sign-in chooser needed to open a dialog, and widening
  // this was the deliberate moment to decide that. What must never come back is an inline
  // block, so that is what is checked now.
  //
  // A JSON-LD block is a data island the browser never executes, and stays allowed.
  it("runs no inline script, which the CSP would silently refuse", () => {
    const offenders = [...doc(html).querySelectorAll("script")]
      .filter((el) => !el.getAttribute("src"))
      .filter((el) => el.getAttribute("type") !== "application/ld+json")
      .map((el) => (el.textContent ?? "").slice(0, 60));
    expect(offenders).toEqual([]);
  });

  // Every script the page does load must be same-origin, or script-src 'self' blocks it just
  // as silently as it blocks an inline one. Whether the bare host actually SERVES that
  // same-origin path is a separate failure with the same symptom; src/site.assets.test.ts
  // holds that half, and it is the half that was broken in production.
  it("loads every script from this origin", () => {
    const srcs = [...doc(html).querySelectorAll("script")]
      .map((el) => el.getAttribute("src"))
      .filter((src) => src !== null);
    expect(srcs.length, "the chooser script is gone").toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src.startsWith("/"), src + " is not same-origin").toBe(true);
    }
  });

  // The chooser is progressive enhancement: the masthead link is a real href, so a blocked
  // or broken script leaves it doing exactly what it did before the dialog existed. Both
  // doors must be in the markup rather than built at runtime, or a no-script visitor loses
  // one of the two apps entirely.
  it("offers both apps as real links, so the chooser can fail safely", () => {
    const hrefs = [...doc(html).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://recipes.enamelvault.com/signin");
    expect(hrefs).toContain("https://kitchen.enamelvault.com/signin");
  });

  it("describes itself in JSON-LD that parses", () => {
    const block = doc(html).querySelector('script[type="application/ld+json"]');
    expect(block).not.toBeNull();
    const data = JSON.parse(block?.textContent ?? "null");
    expect(typeof data["@type"]).toBe("string");
    expect(data.url).toBe(canonical);
  });

  it("has a canonical pointing at its own URL", () => {
    expect(doc(html).querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(canonical);
  });

  // PRODUCT.md forbids inventing any of these, and a marketing page is where they appear
  // by accident. This is the mechanical half of that rule.
  it("claims no price, no rating and no customer count", () => {
    expect(html).not.toMatch(
      /\$\d|£\d|€\d|\d+\s*(?:★|stars?|reviews?|customers?|users?\b)|\bper month\b|\/mo\b/i,
    );
  });

  it("loads the shared stylesheet rather than carrying its own copy", () => {
    expect(doc(html).querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe(
      "/site.css",
    );
    expect(doc(html).querySelector("style"), "a page grew its own <style> block").toBeNull();
  });
});

describe("the marketing pages as a set", () => {
  // Two pages with the same title or description compete for the same query, and the whole
  // reason /professional exists is that a kitchen had nothing of its own to match.
  it("gives each page a distinct title and description", () => {
    const titles = PAGES.map((page) => doc(page.html).title);
    const descriptions = PAGES.map((page) =>
      doc(page.html).querySelector('meta[name="description"]')?.getAttribute("content"),
    );
    expect(new Set(titles).size).toBe(PAGES.length);
    expect(new Set(descriptions).size).toBe(PAGES.length);
  });

  it("gives each page its own canonical", () => {
    const canonicals = PAGES.map((page) =>
      doc(page.html).querySelector('link[rel="canonical"]')?.getAttribute("href"),
    );
    expect(new Set(canonicals).size).toBe(PAGES.length);
  });

  // The homepage is the only page with a rack, because serveSite() is the only handler that
  // reads the catalogue. A placeholder on the other page would serve as a visible comment.
  it("puts the rack placeholder on the homepage and nowhere else", () => {
    expect(siteHtml.match(/<!--RACK-->/g)).toHaveLength(1);
    expect(professionalHtml).not.toContain("<!--RACK-->");
  });

  // The committing action sits inside a .plate, and `.plate a` colours link text with the
  // SAME vermilion that fills this button. A bare `.action` selector loses to it on
  // specificity and the label renders vermilion on vermilion: an empty red rectangle. That
  // is what shipped, and only opening the page caught it, because the contrast test measures
  // token pairs and cannot see a cascade. This is the tripwire for the override, and it now
  // lives in the shared stylesheet, so it protects both pages at once.
  it("colours the action button at a specificity that beats .plate a", () => {
    expect(css).toContain(".plate a.action");
  });

  // The homepage sends a kitchen reader to the page built for them rather than straight at
  // a sign-up form. If this link goes, /professional is an orphan: nothing links to it, and
  // the sitemap alone is a weak signal.
  it("links the homepage to the professional page", () => {
    const hrefs = [...doc(siteHtml).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/professional");
  });

  it("offers the family signup on the homepage and the kitchen signup on the other", () => {
    const hrefs = (html: string) =>
      [...doc(html).querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs(siteHtml)).toContain("https://recipes.enamelvault.com/signup");
    expect(hrefs(professionalHtml)).toContain("https://kitchen.enamelvault.com/signup");
  });

  // moderation@ is the only address this domain delivers to. It moved off the homepage when
  // the kitchen card became a teaser; it must still exist somewhere a kitchen can find it.
  it("keeps a way to reach a human on the professional page", () => {
    const hrefs = [...doc(professionalHtml).querySelectorAll("a")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs.some((h) => h.startsWith("mailto:"))).toBe(true);
  });

  // A chef who clicks Terms from this page must get the KITCHEN's terms. They are a
  // different document with their own version and their own acceptance gate, which is the
  // whole reason src/kitchen/components/KitchenTermsGate.tsx exists.
  it("points the professional page's footer at the kitchen's own documents", () => {
    const hrefs = [...doc(professionalHtml).querySelectorAll("footer a")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs).toContain("https://kitchen.enamelvault.com/terms");
    expect(hrefs).toContain("https://kitchen.enamelvault.com/privacy");
    expect(hrefs.some((h) => h.startsWith("https://recipes.enamelvault.com/terms"))).toBe(false);
  });
});
