import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

// Row-level security is the ENTIRE security model of this app. The browser holds nothing more
// privileged than an anon key, and every boundary (which family sees which recipe, who can read
// a profile, who can moderate) is a policy in the database. A table created without
// `enable row level security` is therefore not a small oversight: it is readable and writable
// by anyone holding the anon key, which is published in the JS bundle on purpose.
//
// All 22 tables have it today, verified against a live database. Nothing stopped migration 0035
// from adding a twenty-third without it, and that is the gap this closes. It reads the
// migrations rather than a live database on purpose: no Docker needed, so it runs in
// `npm test` with everything else, and migrations are the only way a table is created here.
//
// It sits in supabase/ rather than in supabase/migrations/ because the Supabase CLI treats
// every file in that directory as a migration, and printed
// "Skipping migration rls.test.ts... (file name must match pattern)" on every db command.
// A warning that is always there is a warning nobody reads, and a future CLI could reasonably
// turn it into an error.

const dir = resolve(process.cwd(), "supabase/migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));

const all = sql.map((s) => s.text).join("\n");

type Migration = { file: string; text: string };

/** Regex-safe form of a table name, since a schema-qualified one contains a dot. */
const esc = (s: string) => s.replace(/\./g, "\\.");

/**
 * Tables created anywhere in the given migrations, with the file that created each.
 *
 * It no longer skips other schemas. It used to, with the comment "a table in another schema
 * is not ours to police", which was true while every table this project owned lived in
 * `public`. The professional kitchen puts a whole product in `kitchen`, and under the old
 * rule every one of its tables would have shipped with no RLS and this suite green. The
 * schemas Supabase owns really are not ours, so those are still skipped.
 */
const THEIRS = ["auth.", "storage.", "extensions.", "realtime.", "vault.", "supabase_"];

function scanTables(migrations: Migration[]): { file: string; table: string }[] {
  const found: { file: string; table: string }[] = [];
  for (const { file, text } of migrations) {
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)/gi;
    for (const [, name] of text.matchAll(create)) {
      if (THEIRS.some((p) => name.startsWith(p))) continue;
      found.push({ file, table: name.replace(/^public\./, "") });
    }
  }
  return found;
}

/** Tables created without `enable row level security`. */
function rlsMissing(migrations: Migration[]): string[] {
  const all = migrations.map((m) => m.text).join("\n");
  return scanTables(migrations)
    .filter(({ table }) => {
      const re = new RegExp(
        String.raw`alter\s+table\s+(?:public\.)?${esc(table)}\s+enable\s+row\s+level\s+security`,
        "i",
      );
      return !re.test(all);
    })
    .map((t) => t.table);
}

/** Tables with RLS on and no policy, excluding the ones where that is the design. */
function unpoliced(migrations: Migration[]): string[] {
  const all = migrations.map((m) => m.text).join("\n");
  return scanTables(migrations)
    .filter(({ table }) => !(table in DELIBERATELY_UNPOLICED))
    .filter(({ table }) => {
      const re = new RegExp(
        String.raw`create\s+policy\s+[a-z0-9_]+\s+on\s+(?:public\.)?${esc(table)}\b`,
        "i",
      );
      return !re.test(all);
    })
    .map((t) => t.table);
}

/**
 * Tables in a non-public schema with no grant.
 *
 * `public` is granted to `anon` and `authenticated` by Supabase itself. A NEW SCHEMA IS
 * GRANTED TO NOBODY, so any new table there needs its grant in the same migration, either
 * per table or through `on all tables in schema`. This test is the only thing that will tell
 * you, because a missing grant and a missing policy fail in completely different ways.
 */
function ungranted(migrations: Migration[]): string[] {
  const all = migrations.map((m) => m.text).join("\n");
  return scanTables(migrations)
    .filter(({ table }) => table.includes("."))
    .filter(({ table }) => {
      const [schema, name] = table.split(".");
      const wide = new RegExp(
        String.raw`grant[^;]*on\s+all\s+tables\s+in\s+schema\s+${schema}\s+to`,
        "i",
      );
      const narrow = new RegExp(String.raw`grant[^;]*on\s+(?:table\s+)?${schema}\.${name}\s+to`, "i");
      return !wide.test(all) && !narrow.test(all);
    })
    .map((t) => t.table);
}

it("has migrations to read, since an empty list would guard nothing", () => {
  expect(sql.length).toBeGreaterThan(20);
  expect(scanTables(sql).length).toBeGreaterThan(15);
});

it("enables row level security on every table it creates", () => {
  // Named with the file that created it, because the first question on a red run is always
  // "which migration did this", and the table name alone does not answer it.
  const missing = rlsMissing(sql);
  const named = scanTables(sql)
    .filter(({ table }) => missing.includes(table))
    .map((m) => `${m.table} (created in ${m.file})`);
  expect(named).toEqual([]);
});

// Tables where having NO policy is the design. RLS with no policy denies everything, so this
// is the strictest possible setting, not a gap: the table is reachable only through a
// SECURITY DEFINER function running as its owner.
//
// Adding a table here is a real decision. Do it only when the migration says, at the table,
// why no policy is correct, and only when some definer function is the sole way in.
const DELIBERATELY_UNPOLICED: Record<string, string> = {
  // 0031: a cook must not see how often anyone else extracts, and must not be able to delete
  // their own rows to buy back quota. Only claim_extraction() touches it.
  extract_log: "rate-limit ledger, reachable only through claim_extraction()",
};

// Fixtures, so the scanner can be tested rather than only run. Every disk-backed test below
// passes the real `sql` into the same four functions, so a fixture passing and production
// failing is impossible.
const fixture = (text: string) => [{ file: "9999_fixture.sql", text }];

it("sees a table in a non-public schema, which it used to skip", () => {
  const found = scanTables(fixture("create table kitchen.dishes (id uuid primary key);"));
  expect(found.map((t) => t.table)).toEqual(["kitchen.dishes"]);
});

it("still ignores the schemas Supabase owns", () => {
  const found = scanTables(fixture("create table auth.sessions (id uuid primary key);"));
  expect(found).toEqual([]);
});

it("fails a kitchen table with no row level security", () => {
  expect(rlsMissing(fixture("create table kitchen.dishes (id uuid primary key);")))
    .toEqual(["kitchen.dishes"]);
});

it("fails a kitchen table with row level security but no policy", () => {
  expect(
    unpoliced(
      fixture(`create table kitchen.dishes (id uuid primary key);
               alter table kitchen.dishes enable row level security;`),
    ),
  ).toEqual(["kitchen.dishes"]);
});

it("fails a kitchen table that has policies but no grant", () => {
  // A new schema carries no privileges at all, so a table with perfect policies and no grant
  // is a permission error on every single call, which looks nothing like an RLS problem
  // while you debug it. RLS and grants are two separate locks and this guard held one.
  expect(
    ungranted(
      fixture(`create table kitchen.sites (id uuid primary key);
               alter table kitchen.sites enable row level security;
               create policy p on kitchen.sites for select using (true);`),
    ),
  ).toEqual(["kitchen.sites"]);
});

it("accepts a grant written per table or across the schema", () => {
  const narrow = `create table kitchen.sites (id uuid primary key);
                  grant select on kitchen.sites to authenticated;`;
  const wide = `create table kitchen.sites (id uuid primary key);
                grant select, insert, update, delete on all tables in schema kitchen
                  to authenticated;`;
  expect(ungranted(fixture(narrow))).toEqual([]);
  expect(ungranted(fixture(wide))).toEqual([]);
});

it("does not demand a grant for a table in public, which Supabase grants itself", () => {
  expect(ungranted(fixture("create table recipes (id uuid primary key);"))).toEqual([]);
});

it("holds every real table to all three locks", () => {
  expect(rlsMissing(sql)).toEqual([]);
  expect(unpoliced(sql)).toEqual([]);
  expect(ungranted(sql)).toEqual([]);
});

it("sets search_path on every security definer function", () => {
  // A SECURITY DEFINER function without a pinned search_path is the classic Postgres privilege
  // escalation: the caller controls search_path, so the caller chooses which schema's `recipes`
  // the function actually reads. Every one of these sets it today. Keep it that way.
  const offenders: string[] = [];
  for (const { file, text } of sql) {
    for (const match of text.matchAll(/security\s+definer([\s\S]*?)as\s+\$\$/gi)) {
      if (!/set\s+search_path\s*=/i.test(match[1])) {
        offenders.push(`${file}: ${match[0].slice(0, 60).replace(/\s+/g, " ")}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
