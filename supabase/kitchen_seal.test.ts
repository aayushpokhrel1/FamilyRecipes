import { existsSync, readdirSync, readdirSync as readDirs, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { expect, it } from "vitest";

// The seal is the entire justification for building the professional kitchen as a second app
// rather than as a workspace type inside the family one. A seal nobody checks is a comment,
// and this project's own history says the failure mode is not ignorance but not re-reading.
//
// Exactly ONE migration may mention the other schema. If a second one does, either move the
// crossing into the bridge migration or admit in the spec that the seal is gone.
const dir = resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
/**
 * Every migration that crosses between the two schemas, by name.
 *
 * It was one file, and 0045 made it two: replacing unpublish_dish means restating its update
 * of public.recipes. The list is the INVENTORY of crossings, so adding to it is a deliberate
 * act with a reason written in the migration itself, and any file not on it that reaches
 * across still fails this test.
 */
const BRIDGE_FILES = [
  "0044_kitchen_publish_bridge.sql",
  "0045_a_taken_down_dish_says_so.sql",
];
const BRIDGE = BRIDGE_FILES[0];

/**
 * SQL with its comments removed.
 *
 * Comments have to be stripped before any of this is matched, and the first run of this test
 * proved why: 0039 was reported as a crossing because its header comment NAMES
 * public.families, public.recipes and public.profiles while explaining that it must not
 * reference them. Checking raw text would therefore punish exactly the documentation the
 * seal depends on, and would also trip on any prose that happens to end a sentence with
 * "the kitchen." A code-only check is the only honest one.
 */
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");

it("has every bridge migration it claims to have", () => {
  for (const bridge of BRIDGE_FILES) expect(files).toContain(bridge);
});

it("mentions public.recipes, public.families or public.profiles in the bridge alone", () => {
  const offenders = files.filter((f) => {
    if (BRIDGE_FILES.includes(f)) return false;
    const text = code(readFileSync(join(dir, f), "utf8"));
    // A kitchen migration need not CREATE anything: 0048 only restates a policy on
    // kitchen.orgs. Judging by creation alone, that file read as a family migration
    // reaching across the seal, and the real invariant is narrower than that — a
    // non-bridge file may name one schema, never both.
    const isKitchen = /(?:create\s+(?:table|function|type|schema)|on|alter\s+table)\s+kitchen[.\s]/i
      .test(text);
    if (!isKitchen) return false;
    return /public\.(recipes|families|profiles)/i.test(text);
  });
  expect(offenders).toEqual([]);
});

it("keeps the family migrations ignorant of the kitchen", () => {
  const offenders = files.filter((f) => {
    if (BRIDGE_FILES.includes(f)) return false;
    const text = code(readFileSync(join(dir, f), "utf8"));
    // A kitchen migration need not CREATE anything: 0048 only restates a policy on
    // kitchen.orgs. Judging by creation alone, that file read as a family migration
    // reaching across the seal, and the real invariant is narrower than that — a
    // non-bridge file may name one schema, never both.
    const isKitchen = /(?:create\s+(?:table|function|type|schema)|on|alter\s+table)\s+kitchen[.\s]/i
      .test(text);
    return !isKitchen && /\bkitchen\./i.test(text);
  });
  expect(offenders).toEqual([]);
});

/**
 * The CODE seal, next to the database one.
 *
 * The kitchen app may import `auth.ts` and `kitchen/*` from `src/lib/api/`, and nothing else.
 * `auth.ts` is permitted because one login serves both products and a second copy of the auth
 * module would mean an auth bug in two places.
 *
 * That exclusion is PINNED by the second test below, which fails if `auth.ts` ever imports a
 * family module again. An unguarded exclusion in a safety check is a dated assumption, and
 * this project has already shipped one: rls.test.ts skipped tables outside `public` on
 * purpose, and the day a second product arrived in its own schema that skip would have
 * shipped it with no row level security at all.
 *
 * Tests in `supabase/` are run by vitest but are NOT type-checked by `tsc -b`, because no
 * tsconfig project includes that directory, which is why reading files with `node:fs` is fine
 * here and is not fine under `src/`.
 */
const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readDirs(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
};

const ALLOWED_FROM_KITCHEN = /\/lib\/api\/(auth|kitchen\/[a-z]+)$/;

it("lets the kitchen app import no family data module", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src/kitchen")) {
    const text = readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(/from\s+"([^"]+)"/g)) {
      if (!spec.includes("lib/api/")) continue;
      if (ALLOWED_FROM_KITCHEN.test(spec)) continue;
      offenders.push(`${file} imports ${spec}`);
    }
  }
  expect(offenders).toEqual([]);
});

it("keeps the shared auth module free of family modules, which is why it is allowed", () => {
  const text = readFileSync("src/lib/api/auth.ts", "utf8");
  const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map(([, spec]) => spec);
  // supabaseClient and nextPath are fine: neither knows a table name. A sibling in
  // ./api is not.
  expect(imports.filter((spec) => /^\.\/[a-z]/.test(spec))).toEqual([]);
});

it("keeps the family app out of the kitchen data layer", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    if (file.startsWith("src/kitchen/")) continue;
    if (file.includes("/api/kitchen/")) continue;
    if (/\.test\.tsx?$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (/from\s+"[^"]*api\/kitchen\//.test(text)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

/**
 * The same seal, followed THROUGH shared modules.
 *
 * The test above reads the DIRECT import specifiers of files under src/kitchen, so a file there
 * may import a shared component innocently while that component imports a family data module
 * behind it. The specifier under src/kitchen looks clean and the seal is broken.
 *
 * This is not hypothetical and it is not obscure: it is the first thing a reasonable person
 * tries. Reusing the family app's src/components/TermsGate.tsx from the kitchen app would have
 * done exactly this, because TermsGate imports lib/api/profile, and the check above would have
 * reported success. The kitchen got its own gate instead, and this test is why that choice
 * cannot quietly be undone later by somebody deduplicating two similar components.
 *
 * An unguarded assumption inside a safety check is a dated assumption. This file already says
 * that about rls.test.ts skipping non-public schemas, which would have shipped a whole product
 * with no row level security the day it arrived. The direct-only read was the same mistake one
 * level up.
 */
const resolveImport = (fromFile: string, spec: string): string | null => {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

it("follows transitive imports, so a shared module cannot smuggle a family module in", () => {
  const offenders: string[] = [];
  const seen = new Set<string>();
  // The chain is carried with each file so a failure names the PATH that reached the offending
  // module, not merely the module. "src/components/Skeleton.tsx imports ../lib/api/profile" is
  // a puzzle; the chain that got there is a fix.
  const queue: { file: string; chain: string[] }[] = sourceFiles("src/kitchen").map((file) => ({
    file: resolve(file),
    chain: [file],
  }));

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    // A REAL import or export statement, anchored to the start of its line, not any quoted
    // text that happens to follow the word "from". The looser pattern tripped on its first
    // run: KitchenTermsGate.version.test.ts asserts that the kitchen gate does NOT import
    // '../../components/TermsGate', and that assertion's own string was read as an edge, so
    // the walk marched into the family gate and reported the very violation the assertion
    // exists to prevent. A guard whose false positive points at the test written to uphold it
    // is a guard people learn to delete.
    for (const [, spec] of text.matchAll(/^\s*(?:import|export)[^"';]*?from\s+"([^"]+)"/gm)) {
      if (spec.includes("lib/api/") && !ALLOWED_FROM_KITCHEN.test(spec)) {
        offenders.push([...chain, spec].join(" -> "));
        continue;
      }
      const next = resolveImport(file, spec);
      if (next && /\.tsx?$/.test(next)) {
        // Windows separators normalised, so a failure message reads the same on either
        // platform and can be pasted straight into an editor.
        const shown = relative(process.cwd(), next).split(sep).join("/");
        queue.push({ file: next, chain: [...chain, shown] });
      }
    }
  }

  expect(offenders).toEqual([]);
});
