import { describe, expect, it } from "vitest";
import html from "../public/site.html?raw";

// The React-tree accessibility test in src/lib/accessibility.test.ts cannot see this file,
// so the same classes of mistake get their own check here. jsdom parses the real markup.
function doc(): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("site.html structure", () => {
  it("has exactly one h1", () => {
    expect(doc().querySelectorAll("h1")).toHaveLength(1);
  });

  it("has a lang attribute and a title", () => {
    const d = doc();
    expect(d.documentElement.getAttribute("lang")).toBeTruthy();
    expect(d.title.length).toBeGreaterThan(0);
  });

  it("has a main landmark", () => {
    expect(doc().querySelector("main")).not.toBeNull();
  });

  it("gives every image an alt attribute", () => {
    for (const img of doc().querySelectorAll("img")) {
      expect(img.getAttribute("alt"), `img ${img.getAttribute("src")} has no alt`).not.toBeNull();
    }
  });

  it("gives every link real text, never 'click here'", () => {
    for (const a of doc().querySelectorAll("a")) {
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
    const offenders = [...doc().querySelectorAll("script")]
      .filter((el) => !el.getAttribute("src"))
      .filter((el) => el.getAttribute("type") !== "application/ld+json")
      .map((el) => (el.textContent ?? "").slice(0, 60));
    expect(offenders).toEqual([]);
  });

  // Every script the page does load must be same-origin, or script-src 'self' blocks it just
  // as silently as it blocks an inline one.
  it("loads every script from this origin", () => {
    const srcs = [...doc().querySelectorAll("script")]
      .map((el) => el.getAttribute("src"))
      .filter((src) => src !== null);
    expect(srcs.length, "the chooser script is gone from site.html").toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src.startsWith("/"), src + " is not same-origin").toBe(true);
    }
  });

  // The chooser is progressive enhancement: the masthead link is a real href, so a blocked
  // or broken script leaves it doing exactly what it did before the dialog existed. Both
  // doors must be in the markup rather than built at runtime, or a no-script visitor loses
  // the kitchen entirely.
  it("offers both apps as real links, so the chooser can fail safely", () => {
    const hrefs = [...doc().querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://recipes.enamelvault.com/signin");
    expect(hrefs).toContain("https://kitchen.enamelvault.com/signin");
  });

  it("describes the site in JSON-LD that parses", () => {
    const block = doc().querySelector('script[type="application/ld+json"]');
    expect(block).not.toBeNull();
    const data = JSON.parse(block?.textContent ?? "null");
    expect(data["@type"]).toBe("WebSite");
    expect(data.url).toBe("https://enamelvault.com/");
  });

  it("carries the rack placeholder exactly once", () => {
    expect(html.match(/<!--RACK-->/g)).toHaveLength(1);
  });

  it("has a canonical pointing at the bare domain", () => {
    const canonical = doc().querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute("href")).toBe("https://enamelvault.com/");
  });

  it("offers the family action to the app's signup, and a mailto for kitchens", () => {
    const hrefs = [...doc().querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("https://recipes.enamelvault.com/signup");
    expect(hrefs.some((h) => h.startsWith("mailto:"))).toBe(true);
  });

  // The committing action sits inside a .plate, and `.plate a` colours link text with the
  // SAME vermilion that fills this button. A bare `.action` selector loses to it on
  // specificity and the label renders vermilion on vermilion: an empty red rectangle. That
  // is what shipped, and only opening the page caught it, because the contrast test measures
  // token pairs and cannot see a cascade. This is the tripwire for the override.
  it("colours the action button at a specificity that beats .plate a", () => {
    expect(html).toContain(".plate a.action");
  });

  // PRODUCT.md forbids inventing any of these, and a marketing page is where they appear
  // by accident. This is the mechanical half of that rule.
  it("claims no price, no rating and no customer count", () => {
    expect(html).not.toMatch(/\$\d|£\d|€\d|\d+\s*(?:★|stars?|reviews?|customers?|users?\b)|\bper month\b|\/mo\b/i);
  });
});
