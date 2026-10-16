import { describe, expect, it } from "vitest";
// Vite's ?raw import, the same mechanism index.contrast.test.ts uses to read the real
// stylesheet. This test lives in src/ and not beside the Worker on purpose:
// tsconfig.worker.json carries only @cloudflare/workers-types with lib ES2023 and no DOM,
// and adding vite/client there to get ?raw would pull DOM types into the Worker project and
// mask the Worker-specific errors that config exists to catch.
import css from "./index.css?raw";
import familyHtml from "../public/family.html?raw";
import professionalHtml from "../public/professional.html?raw";
import css2 from "../public/site.css?raw";
import siteHtml from "../public/site.html?raw";

// The palette moved out of site.html into the shared stylesheet when the marketing pages
// became three. The SECOND COPY is now site.css, so that is what gets compared, and every
// HTML page is checked separately for a hex typed straight into the markup.
const html = css2;

// The landing page is static HTML, so its colours are a SECOND copy of the palette. A second
// copy drifts. This is the guard that makes the not-React decision safe: change a token in
// index.css without changing site.html and this goes red.
//
// ADDING A COLOUR TO site.html? Add it here. An unlisted colour is an unguarded copy.
const GUARDED = [
  "wall",
  "wall-deep",
  "plate",
  "rim",
  "ink",
  "ink-soft",
  "on-wall",
  "action",
  "action-deep",
  "action-lit",
  "on-action",
] as const;

function realTokens(): Record<string, string> {
  const at = css.indexOf(":root {");
  if (at === -1) throw new Error("no :root block in index.css");
  const body = css.slice(at, css.indexOf("\n}", at));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

describe("site.css colours", () => {
  const real = realTokens();

  it.each(GUARDED)("uses the real value of --%s", (name) => {
    const expected = real[name];
    expect(expected, `--${name} is missing from index.css`).toBeTruthy();
    expect(
      html.includes(expected),
      `site.css does not contain the real --${name} (${expected}). The palette moved and the marketing pages did not.`,
    ).toBe(true);
  });

  // Catches the other direction: a hex that is not in the palette at all. Run over the
  // stylesheet AND every page, because an inline style attribute bypasses the stylesheet
  // entirely and is exactly where a one-off colour gets typed.
  it.each([
    ["site.css", css2],
    ["site.html", siteHtml],
    ["family.html", familyHtml],
    ["professional.html", professionalHtml],
  ])("%s contains no hex colour that is absent from index.css", (_name, source) => {
    const known = new Set(Object.values(real).map((v) => v.toLowerCase()));
    const used = new Set(
      [...source.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()),
    );
    const strays = [...used].filter((hex) => !known.has(hex));
    expect(strays, `hex values that are in no index.css token: ${strays.join(", ")}`).toEqual([]);
  });
});
