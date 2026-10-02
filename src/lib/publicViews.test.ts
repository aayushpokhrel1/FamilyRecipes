import { describe, expect, it } from "vitest";

// The two views in 0020_public_identity.sql are the ONLY path by which an anonymous visitor
// reads anything out of profiles, recipes or families. They run with definer rights (Supabase's
// advisor flags this as "Security Definer View", and that is deliberate: the RLS on those tables
// is self-read and member-read, so an invoker-rights view would return nothing to a stranger).
//
// Because RLS is bypassed, the WHERE clause and the column list ARE the access control. This
// test pins both. A new column added to the select list is a new column published to the whole
// internet, and the comment in the migration saying so was not a mechanism.
//
// ADDING A COLUMN ON PURPOSE? Decide it is public, then update the expectation below. That edit
// is the decision point this test exists to create.

const sql = Object.entries(
  import.meta.glob("../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >,
).sort(([a], [b]) => a.localeCompare(b));

/** The LAST definition of `view` across all migrations, so a later `create or replace` wins. */
function definition(view: string): string {
  const re = new RegExp(`create\s+(?:or\s+replace\s+)?view\s+${view}\s+as\b([\s\S]*?);`, "i");
  let found: string | undefined;
  for (const [, text] of sql) {
    const m = text.match(re);
    if (m) found = m[1];
  }
  if (!found) throw new Error(`no definition of view ${view} found in supabase/migrations/`);
  return found.replace(/\s+/g, " ").trim();
}

function columns(body: string): string[] {
  const select = body.match(/^select\s+([\s\S]*?)\s+from\s/i);
  if (!select) throw new Error(`could not read the select list from: ${body}`);
  return select[1].split(",").map((c) => c.trim().split(/\s+as\s+/i).pop()!.trim());
}

describe("the public views are the public API surface", () => {
  it("public_cooks publishes exactly these columns of profiles", () => {
    const body = definition("public_cooks");
    expect(columns(body)).toEqual(["id", "handle", "public_name", "bio", "avatar_url"]);
    expect(body).toMatch(/where handle is not null/i);
  });

  it("public_recipe_bylines publishes exactly these columns, for public recipes only", () => {
    const body = definition("public_recipe_bylines");
    expect(columns(body)).toEqual(["recipe_id", "handle", "public_name", "family_name"]);
    expect(body).toMatch(/where r\.visibility = 'public'/i);
  });

  it("neither view uses select *, which would publish whatever is added to the table later", () => {
    for (const view of ["public_cooks", "public_recipe_bylines"]) {
      expect(definition(view)).not.toMatch(/select\s+(\w+\.)?\*/i);
    }
  });
});
