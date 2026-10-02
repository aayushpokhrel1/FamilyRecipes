import { describe, expect, it } from "vitest";
// Vite's ?raw import, not node:fs: it keeps this test inside tsconfig.app.json, which
// deliberately has no node types so that app code cannot reach for process or fs.
import css from "./index.css?raw";

// Reads the REAL tokens out of index.css and fails if any text pair the app actually renders
// drops below WCAG AA. This exists because the palette shipped with three failures nobody
// could see by looking: vermilion button labels at 4.10:1, vermilion link text on a plate at
// 3.85:1, and vermilion links on the green wall at 2.70:1.
//
// A doc saying "keep contrast above 4.5" was not enough; nobody re-reads a doc before nudging
// a hex value. This is the thing that goes red instead.
//
// ADDING A COLOUR RULE? If it puts text of colour A on background B, add the pair below.
// An unlisted pair is an untested pair.

function tokens(blockStart: string): Record<string, string> {
  const at = css.indexOf(blockStart);
  if (at === -1) throw new Error(`block not found in index.css: ${blockStart}`);
  const body = css.slice(at, css.indexOf("\n}", at));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

const light = tokens(":root {");
const dark = { ...light, ...tokens(':root[data-theme="dark"] {') };

const srgb = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);

/** Resolves a token value to opaque [r,g,b], compositing rgba() over `over`. */
function rgb(value: string, over?: [number, number, number]): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/i);
  if (!rgba) throw new Error(`cannot parse colour: ${value}`);
  const fg = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])] as [number, number, number];
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  if (a === 1) return fg;
  if (!over) throw new Error(`a translucent colour needs a background to composite over: ${value}`);
  return fg.map((v, i) => Math.round(v * a + over[i] * (1 - a))) as [number, number, number];
}

const luminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

function ratio(fgToken: string, bgToken: string, t: Record<string, string>): number {
  const bg = rgb(t[bgToken]);
  const fg = rgb(t[fgToken], bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// [text token, background token, where this pair appears]
const PAIRS: [string, string, string][] = [
  ["ink", "plate", "body text on a plate"],
  ["ink", "plate-2", "body text on plate-2"],
  ["ink-soft", "plate", "secondary text on a plate (.form-hint, .prose .updated)"],
  ["ink-soft", "plate-2", "secondary text on plate-2"],
  ["on-wall", "wall", "text on the wall"],
  ["on-wall", "wall-deep", "header and footer text"],
  ["on-wall-soft", "wall", "secondary text on the wall"],
  ["on-wall-soft", "wall-deep", "nav links, .site-footer body"],
  ["on-action", "action", "the label on a committing button"],
  ["on-action", "action-deep", "the label on a committing button, hovered"],
  ["chip-ink", "chip", "tin-label chip text"],
  ["action", "plate", ".plate a / .prose a / .form-error, the plate vermilion as text"],
  ["action", "plate-2", "the plate vermilion as text on plate-2"],
  ["action-lit", "wall", "base `a`, the wall vermilion as text"],
  ["action-lit", "wall-deep", "links in the header and footer"],
  ["spark", "wall", ".cook-count"],
  ["spark", "wall-deep", ".recipe-meta span b, whose span is wall-deep"],
];

// A focus ring is a non-text UI boundary: WCAG 1.4.11 asks 3:1, not 4.5:1.
const RINGS: [string, string, string][] = [
  ["action-lit", "wall", "focus ring on the wall"],
  ["action-lit", "wall-deep", "focus ring in the header"],
  ["action", "plate", "focus ring inside a plate"],
  ["action", "plate-2", "focus ring inside plate-2"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s mode", (_mode, t) => {
  it.each(PAIRS)("%s on %s reaches AA 4.5:1 (%s)", (fg, bg) => {
    expect(ratio(fg, bg, t)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(RINGS)("%s on %s reaches 3:1 for a UI boundary (%s)", (fg, bg) => {
    expect(ratio(fg, bg, t)).toBeGreaterThanOrEqual(3);
  });
});
