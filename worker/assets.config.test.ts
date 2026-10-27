// THE ASSET LAYER CAN SERVE THE WRONG APP, AND THIS IS WHAT STOPS IT COMING BACK.
//
// ?raw, not node:fs, for the reason worker/meta.test.ts gives: tsconfig.worker.json has no node
// types on purpose, so a test that reads the disk would also let worker/index.ts do it.
import { expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import index from "../index.html?raw";
import kitchen from "../kitchen.html?raw";
import admin from "../admin.html?raw";

// Measured on production on 2026-10-26, before the fix:
//
//     https://recipes.enamelvault.com/kitchen -> <title>Enamel Vault for kitchens</title>
//     https://recipes.enamelvault.com/admin   -> <title>Enamel Vault console</title>
//     https://recipes.enamelvault.com/site    -> the marketing template
//
// Cloudflare's default html_handling serves `kitchen.html` for `/kitchen`, and this repo keeps
// three HTML entries at the root. `/kitchen` is a REAL route in the family app, its own "My
// Kitchen" nav link, so a reload, a new tab or a bookmark handed a family cook the professional
// kitchen app, which answered "That page is not here".
//
// WHY NO TEST COULD SEE IT: react-router never asks the server, so every click-through passes.
// The failure only exists on a full page load against the real asset layer, which nothing in
// this suite runs. So what is pinned here is the CONFIGURATION, which is the one part of the
// mechanism that lives in this repo. The behaviour itself is checked by curl after a deploy;
// docs/OPERATIONS.md carries the three URLs.
it("resolves no path to a .html file by itself", () => {
  // Comments are stripped crudely: this only has to survive the one line it is looking for.
  const config = wrangler.replace(/^\s*\/\/.*$/gm, "");
  expect(
    /"html_handling"\s*:\s*"none"/.test(config),
    'wrangler.jsonc must set "html_handling": "none", or /kitchen serves the kitchen app on the family host',
  ).toBe(true);
});

it("still has the three separate entries that make this matter", () => {
  // If the repo ever stops shipping more than one root HTML entry, the rule above is guarding
  // nothing and should be reconsidered rather than carried forever.
  for (const [name, html] of [["index.html", index], ["kitchen.html", kitchen], ["admin.html", admin]] as const) {
    expect(html, `${name} is no longer a root entry`).toContain("<html");
  }
  expect(index).not.toBe(kitchen);
  expect(index).not.toBe(admin);
});
