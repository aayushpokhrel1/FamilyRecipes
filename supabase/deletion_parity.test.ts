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

/**
 * The TABLES each path deletes rows from, and the buckets it clears.
 *
 * The original drift was in the blanked COLUMNS, so that is what the checks above measure.
 * Nothing measured the rows, and the two paths delete from four tables now (`meal_plans`,
 * `family_members`, `recipe_drafts`, `follows`) plus the `avatars` bucket. Four chances to
 * add the fifth to one path and not the other, in exactly the way `handle`, `public_name` and
 * `bio` were added to one and not the other for four years of migrations.
 *
 * A fixed list is deliberately not asserted here either, for the reason the file already
 * gives: a fixed list is one more thing to forget. What must hold is that the two agree.
 */
function deletedTables(source: string): string[] {
  const calls = /\.from\("([a-z_]+)"\)\s*\n?\s*\.delete\(\)/g;
  return [...new Set([...source.matchAll(calls)].map((m) => m[1]))].sort();
}

function clearedBuckets(source: string): string[] {
  const calls = /storage\s*\n?\s*\.from\("([a-z-]+)"\)\s*\n?\s*\.remove\(/g;
  return [...new Set([...source.matchAll(calls)].map((m) => m[1]))].sort();
}

it("finds the row deletions and the bucket clearing in both paths", () => {
  // Same reason as the sibling check above: a guard that cannot see its subject guards
  // nothing, and both regexes here are reading formatted TypeScript rather than SQL.
  expect(deletedTables(self).length, `${selfPath} has no recognisable row deletions`)
    .toBeGreaterThan(0);
  expect(deletedTables(admin).length, `${adminPath} has no recognisable row deletions`)
    .toBeGreaterThan(0);
  expect(clearedBuckets(self), `${selfPath} must clear the avatar object, not only the column`)
    .toContain("avatars");
  expect(clearedBuckets(admin), `${adminPath} must clear the avatar object, not only the column`)
    .toContain("avatars");
});

it("deletes rows from the same tables, and clears the same buckets, from both paths", () => {
  expect(deletedTables(self)).toEqual(deletedTables(admin));
  expect(clearedBuckets(self)).toEqual(clearedBuckets(admin));
});

it("erases the personal rows that used to outlive the account", () => {
  // Not a parity check: this one names the three, because each was found surviving on
  // 2026-10-13 and a parity test is satisfied by both paths being wrong together.
  //
  //   - recipe_drafts: unfinished recipes. drafts_read is author_id = auth.uid(), so once
  //     the login is gone nobody can ever read one again. Retained for ever, serving
  //     nothing.
  //   - follows: a relationship, not a vault. The deleted cook stayed inside other
  //     people's follower lists and counts.
  //   - the avatars bucket: nulling avatar_url hides the picture, it does not erase it. The
  //     privacy page says the photo is erased, which was false until the object was removed.
  for (const [path, source] of [[selfPath, self], [adminPath, admin]] as const) {
    const tables = deletedTables(source);
    expect(tables, `${path} must delete the cook's drafts`).toContain("recipe_drafts");
    expect(tables, `${path} must delete the cook's follows`).toContain("follows");
  }
});

it("keeps what a family is relying on, which is the whole reason the profile row survives", () => {
  // The negative half, and it is the one that stops this file being read as "delete more".
  // A recipe, a comment, a photo on a recipe and a cook-log entry live inside a family's
  // vault, and 0014 dropped the foreign key to auth.users precisely so they could outlive
  // the login. A future tidy-up that adds one of these to the deletion paths would be
  // deleting other people's heritage, so it has to fail here first.
  for (const [path, source] of [[selfPath, self], [adminPath, admin]] as const) {
    const tables = deletedTables(source);
    for (const kept of ["recipes", "comments", "recipe_photos", "cook_log"]) {
      expect(tables, `${path} must NOT delete ${kept}: a family is relying on it`)
        .not.toContain(kept);
    }
  }
});
