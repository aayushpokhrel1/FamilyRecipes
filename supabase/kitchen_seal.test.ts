import { readdirSync, readFileSync } from "node:fs";
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
const BRIDGE = "0044_kitchen_publish_bridge.sql";

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

it("has the bridge migration it claims to have", () => {
  expect(files).toContain(BRIDGE);
});

it("mentions public.recipes, public.families or public.profiles in the bridge alone", () => {
  const offenders = files.filter((f) => {
    if (f === BRIDGE) return false;
    const text = code(readFileSync(join(dir, f), "utf8"));
    const isKitchen = /create\s+(table|function|type|schema)\s+kitchen/i.test(text);
    if (!isKitchen) return false;
    return /public\.(recipes|families|profiles)/i.test(text);
  });
  expect(offenders).toEqual([]);
});

it("keeps the family migrations ignorant of the kitchen", () => {
  const offenders = files.filter((f) => {
    if (f === BRIDGE) return false;
    const text = code(readFileSync(join(dir, f), "utf8"));
    const isKitchen = /create\s+(table|function|type|schema)\s+kitchen/i.test(text);
    return !isKitchen && /\bkitchen\./i.test(text);
  });
  expect(offenders).toEqual([]);
});
