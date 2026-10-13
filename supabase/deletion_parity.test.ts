import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// THERE ARE TWO WAYS TO DELETE AN ACCOUNT AND THEY MUST ERASE THE SAME THING.
//
// `delete-account` is the user deleting themselves. `admin`'s `delete_user` is a moderator
// deleting someone. Both blank the profile row rather than removing it, because migration
// 0014 dropped the foreign key to auth.users so recipes can keep pointing at it.
//
// On 2026-10-12 a security audit found they had drifted. 0014's comment recorded that the
// flow leaves "no identity", which was true when it was written, with four columns on the
// table. 0020 then added `handle`, `public_name` and `bio`, and only the admin path was
// updated. The `public_cooks` view selects every profile `where handle is not null`, so a
// self-deleted cook stayed listed: /cooks/<handle> kept serving their name and bio, the
// sitemap kept offering it to crawlers, and public_recipe_bylines kept their name beside
// every public recipe they had left behind. The privacy page promises the opposite.
//
// The failure was not that either path was wrong in isolation. It was that they drifted,
// silently, four years of migrations apart. So this test does not check a fixed list of
// columns: a fixed list is one more thing to forget when the next column is added. It
// checks that the two paths blank THE SAME SET, whatever that set becomes.
const root = process.cwd();
const selfPath = "supabase/functions/delete-account/index.ts";
const adminPath = "supabase/functions/admin/index.ts";
const self = readFileSync(resolve(root, selfPath), "utf8");
const admin = readFileSync(resolve(root, adminPath), "utf8");

/** The keys of the object literal passed to `.update({...})` on the profiles table. */
function blankedColumns(source: string): string[] {
  // The blanking update is the one that sets display_name to the tombstone string.
  const call = /\.from\("profiles"\)\s*\n?\s*\.update\(\{([\s\S]*?)\}\)/g;
  for (const m of source.matchAll(call)) {
    const body = m[1];
    if (!/display_name\s*:/.test(body)) continue;
    return [...body.matchAll(/^\s*([a-z_]+)\s*:/gim)].map((k) => k[1]).sort();
  }
  return [];
}

it("finds a profile-blanking update in both deletion paths", () => {
  // If this goes red, the regex above has drifted from the code and the real check below is
  // silently passing on two empty lists. A guard that cannot see its subject guards nothing.
  expect(blankedColumns(self).length, `${selfPath} has no recognisable blanking update`)
    .toBeGreaterThan(0);
  expect(blankedColumns(admin).length, `${adminPath} has no recognisable blanking update`)
    .toBeGreaterThan(0);
});

it("blanks exactly the same profile columns from both deletion paths", () => {
  // `is_moderator` is the one legitimate asymmetry: a moderator deleting someone also clears
  // the flag, and a user deleting themselves cannot hold it meaningfully. Everything else
  // must match, including every column added to profiles from now on.
  const ignore = new Set(["is_moderator"]);
  const selfCols = blankedColumns(self).filter((c) => !ignore.has(c));
  const adminCols = blankedColumns(admin).filter((c) => !ignore.has(c));
  expect(selfCols).toEqual(adminCols);
});

it("blanks every profile column that public_cooks exposes", () => {
  // The view is what makes a surviving column publicly visible, so it, not a hand-written
  // list, defines what deletion has to erase. Read the real view out of the migration.
  const sqlPath = resolve(root, "supabase/migrations/0020_public_identity.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const view = /create\s+(?:or\s+replace\s+)?view\s+public_cooks\s+as\s+select([\s\S]*?)from/i.exec(sql);
  expect(view, "public_cooks view not found in 0020").not.toBeNull();
  const exposed = view![1]
    .split(",")
    .map((c) => c.trim().split(/\s+/).pop()!.replace(/^.*\./, ""))
    .filter((c) => c && c !== "id");

  const selfCols = new Set(blankedColumns(self));
  const missing = exposed.filter((c) => !selfCols.has(c));
  expect(missing, `columns public_cooks exposes that self-deletion leaves populated`).toEqual([]);
});
