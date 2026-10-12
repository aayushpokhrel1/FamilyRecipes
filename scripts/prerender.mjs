// Writes the body fragment for each public document into dist/prerender/, to be injected into
// #root by the Worker. Run from `npm run build`, AFTER the SSR build that produces
// dist-ssr/prerender.js, so Cloudflare regenerates the fragments on every deploy and they
// cannot go stale in production.
//
// Deliberately thin, and it must stay thin: every decision worth testing lives in
// src/prerender.tsx and src/prerender.test.tsx, which the suite runs. This file only renders
// and writes.
import { mkdir, writeFile } from "node:fs/promises";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PRERENDER_PAGES } from "../dist-ssr/prerender.js";

const OUT_DIR = new URL("../dist/prerender/", import.meta.url);
await mkdir(OUT_DIR, { recursive: true });

for (const [path, page] of Object.entries(PRERENDER_PAGES)) {
  const html = renderToString(
    createElement(MemoryRouter, { initialEntries: [path] }, page.element),
  );
  // A fragment that rendered to nothing would ship an empty #root while every step reported
  // success, so fail the BUILD rather than deploy it. src/prerender.test.tsx checks the same
  // thing in the suite; this is the one that cannot be skipped by not running the tests.
  if (!html.includes(page.h1)) {
    throw new Error(`prerender: ${path} rendered without its h1 (${page.h1})`);
  }
  const name = `${path.replace(/^\//, "")}.html`;
  await writeFile(new URL(name, OUT_DIR), html, "utf8");
  console.log(`prerender: ${name} (${html.length} bytes)`);
}
