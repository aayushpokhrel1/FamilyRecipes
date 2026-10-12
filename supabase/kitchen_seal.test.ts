import { readdirSync, readdirSync as readDirs, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
    const isKitchen = /create\s+(table|function|type|schema)\s+kitchen/i.test(text);
    if (!isKitchen) return false;
    return /public\.(recipes|families|profiles)/i.test(text);
  });
  expect(offenders).toEqual([]);
});

it("keeps the family migrations ignorant of the kitchen", () => {
  const offenders = files.filter((f) => {
    if (BRIDGE_FILES.includes(f)) return false;
    const text = code(readFileSync(join(dir, f), "utf8"));
    const isKitchen = /create\s+(table|function|type|schema)\s+kitchen/i.test(text);
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
