import { describe, expect, it } from "vitest";
// Vite's ?raw import, the same mechanism index.contrast.test.ts uses to read the real
// stylesheet. This test lives in src/ and not beside the Worker on purpose:
// tsconfig.worker.json carries only @cloudflare/workers-types with lib ES2023 and no DOM,
// and adding vite/client there to get ?raw would pull DOM types into the Worker project and
// mask the Worker-specific errors that config exists to catch.
import css from "./index.css?raw";
import html from "../public/site.html?raw";

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

describe("site.html colours", () => {
  const real = realTokens();

  it.each(GUARDED)("uses the real value of --%s", (name) => {
    const expected = real[name];
    expect(expected, `--${name} is missing from index.css`).toBeTruthy();
    expect(
      html.includes(expected),
      `site.html does not contain the real --${name} (${expected}). The palette moved and the landing page did not.`, 
    ).toBe(true);
  });

  // Catches the other direction: a hex typed into site.html that is not in the palette at all.
  it("contains no hex colour that is absent from index.css", () => {
    const known = new Set(Object.values(real).map((v) => v.toLowerCase()));
    const used = new Set(
      [...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()),
    );
    const strays = [...used].filter((hex) => !known.has(hex));
    expect(strays, `hex values in site.html that are in no index.css token: ${strays.join(", ")}`).toEqual([]);
  });
});
