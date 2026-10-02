import { describe, expect, it } from "vitest";

// The two views in 0020_public_identity.sql are the ONLY path by which an anonymous visitor
// reads anything out of profiles, recipes or families. They run with definer rights, which
// Supabase's advisor flags as "Security Definer View". That is deliberate and must stay:
// profiles is self-read and families is member-read, so an invoker-rights view would return
// nothing to a stranger and every public recipe page would lose its byline.
//
// Because RLS is bypassed, the column list and the WHERE clause ARE the access control. This
// test pins both. A column added to either select list is a column published to the whole
// internet, and the "never add a column without deciding it is public" comment in the migration
// was not a mechanism.
//
// ADDING A COLUMN ON PURPOSE? Decide it is public, then update the expectation below. Having to
// make that edit is the point of this test.

const migrations = Object.entries(
  import.meta.glob("../../supabase/migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
).sort(([a], [b]) => a.localeCompare(b));

/** The LAST definition of `view` across all migrations, so a later `create or replace` wins. */
function definition(view: RegExp): string {
  let found: string | undefined;
  for (const [, text] of migrations) {
    const m = text.match(view);
    if (m) found = m[1];
  }
  if (!found) throw new Error(`no definition of ${view} found in supabase/migrations/`);
  return found.replace(/\s+/g, " ").trim();
}

/** The output names of a select list: the alias where there is one, else the bare column. */
function columns(body: string): string[] {
  const select = body.match(/^select\s+([\s\S]*?)\s+from\s/i);
  if (!select) throw new Error(`could not read the select list from: ${body}`);
  // `p.handle` and `f.name as family_name` both publish under their last segment, so the
  // expectation below reads as the column names a client actually sees.
  return select[1].split(",").map((c) => c.trim().split(/\s+as\s+/i).pop()!.trim().split(".").pop()!);
}

const COOKS = /create\s+(?:or\s+replace\s+)?view\s+public_cooks\s+as\b([\s\S]*?);/i;
const BYLINES = /create\s+(?:or\s+replace\s+)?view\s+public_recipe_bylines\s+as\b([\s\S]*?);/i;

describe("the public views are the app's public API surface", () => {
  it("public_cooks publishes exactly these columns of profiles", () => {
    const body = definition(COOKS);
    expect(columns(body)).toEqual(["id", "handle", "public_name", "bio", "avatar_url"]);
    expect(body).toMatch(/where handle is not null/i);
  });

  it("public_recipe_bylines publishes exactly these columns, for public recipes only", () => {
    const body = definition(BYLINES);
    expect(columns(body)).toEqual(["recipe_id", "handle", "public_name", "family_name"]);
    expect(body).toMatch(/where r\.visibility = 'public'/i);
  });

  it("neither view uses select *, which would publish whatever a later migration adds", () => {
    for (const view of [COOKS, BYLINES]) {
      expect(definition(view)).not.toMatch(/select\s+(?:\w+\.)?\*/i);
    }
  });
});
