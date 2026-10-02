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

const dir = resolve(process.cwd(), "supabase/migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));

const all = sql.map((s) => s.text).join("\n");

/** Tables created anywhere in the migration history, with the file that created each. */
function createdTables(): { file: string; table: string }[] {
  const found: { file: string; table: string }[] = [];
  for (const { file, text } of sql) {
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)/gi;
    for (const [, name] of text.matchAll(create)) {
      // A table in another schema is not ours to police.
      if (name.includes(".") && !name.startsWith("public.")) continue;
      found.push({ file, table: name.replace(/^public\./, "") });
    }
  }
  return found;
}

it("has migrations to read, since an empty list would guard nothing", () => {
  expect(sql.length).toBeGreaterThan(20);
  expect(createdTables().length).toBeGreaterThan(15);
});

it("enables row level security on every table it creates", () => {
  const missing = createdTables().filter(({ table }) => {
    const enabled = new RegExp(
      String.raw`alter\s+table\s+(?:public\.)?${table}\s+enable\s+row\s+level\s+security`,
      "i",
    );
    return !enabled.test(all);
  });
  expect(missing.map((m) => `${m.table} (created in ${m.file})`)).toEqual([]);
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

it("gives every table it creates at least one policy", () => {
  // RLS with no policy denies everything. That fails closed, so it is safe, but it is almost
  // always a half-finished migration rather than an intention.
  const unpoliced = createdTables()
    .filter(({ table }) => !(table in DELIBERATELY_UNPOLICED))
    .filter(({ table }) => {
    const policy = new RegExp(
      String.raw`create\s+policy\s+[a-z0-9_]+\s+on\s+(?:public\.)?${table}\b`,
      "i",
    );
      return !policy.test(all);
    });
  expect(unpoliced.map((m) => m.table)).toEqual([]);
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
