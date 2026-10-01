import { describe, it, expect } from "vitest";
import { htmlToText, MAX_INPUT_CHARS } from "./htmlText";

describe("htmlToText", () => {
  it("drops scripts, styles and markup, keeping the visible text", () => {
    const html = `<html><head><style>.a{color:red}</style></head><body>
      <script>var tracking=1;</script>
      <h1>Dal</h1><ul><li>1 cup lentils</li><li>2 tomatoes</li></ul></body></html>`;
    const out = htmlToText(html);
    expect(out).toContain("Dal");
    expect(out).toContain("1 cup lentils");
    expect(out).not.toContain("tracking");
    expect(out).not.toContain("color:red");
  });

  // THE BUG THIS GUARDS: stripping every script removed the only copy of the content on a
  // real page, leaving zero characters. ld+json is where modern recipe sites put the recipe.
  it("keeps ld+json, which is where the recipe often actually lives", () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"Recipe","name":"Momo"}</script>
      <script>var ads=1;</script>
      <p>some prose</p></body></html>`;
    const out = htmlToText(html);
    expect(out).toContain('"@type":"Recipe"');
    expect(out).toContain("Momo");
    expect(out).not.toContain("ads");
  });

  it("puts ld+json before the prose so the cap never cuts the structured part", () => {
    const html = `<body><p>${"x".repeat(500)}</p>
      <script type="application/ld+json">{"name":"Keep me"}</script></body>`;
    const out = htmlToText(html, 60);
    expect(out).toContain("Keep me");
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it("caps the output, because one page used to be a whole minute's token quota", () => {
    const html = "<body>" + "<p>ingredient</p>".repeat(20000) + "</body>";
    const out = htmlToText(html);
    expect(out.length).toBeLessThanOrEqual(MAX_INPUT_CHARS);
    // and the cap is the reason this is worth doing at all
    expect(html.length).toBeGreaterThan(MAX_INPUT_CHARS * 10);
  });

  it("keeps list items on separate lines", () => {
    const out = htmlToText("<ul><li>1 cup rice</li><li>2 cups water</li></ul>");
    expect(out.split("\n").filter((l) => l.trim())).toEqual(["1 cup rice", "2 cups water"]);
  });

  it("decodes the entities that carry meaning in a recipe", () => {
    const out = htmlToText("<p>Heat to 180&deg;C, add &frac12; tsp salt &amp; stir &#188; cup</p>");
    expect(out).toContain("180°C");
    expect(out).toContain("1/2 tsp");
    expect(out).toContain("salt & stir");
    expect(out).toContain("¼ cup");
  });

  it("returns empty for empty input rather than throwing", () => {
    expect(htmlToText("")).toBe("");
  });
});
