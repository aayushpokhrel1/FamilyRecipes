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

// ---------------------------------------------------------------------------------------
// Two locks added after the 2026-10-12 full audit, which found a HIGH authorization bypass
// in the kitchen schema. Both of its halves were systemic rather than one-off.
// ---------------------------------------------------------------------------------------

/**
 * A role gate whose left-hand side can be NULL is not a gate.
 *
 * `kitchen.staff_role(org)` is a bare SELECT, so it returns NULL for a caller with no staff
 * row. Four pipeline functions wrote `if kitchen.staff_role(...) not in ('owner','chef')`.
 * `NULL not in (...)` is NULL, and plpgsql does not execute an IF body whose condition is
 * NULL, SO THE RAISE WAS SKIPPED FOR EXACTLY THE CALLER WITH NO AUTHORITY AT ALL. The gate
 * refused every wrong role and admitted the absence of a role.
 *
 * The scenario that makes it concrete: while holding the lowest role, 'cook', a user was
 * correctly refused. After the owner DELETED their staff row, the same user was allowed to
 * create, revise, trial and sign a dish onto the org's live menu. Offboarding an employee
 * increased their authority.
 *
 * This is the second instance of the same bug class in this codebase: the 2026-10-12
 * migration 0047 nearly shipped `hidden_from_feed` returning NULL instead of false into a
 * policy consumed behind `not`. Two independent instances is why this is a test and not a
 * note. COALESCE anything nullable before comparing it.
 */
function nullableGates(migrations: Migration[]): string[] {
  const offenders: string[] = [];
  // Helpers that return NULL rather than a sentinel when the caller has no row.
  const NULLABLE = String.raw`(?:kitchen\.)?(?:staff_role|staff_site)`;
  // ONLY the negative operators. The direction matters and is the whole point:
  //   `if role = 'owner' then <privileged work>`      NULL skips the work   -> fails CLOSED
  //   `if role not in ('owner') then raise`           NULL skips the raise  -> fails OPEN
  // The same applies inside a policy, where `staff_role(id) = 'owner'` yielding NULL simply
  // matches no row. So an equality test against this helper is safe and is not flagged;
  // a negated test used to guard a refusal is the shape that shipped the bypass.
  const re = new RegExp(String.raw`${NULLABLE}\s*\([^)]*\)\s*(not\s+in|<>|!=)`, "gi");
  // LAST DEFINITION WINS, the same as updateWithoutCheck and definerOracles above. 0041 and
  // 0042 still contain the broken gate as history; 0049 replaces all four functions. Judging
  // every historical body would pin the schema to its worst past version and leave no way to
  // fix anything. Policy text outside a function body is scanned as-is, since a policy is
  // not replaced by name the same way.
  const ordered = [...migrations].sort((a, b) => a.file.localeCompare(b.file));
  const liveFn = new Map<string, { file: string; body: string }>();
  const fnRe =
    /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)\s*\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$/gi;
  for (const { file, text } of ordered) {
    // Strip `--` comments first, the same way kitchen_seal.test.ts does. 0049 quotes the
    // broken gate verbatim in its header to explain the bug, and a guard that cannot tell
    // code from the prose describing it would make the bug undocumentable.
    const code = text.replace(/--.*$/gm, "");
    let outsideFunctions = code;
    for (const m of code.matchAll(fnRe)) {
      liveFn.set(m[1], { file, body: m[4] });
      outsideFunctions = outsideFunctions.replace(m[0], "");
    }
    for (const m of outsideFunctions.matchAll(re)) {
      offenders.push(`${file}: ${m[0].replace(/\s+/g, " ")}`);
    }
  }
  for (const [name, f] of liveFn) {
    for (const m of f.body.matchAll(re)) {
      // `is distinct from` is the safe form and is deliberately not matched above.
      offenders.push(`${f.file}: ${name} -> ${m[0].replace(/\s+/g, " ")}`);
    }
  }
  return offenders;
}

/**
 * Every kitchen function must have its EXECUTE privilege stated, not defaulted.
 *
 * 0039 granted execute on all functions IN THE SCHEMA AT THAT MOMENT. Every function added
 * in 0040 through 0046 therefore kept Postgres's default, which is EXECUTE to PUBLIC, while
 * 0040 separately granted anon USAGE on the schema. The audit read pg_proc and found
 * proacl null for ALL ELEVEN kitchen definer functions. That is what made the NULL gate
 * above reachable rather than merely wrong.
 *
 * A blanket revoke is the only form that covers the function nobody has written yet.
 */
function kitchenExecuteNotRevoked(migrations: Migration[]): boolean {
  const all = migrations.map((m) => m.text).join("\n");
  return !/revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+kitchen\s+from[^;]*public/i.test(all);
}

it("fails a role gate that compares a nullable helper with NOT IN", () => {
  expect(
    nullableGates(fixture("if kitchen.staff_role(p_org) not in ('owner','chef') then")),
  ).toHaveLength(1);
});

it("fails a role gate that compares a nullable helper with <>", () => {
  expect(nullableGates(fixture("if kitchen.staff_role(p_org) <> 'owner' then"))).toHaveLength(1);
});

it("leaves an equality test alone, because NULL there fails closed", () => {
  // `staff_role(id) = 'owner'` inside a policy matches no row when the helper is NULL, and
  // inside an IF it skips the privileged branch. Both are the safe direction.
  expect(nullableGates(fixture("create policy p on kitchen.orgs for update using (kitchen.staff_role(id) = 'owner');")))
    .toEqual([]);
});

it("accepts the two safe forms: is distinct from, and coalesce before comparing", () => {
  expect(nullableGates(fixture("if kitchen.staff_role(p_org) is distinct from 'owner' then")))
    .toEqual([]);
  expect(
    nullableGates(fixture("if coalesce(kitchen.staff_role(p_org), '') not in ('owner','chef') then")),
  ).toEqual([]);
});

it("compares no nullable role helper with a NULL-propagating operator", () => {
  expect(nullableGates(sql)).toEqual([]);
});

it("revokes execute on kitchen functions from public rather than relying on the default", () => {
  expect(kitchenExecuteNotRevoked(sql)).toBe(false);
});

/**
 * Every view this project creates must have its WRITE privileges revoked.
 *
 * A VIEW HAS NO ROW-LEVEL SECURITY: RLS belongs to a table. `public_cooks` (0020) reads
 * `profiles`, and it exists precisely to get past `profiles_self_read` so a stranger can read
 * a published cook's name. Because it is not `security_invoker`, every statement through it
 * runs as the view's OWNER, and a table's owner is exempt from its own policies. Because it
 * selects from a single table, Postgres makes it auto-updatable. So the view was a hole in
 * RLS that pointed both ways, and an UPDATE or DELETE through it rewrote `profiles` with the
 * policies switched off.
 *
 * 0020 wrote `grant select ... to anon, authenticated` and nothing else, which reads as the
 * whole story and is not. **Supabase's `alter default privileges` for role postgres in schema
 * public grants ALL on new tables to anon, authenticated and service_role, and a view counts
 * as a table for that purpose.** The live ACL was `anon=arwdDxtm`. Measured over PostgREST
 * with the publishable key: PATCH on another cook's row returned 200, DELETE returned 204.
 *
 * So the dangerous privilege is in NO migration, and this check cannot look for it. What it
 * can do is demand the revoke that cancels it, which is the one line the author of the next
 * view would otherwise leave out for exactly the reason 0020 did: nothing granted it, so
 * nothing looks like it needs taking away. The live half of the guard is
 * `tests/integration/public_cooks_write.test.ts`, which runs the exploit as anon.
 *
 * `public` is accepted as a revoke target alongside the two roles, since revoking from PUBLIC
 * covers every role at once.
 */
function viewsWithWritesNotRevoked(migrations: Migration[]): string[] {
  const text = migrations.map((m) => m.text).join("\n");
  const found: string[] = [];
  for (const { file, text: own } of migrations) {
    const create = /create\s+(?:or\s+replace\s+)?view\s+([a-z0-9_.]+)/gi;
    for (const [, name] of own.matchAll(create)) {
      if (THEIRS.some((prefix) => name.startsWith(prefix))) continue;
      const view = name.replace(/^public\./, "");
      // One revoke naming the view and all three write verbs. Order is not fixed, and a
      // schema-qualified spelling is accepted, so the test does not care how it was written.
      const revoke = new RegExp(
        `revoke[^;]*\\binsert\\b[^;]*\\bupdate\\b[^;]*\\bdelete\\b[^;]*\\bon\\s+(?:public\\.)?${esc(view)}\\b[^;]*from[^;]*(anon|authenticated|public)`,
        "i",
      );
      if (!revoke.test(text)) found.push(`${view} (${file})`);
    }
  }
  return found;
}

it("fails a view created without revoking writes on it", () => {
  expect(
    viewsWithWritesNotRevoked(
      fixture("create view public_cooks as select id from profiles;\ngrant select on public_cooks to anon;"),
    ),
  ).toHaveLength(1);
});

it("accepts a view whose write privileges are revoked", () => {
  expect(
    viewsWithWritesNotRevoked(
      fixture(
        "create view public_cooks as select id from profiles;\n" +
          "revoke insert, update, delete, truncate on public_cooks from anon, authenticated, public;",
      ),
    ),
  ).toEqual([]);
});

it("is not satisfied by a revoke that forgets delete", () => {
  // The three verbs are demanded together on purpose: a partial revoke is the shape that
  // would read as done and leave the row deletable.
  expect(
    viewsWithWritesNotRevoked(
      fixture(
        "create view public_cooks as select id from profiles;\n" +
          "revoke insert, update on public_cooks from anon, authenticated;",
      ),
    ),
  ).toHaveLength(1);
});

it("revokes writes on every view it creates", () => {
  expect(viewsWithWritesNotRevoked(sql)).toEqual([]);
});

/**
 * A foreign key to auth.users with no ON DELETE action is a VETO ON ACCOUNT DELETION.
 *
 * NO ACTION is the default, so the column reads as harmless attribution and behaves as a
 * lock: Postgres refuses to remove the login while one such row exists. Both deletion paths
 * call auth.admin.deleteUser LAST, after blanking the profile, so the failure lands in the
 * worst place available, with the identity already gone and the login still live. Eight
 * columns in `kitchen` were written that way (0039 to 0044) and 0059 rewrote all eight to
 * `on delete set null`; the behavioural proof is
 * tests/integration/kitchen_account_deletion.test.ts, which actually deletes a user who has
 * worked in a kitchen.
 *
 * This is the part that covers the NINTH column, in the migration nobody has written yet.
 * It reads the creating statement, so the eight that 0059 fixed in a later file are listed
 * as known: the alternative is parsing constraint rewrites, which is more code than the rule
 * is worth. If you add a column here, fix the FK where you declare it instead.
 */
const DELETION_VETOES_FIXED_IN_0059 = new Set([
  "kitchen.orgs.created_by",
  "kitchen.staff_invites.created_by",
  "kitchen.staff_invites.used_by",
  "kitchen.dishes.created_by",
  "kitchen.dish_versions.created_by",
  "kitchen.approvals.approved_by",
  "kitchen.deviations.created_by",
  "kitchen.published_snapshots.published_by",
]);

export function authUserFksWithoutOnDelete(migrations: Migration[]): string[] {
  const found: string[] = [];
  for (const { text } of migrations) {
    // One pass per CREATE TABLE, so the table name is known for each column line.
    const tables = text.matchAll(/create table\s+(?:if not exists\s+)?([\w.]+)\s*\(([\s\S]*?)\n\);/gi);
    for (const [, table, body] of tables) {
      for (const line of body.split("\n")) {
        const bare = line.replace(/--.*$/, "");
        if (!/references\s+auth\.users/i.test(bare)) continue;
        if (/on delete/i.test(bare)) continue;
        const column = bare.trim().split(/\s+/)[0];
        const name = `${table}.${column}`;
        if (!DELETION_VETOES_FIXED_IN_0059.has(name)) found.push(name);
      }
    }
  }
  return found;
}

it("fails a new column that references auth.users with no on delete action", () => {
  expect(
    authUserFksWithoutOnDelete(
      fixture("create table kitchen.tastings (\n  id uuid primary key,\n  taster uuid not null references auth.users(id)\n);"),
    ),
  ).toEqual(["kitchen.tastings.taster"]);
});

it("accepts set null and cascade, which are the two answers erasure allows", () => {
  expect(
    authUserFksWithoutOnDelete(
      fixture(
        "create table kitchen.tastings (\n" +
          "  taster uuid references auth.users(id) on delete set null,\n" +
          "  booked_by uuid references auth.users(id) on delete cascade\n);",
      ),
    ),
  ).toEqual([]);
});

it("lets no foreign key to auth.users veto a deletion", () => {
  expect(authUserFksWithoutOnDelete(sql)).toEqual([]);
});
