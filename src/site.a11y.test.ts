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

  // The CSP is script-src 'self' and a blocked inline script fails SILENTLY, so this page
  // runs none. The ONE exception is a JSON-LD block, which is a data island the browser
  // never executes. Anything else with a type that could run is a bug.
  it("contains no executable script", () => {
    const types = [...doc().querySelectorAll("script")].map((s) => s.getAttribute("type"));
    expect(types.every((t) => t === "application/ld+json")).toBe(true);
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
