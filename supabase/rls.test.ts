import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

// Row-level security is the ENTIRE security model of this app. The browser holds nothing more
// privileged than an anon key, and every boundary (which family sees which recipe, who can read
// a profile, who can moderate) is a policy in the database. A table created without
// `enable row level security` is therefore not a small oversight: it is readable and writable
// by anyone holding the anon key, which is published in the JS bundle on purpose.
//
// All 35 tables have it today, 23 in `public` and 12 in `kitchen`, verified against a live
// database. Nothing stopped a new migration from adding the next one without it, and that is
// the gap this closes. The count is stated because it going stale is itself a signal: if it
// disagrees with `grep -c 'create table' supabase/migrations/*.sql`, somebody added tables
// without reading this file. It reads the
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
  const ordered = [...migrations].sort((a, b) => a.file.localeCompare(b.file));
  return scanTables(ordered)
    .filter(({ table }) => table.includes("."))
    .filter(({ file, table }) => {
      const [schema, name] = table.split(".");
      // A SCHEMA-WIDE GRANT ONLY COVERS THE TABLES THAT EXIST WHEN IT RUNS, so it may only
      // vouch for a table created in the SAME migration or an earlier one. Matching it against
      // every migration at once was a false pass, and 0046 proved it: `grant on all tables in
      // schema kitchen` in 0039 made this function call kitchen.terms_acceptance granted while
      // every call to it returned 42501, insufficient privilege. The docstring above claims
      // this test is the only thing that will tell you, so a false pass here is worse than no
      // check: the per-table grants in 0041 and 0043 exist for this reason and this function
      // would have let all four of their tables through without them.
      const reachable = ordered
        .filter((m) => m.file.localeCompare(file) >= 0)
        .map((m) => m.text)
        .join("\n");
      const wide = new RegExp(
        String.raw`grant[^;]*on\s+all\s+tables\s+in\s+schema\s+${schema}\s+to`,
        "i",
      );
      const narrow = new RegExp(String.raw`grant[^;]*on\s+(?:table\s+)?${schema}\.${name}\s+to`, "i");
      return !wide.test(reachable) && !narrow.test(reachable);
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

// ---------------------------------------------------------------------------------------
// Two locks added after the 2026-10-12 audit, which found six live holes. Both of them
// existed because the three checks above only ever asked whether a policy was PRESENT.
// Every one of the findings was a policy that was present and wrong.
// ---------------------------------------------------------------------------------------

/**
 * UPDATE policies that never write `with check`.
 *
 * THIS IS THE SINGLE MOST EXPENSIVE MISTAKE IN THIS SCHEMA'S HISTORY. Postgres silently
 * reuses the `using` expression as the check when you omit it, so the policy looks complete
 * and reads correctly, while constraining only which rows you may TOUCH and not what you may
 * turn them INTO. Three separate holes in the audit were this one mistake:
 *
 *   - `profiles_self_update` (0002) said `using (id = auth.uid())`. Correct when written. Then
 *     0028 added `is_moderator` to the same table, and one PATCH to your OWN row made you a
 *     moderator of the whole site.
 *   - `recipes_update` (0003) and `plans_update` (0008) let you set `family_id` to a stranger's
 *     family, putting your row inside a vault you are not a member of.
 *
 * The lesson is NOT "remember to write with check". Nobody re-reads a policy when they add a
 * column to its table four migrations later. The lesson is that the omission has to be
 * impossible to ship, which is what this test is for. Write the clause even when it duplicates
 * `using` verbatim: an explicit redundant clause is a decision, a missing one is an accident,
 * and only one of them is reviewable.
 */
function updateWithoutCheck(migrations: Migration[]): string[] {
  // LAST DEFINITION WINS, the same way `ungranted` above respects migration order. A policy
  // that 0003 got wrong and 0047 dropped and rewrote is fixed, and reporting 0003 forever
  // would make this test unpassable and therefore worthless. The map is keyed on name AND
  // table because a policy name is only unique per table.
  const ordered = [...migrations].sort((a, b) => a.file.localeCompare(b.file));
  const live = new Map<string, { file: string; body: string }>();
  // Drops and creates in document order, so a drop with no rewrite really does remove it.
  const re =
    /(?:drop\s+policy\s+(?:if\s+exists\s+)?([a-z0-9_]+)\s+on\s+([a-z0-9_.]+))|(?:create\s+policy\s+([a-z0-9_]+)\s+on\s+([a-z0-9_.]+)\s+for\s+([a-z]+)\b([^;]*))/gi;
  for (const { file, text } of ordered) {
    for (const m of text.matchAll(re)) {
      const [, dropName, dropTable, name, table, verb, body] = m;
      if (dropName) {
        live.delete(`${dropName}|${dropTable.replace(/^public\./, "")}`);
        continue;
      }
      const key = `${name}|${table.replace(/^public\./, "")}`;
      // `for all` is included deliberately: it covers UPDATE, so it carries the same trap.
      if (/^(update|all)$/i.test(verb)) live.set(key, { file, body });
      else live.delete(key);
    }
  }
  return [...live.entries()]
    .filter(([, v]) => !/with\s+check/i.test(v.body))
    .map(([k, v]) => `${k.split("|")[0]} on ${k.split("|")[1]} (${v.file})`);
}

/**
 * SECURITY DEFINER functions that take a uuid and never establish who is calling.
 *
 * A definer function runs as its owner and bypasses RLS completely, so its parameters are the
 * whole attack surface. One that accepts an id and answers a question about it, without ever
 * tying that id to `auth.uid()`, is an oracle: the caller picks the subject.
 *
 * `blocked_between(a, b)` and `hidden_from_feed(viewer, author)` (0029) were exactly this. Both
 * carried comments asserting they were safe because they "never reveal WHO blocked whom",
 * which is true when the APP calls them and false when the caller chooses both arguments: any
 * stranger, with no account, could ask whether any two people had blocked or muted each other.
 * `blocks` is specified as "a block the other person can discover is not a block", so this
 * broke a product promise and not only a boundary.
 *
 * Counting a call to one of the caller-identity helpers as establishing identity is deliberate:
 * they all resolve `auth.uid()` internally, and requiring the literal string would flag every
 * correct function in the kitchen schema.
 */
const CALLER_IDENTITY =
  /auth\.uid\(\)|is_moderator\s*\(|staff_role\s*\(|is_staff\s*\(|is_family_member\s*\(|can_read_dish\s*\(/i;

// Definer functions that take a uuid, check nothing, and are correct anyway, because what they
// return is already public. Adding one is a real decision: say why the answer is public.
const DELIBERATELY_UNCHECKED: Record<string, string> = {
  // 0022: answers only "does this profile have a handle", which is precisely what makes a cook
  // appear in public_cooks. The handle itself is published; its existence cannot be a secret.
  is_published_cook: "returns only whether a cook is published, which public_cooks already shows",
  // 0035: answers "did a moderator clear this cook's name, and have they not set a new one".
  // It CANNOT be pinned to auth.uid(), because search_recipes passes the AUTHOR of each row
  // it is about to render, not the caller, and it must stay callable by anon for the public
  // feed. It is not an oracle in the way the other two were: a cleared-and-unset cook's
  // byline is visibly absent in that same feed, so the function answers a question anyone
  // can already answer by looking, about a cook whose row they can already see.
  name_cleared_and_unset: "moderation state the public feed already renders on every byline",
};

function definerOracles(migrations: Migration[]): string[] {
  // `create or replace` means the LAST definition is the one the database runs, so this
  // walks the migrations in order and keeps only that one, for the same reason
  // updateWithoutCheck does. Judging every historical body would pin the schema to its
  // worst past version and leave no way to fix anything.
  const ordered = [...migrations].sort((a, b) => a.file.localeCompare(b.file));
  const live = new Map<string, { file: string; params: string; head: string; body: string }>();
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)\s*\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$/gi;
  for (const { file, text } of ordered) {
    for (const [, name, params, head, body] of text.matchAll(re)) {
      live.set(name, { file, params, head, body });
    }
  }
  return [...live.entries()]
    .filter(([name, f]) => {
      if (!/security\s+definer/i.test(f.head)) return false;
      if (!/\buuid\b/i.test(f.params)) return false;
      if (CALLER_IDENTITY.test(f.body)) return false;
      return !(name.replace(/^.*\./, "") in DELIBERATELY_UNCHECKED);
    })
    .map(([name, f]) => `${name} (${f.file})`);
}

it("fails an update policy that omits with check", () => {
  expect(
    updateWithoutCheck(
      fixture("create policy p on recipes for update using (author_id = auth.uid());"),
    ),
  ).toEqual(["p on recipes (9999_fixture.sql)"]);
});

it("accepts an update policy that writes with check explicitly", () => {
  expect(
    updateWithoutCheck(
      fixture(`create policy p on recipes for update
                 using (author_id = auth.uid()) with check (author_id = auth.uid());`),
    ),
  ).toEqual([]);
});

it("fails a for-all policy that omits with check, since it covers update too", () => {
  expect(updateWithoutCheck(fixture("create policy p on recipes for all using (true);")))
    .toEqual(["p on recipes (9999_fixture.sql)"]);
});

it("leaves select and delete policies alone, which take no with check", () => {
  expect(
    updateWithoutCheck(
      fixture(`create policy r on recipes for select using (true);
               create policy d on recipes for delete using (author_id = auth.uid());`),
    ),
  ).toEqual([]);
});

it("fails a definer function that takes a uuid and never checks the caller", () => {
  expect(
    definerOracles(
      fixture(`create function peek(a uuid) returns boolean
               language sql stable security definer set search_path = public as $$
                 select exists (select 1 from blocks where blocker_id = a); $$;`),
    ),
  ).toEqual(["peek (9999_fixture.sql)"]);
});

it("accepts a definer function that pins a uuid argument to the caller", () => {
  expect(
    definerOracles(
      fixture(`create function peek(a uuid) returns boolean
               language sql stable security definer set search_path = public as $$
                 select a = auth.uid() and exists (select 1 from blocks where blocker_id = a); $$;`),
    ),
  ).toEqual([]);
});

it("accepts a definer function that checks the caller through a helper", () => {
  expect(
    definerOracles(
      fixture(`create function kitchen.v(p_dish uuid) returns uuid
               language sql stable security definer set search_path = kitchen as $$
                 select id from kitchen.dish_versions
                 where dish_id = p_dish and kitchen.can_read_dish(p_dish); $$;`),
    ),
  ).toEqual([]);
});

it("holds every real update policy and definer function to those two locks", () => {
  expect(updateWithoutCheck(sql)).toEqual([]);
  expect(definerOracles(sql)).toEqual([]);
});
